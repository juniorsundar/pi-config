/**
 * Diff Overlay — extension factory.
 *
 * Registers custom write/edit tools that delegate execution to Pi's built-ins
 * but replace native renderCall previews with compact diff approval cards.
 * Tool calls are intercepted in tool_call and paused until the user approves
 * or denies via inline A/D/E terminal input. Ctrl+Alt+F expands/minimises the
 * pending diff overlay without deciding.
 *
 * The slash commands `/diff-preview` and `/diff-overlay` remain as sample/demo
 * entrypoints.
 */

import {
  createEditTool,
  createWriteTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Key, Text } from "@earendil-works/pi-tui";
import { resolve } from "node:path";
import { evaluateConfirmation, getCurrentProfile } from "./permission-policy";
import { DiffOverlayComponent, type OverlayResult } from "./overlay-component";
import { generateCompactDiff } from "./diff-generation";
import {
  runNeovimDiffApproval,
  commandExists,
  readFileSnapshot,
  validateAndApplyEditPreview,
  type FileSnapshot,
  type UiContext,
} from "./neovim-diff-approval";

// ── Pending diff state ──────────────────────────────────────────────

interface PendingDiff {
  before: string;
  after: string;
  fileName: string;
  title: string;
  toolName?: "edit" | "write";
  toolInput?: Record<string, unknown>;
}

type ToolCallBlockResult = { block: true; reason: string } | undefined;

const PENDING_ENTRY_TYPE = "diff-preview-state";

interface PendingStateEntry {
  cleared?: true;
  before?: string;
  after?: string;
  fileName?: string;
  title?: string;
}

// ── Extension factory ─────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let pending: PendingDiff | null = null;
  let overlayOpen = false;
  let approvalResolver: ((decision: "approve" | "deny") => void) | null = null;
  let unsubscribeTerminal: (() => void) | null = null;
  // Captured from session_start so openNeovimForPending can use the real ui.
  let sessionCtx: UiContext | null = null;

  // Override write/edit rendering while delegating execution to Pi's built-ins.
  // A defined renderCall prevents ToolExecutionComponent from falling back to
  // the native preview; execute delegates so mutation behavior is preserved.
  const originalWrite = createWriteTool(process.cwd());
  pi.registerTool({
    name: "write",
    label: originalWrite.label,
    description: originalWrite.description,
    parameters: originalWrite.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createWriteTool(ctx?.cwd ?? process.cwd());
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
    renderShell: "self",
    renderCall(args, theme, context) {
      return renderMutationApprovalCard("write", args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderMutationResult(result, theme, context);
    },
  });

  const originalEdit = createEditTool(process.cwd());
  pi.registerTool({
    name: "edit",
    label: originalEdit.label,
    description: originalEdit.description,
    parameters: originalEdit.parameters,
    prepareArguments: originalEdit.prepareArguments,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createEditTool(ctx?.cwd ?? process.cwd());
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
    renderShell: "self",
    renderCall(args, theme, context) {
      return renderMutationApprovalCard("edit", args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderMutationResult(result, theme, context);
    },
  });

  function persistPending(diff: PendingDiff | null): void {
    if (diff) {
      pi.appendEntry(PENDING_ENTRY_TYPE, diff satisfies PendingStateEntry);
    } else {
      pi.appendEntry(PENDING_ENTRY_TYPE, { cleared: true } satisfies PendingStateEntry);
    }
  }

  function setPending(diff: PendingDiff | null): void {
    pending = diff;
    persistPending(diff);
  }

  function emitVerdict(verdict: "approve" | "deny", fileName?: string): void {
    const isApprove = verdict === "approve";
    pi.sendMessage({
      customType: "diff-verdict",
      content: isApprove ? "✓ approved" : "✗ denied",
      display: true,
      details: {
        verdict: isApprove ? "approved" : "denied",
        fileName: fileName ?? pending?.fileName,
      } satisfies { verdict: "approved" | "denied"; fileName: string | undefined },
    });
  }

  function resolvePendingApproval(decision: "approve" | "deny"): void {
    if (!pending) return;
    const resolver = approvalResolver;
    approvalResolver = null;
    if (resolver) {
      resolver(decision);
    } else {
      emitVerdict(decision, pending.fileName);
    }
    setPending(null);
  }

  // ── Neovim editing ────────────────────────────────────────────────

  async function openNeovimForPending(): Promise<void> {
    if (!pending) return;
    if (!sessionCtx) {
      pi.sendMessage({
        customType: "diff-verdict",
        content: "Session context not available — reload and try again",
        display: true,
        details: { verdict: "denied", fileName: pending.fileName },
      });
      return;
    }
    if (!commandExists("nvim")) {
      sessionCtx.ui.notify("Neovim not found — approve/deny from the diff preview instead.", "warning");
      return;
    }

    const beforeContent = pending.before;
    const afterContent = pending.after;
    const metadata: Array<[string, string]> = [
      ["Tool", pending.toolName ?? "edit"],
      ["File", pending.fileName],
    ];

    const result = await runNeovimDiffApproval(sessionCtx, {
      toolName: pending.toolName ?? "edit",
      targetPath: pending.fileName,
      beforeContent,
      afterContent,
      metadata,
    });

    if (result.decision === "approve") {
      const approvedContent = result.approvedContent ?? afterContent;
      pending.after = approvedContent;
      resolvePendingApproval("approve");
      return;
    }

    sessionCtx.ui.notify("Neovim did not approve the change — diff approval remains pending.", "warning");
  }

  // ── Overlay opener ────────────────────────────────────────────────

  async function openOverlay(
    ctx: ExtensionCommandContext,
    diff: PendingDiff,
  ): Promise<void> {
    overlayOpen = true;
    try {
      const result = await ctx.ui.custom<OverlayResult>(
        (tui, theme, _kb, done) =>
          new DiffOverlayComponent(
            tui,
            theme,
            diff.title,
            diff.before,
            diff.after,
            diff.fileName,
            done,
          ),
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "90%",
            maxHeight: "80%",
            margin: { bottom: 6 },
          },
        },
      );

      if (result === "dismiss") {
        // Ctrl+Alt+F toggle — close overlay without deciding.
      } else if (result === "edit_in_neovim") {
        await openNeovimForPending();
      } else if (pending) {
        resolvePendingApproval(result);
      } else {
        emitVerdict(result, diff.fileName);
      }
    } finally {
      overlayOpen = false;
    }
  }

  async function approveToolCallWithDiffPreview(
    toolName: "edit" | "write",
    input: Record<string, unknown>,
    ctx: UiContext,
  ): Promise<boolean> {
    if (approvalResolver || pending) {
      emitVerdict("deny", getPath(input));
      return false;
    }

    const targetPath = getPath(input);
    const absolutePath = resolve(ctx.cwd, targetPath);
    const before = readFileSnapshot(absolutePath);
    const validation =
      toolName === "write"
        ? { ok: true, afterContent: getWriteContent(input) }
        : validateAndApplyEditPreview(before.content, input);
    const afterContent = validation.afterContent;
    const metadata = buildFileChangeMetadata(toolName, targetPath, before, afterContent, input);

    if (before.binary || before.unreadable || isLikelyBinaryText(afterContent)) {
      const ok = await ctx.ui.confirm(
        `Allow ${toolName} ${targetPath}?`,
        joinSections([
          "This file/change cannot be safely rendered as a text diff preview.",
          fieldBlock(metadata),
        ]),
      );
      return ok;
    }

    if (!validation.ok) {
      const ok = await ctx.ui.confirm(
        `Unsafe edit preview: ${targetPath}`,
        joinSections([
          "The requested edit could not be previewed safely. Denial is recommended.",
          section("Validation", (validation.errors ?? []).join("\n")),
          fieldBlock(metadata),
          "Approve anyway without a diff preview?",
        ]),
      );
      return ok;
    }

    const largeWarning = getLargeContentWarning(before.content, afterContent);
    if (largeWarning) {
      const ok = await ctx.ui.confirm(
        `Large diff: ${targetPath}`,
        joinSections([largeWarning, fieldBlock(metadata), "Continue to diff approval?"]),
      );
      if (!ok) return false;
    }

    const title = `Pi Approval | ${toolName} | ${targetPath}`;
    setPending({
      before: before.content,
      after: afterContent,
      fileName: targetPath,
      title,
      toolName,
      toolInput: input,
    });

    return new Promise<boolean>((resolveApproval) => {
      approvalResolver = (decision) => {
        if (decision !== "approve") {
          emitVerdict("deny", targetPath);
          resolveApproval(false);
          return;
        }

        const currentSnapshot = readFileSnapshot(absolutePath);
        if (currentSnapshot.fingerprint !== before.fingerprint) {
          emitVerdict("deny", targetPath);
          resolveApproval(false);
          return;
        }

        applyApprovedContent(toolName, input, before, pending?.after ?? afterContent);
        emitVerdict("approve", targetPath);
        resolveApproval(true);
      };
    });
  }

  pi.on("tool_call", async (event, ctx): Promise<ToolCallBlockResult> => {
    if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
    if (!isRecord(event.input)) return { block: true, reason: `${event.toolName} input must be an object` };
    if (isTmpFileMutation(event.toolName, event.input, ctx.cwd)) {
      emitVerdict("approve", getPath(event.input));
      return undefined;
    }
    if (isSubagentChild()) return undefined;

    const confirmation = evaluateConfirmation(
      getCurrentProfile(),
      event.toolName,
      event.input,
    );
    if (confirmation.action === "block") return { block: true, reason: confirmation.reason };
    if (confirmation.action === "bypass") {
      emitVerdict("approve", getPath(event.input));
      return undefined;
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `${event.toolName} blocked: no UI available for diff-preview confirmation`,
      };
    }

    const approved = await approveToolCallWithDiffPreview(event.toolName, event.input, ctx);
    if (!approved) return { block: true, reason: "Blocked by user" };
    return undefined;
  });

  // ── Renderers ──────────────────────────────────────────────────────

  pi.registerMessageRenderer("diff-verdict", (message, _options, theme) => {
    const details = message.details as {
      verdict: "approved" | "denied";
      fileName?: string;
    };
    const isApprove = details.verdict === "approved";
    const icon = isApprove ? "✓" : "✗";
    const word = isApprove ? "approved" : "denied";
    let text = theme.fg(isApprove ? "success" : "error", `${icon} ${word}`);
    if (details.fileName) {
      text += theme.fg("dim", ` — ${details.fileName}`);
    }
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(text, 0, 0));
    return box;
  });


  // ── Ctrl+Alt+F shortcut ────────────────────────────────────────────

  pi.registerShortcut(Key.ctrlAlt("f"), {
    description: "Expand pending inline diff to full overlay",
    handler: (ctx) => {
      if (overlayOpen) {
        ctx.ui.notify("Diff overlay already open", "warning");
        return;
      }
      if (!pending) {
        ctx.ui.notify("No diff pending", "warning");
        return;
      }
      void (async () => {
        const current = pending;
        if (!current) return;
        await openOverlay(ctx, current);
      })();
    },
  });

  // ── Session lifecycle ──────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // Capture the real session context so openNeovimForPending can use
    // ctx.ui.custom() to suspend the TUI and open Neovim.
    sessionCtx = {
      cwd: ctx.cwd,
      ui: ctx.ui,
    };

    // Restore pending diff from the session (survives /reload).
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i] as
        | { type: string; customType?: string; data?: PendingStateEntry }
        | undefined;
      if (entry?.type === "custom" && entry.customType === PENDING_ENTRY_TYPE) {
        const data = entry.data;
        if (
          data &&
          !data.cleared &&
          data.before &&
          data.after &&
          data.fileName &&
          data.title
        ) {
          pending = {
            before: data.before,
            after: data.after,
            fileName: data.fileName,
            title: data.title,
          };
        }
        break;
      }
    }

    if (unsubscribeTerminal) {
      unsubscribeTerminal();
      unsubscribeTerminal = null;
    }

    // Raw terminal input capture for inline A/D/E. Only consumes keys when
    // (a) a diff is pending and (b) the overlay is NOT open.
    unsubscribeTerminal = ctx.ui.onTerminalInput((data) => {
      if (overlayOpen) return undefined;
      if (!pending) return undefined;
      if (data === "a" || data === "A") {
        resolvePendingApproval("approve");
        return { consume: true };
      }
      if (data === "d" || data === "D") {
        resolvePendingApproval("deny");
        return { consume: true };
      }
      if (data === "e" || data === "E") {
        void openNeovimForPending();
        return { consume: true };
      }
      return undefined;
    });
  });

  pi.on("session_shutdown", async () => {
    if (unsubscribeTerminal) {
      unsubscribeTerminal();
      unsubscribeTerminal = null;
    }
  });
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderMutationApprovalCard(
  toolName: "edit" | "write",
  args: unknown,
  theme: any,
  context: { cwd: string; state?: Record<string, unknown>; executionStarted?: boolean },
): Box {
  const input = isRecord(args) ? args : {};
  const cwd = context.cwd;
  const targetPath = getPath(input);
  const title = `Pi Approval | ${toolName} | ${targetPath}`;
  const cacheKey = `${toolName}:${cwd}:${stableStringify(input)}`;
  const state = context.state ?? {};
  const cached = state.mutationApprovalRender as
    | { key: string; lines: string[] }
    | undefined;

  if (cached?.key === cacheKey) {
    return renderApprovalBox(cached.lines, theme);
  }

  const lines: string[] = [];

  try {
    const before = readFileSnapshot(resolve(cwd, targetPath));
    const validation =
      toolName === "write"
        ? { ok: true, afterContent: getWriteContent(input) }
        : validateAndApplyEditPreview(before.content, input);

    if (before.binary || before.unreadable || isLikelyBinaryText(validation.afterContent)) {
      lines.push(theme.fg("accent", "✎ ") + theme.fg("toolTitle", `${toolName}  ${targetPath}`));
      lines.push("");
      lines.push(theme.fg("warning", "Text diff preview unavailable for this file/change."));
      lines.push(theme.fg("dim", "Use the confirmation prompt to approve or deny."));
      state.mutationApprovalRender = { key: cacheKey, lines };
      return renderApprovalBox(lines, theme);
    }

    if (!validation.ok) {
      lines.push(theme.fg("accent", "✎ ") + theme.fg("toolTitle", `${toolName}  ${targetPath}`));
      lines.push("");
      lines.push(theme.fg("error", "Unable to safely preview this edit."));
      for (const error of validation.errors ?? []) {
        lines.push(theme.fg("dim", `  ${error}`));
      }
      lines.push("");
      lines.push(renderApprovalHints(theme));
      state.mutationApprovalRender = { key: cacheKey, lines };
      return renderApprovalBox(lines, theme);
    }

    const summary = generateCompactDiff(before.content, validation.afterContent, targetPath, title);
    const hunkWord = summary.hunks.length === 1 ? "hunk" : "hunks";
    lines.push(
      theme.fg("accent", "✎ ") +
        theme.fg("toolTitle", `${toolName}  ${summary.fileName}`) +
        theme.fg(
          "dim",
          `  +${summary.additions} -${summary.deletions}  ${summary.hunks.length} ${hunkWord}`,
        ),
    );

    for (const hunk of summary.hunks) {
      lines.push("");
      lines.push(theme.fg("dim", `   @@ ${hunk.description || "(hunk)"}`));
      for (const hunkLine of hunk.lines) {
        const indent = "   ";
        if (hunkLine.startsWith("+")) {
          lines.push(theme.fg("success", indent + hunkLine));
        } else if (hunkLine.startsWith("-")) {
          lines.push(theme.fg("error", indent + hunkLine));
        } else if (hunkLine.startsWith(" ")) {
          lines.push(theme.fg("muted", indent + hunkLine));
        } else {
          lines.push(indent + hunkLine);
        }
      }
      if (hunk.truncated > 0) {
        const moreWord = hunk.truncated === 1 ? "line" : "lines";
        lines.push(theme.fg("dim", `   ... +${hunk.truncated} more ${moreWord} in this hunk`));
      }
    }
  } catch (error) {
    lines.push(theme.fg("accent", "✎ ") + theme.fg("toolTitle", `${toolName}  ${targetPath}`));
    lines.push("");
    lines.push(theme.fg("error", "Failed to render mutation preview."));
    lines.push(theme.fg("dim", error instanceof Error ? error.message : String(error)));
  }

  lines.push("");
  lines.push(renderApprovalHints(theme));
  state.mutationApprovalRender = { key: cacheKey, lines };
  return renderApprovalBox(lines, theme);
}

function renderMutationResult(
  result: { content: Array<{ type: string; text?: string }> },
  theme: any,
  context: { isError?: boolean },
): Container | Text {
  if (!context.isError) {
    return new Container();
  }

  const output = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .filter(Boolean)
    .join("\n");
  return new Text(theme.fg("error", output || "Tool failed"), 0, 0);
}

function renderApprovalHints(theme: any): string {
  return (
    theme.fg("accent", "A") +
    theme.fg("dim", " approve · ") +
    theme.fg("accent", "D") +
    theme.fg("dim", " deny · ") +
    theme.fg("accent", "E") +
    theme.fg("dim", "dit in nvim · ") +
    theme.fg("accent", "Ctrl+Alt+F") +
    theme.fg("dim", " expand/minimise")
  );
}

function renderApprovalBox(lines: string[], theme: any): Box {
  const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
  box.addChild(new Text(lines.join("\n"), 0, 0));
  return box;
}

function applyApprovedContent(
  toolName: "edit" | "write",
  input: Record<string, unknown>,
  before: FileSnapshot,
  approvedContent: string,
): void {
  if (toolName === "write") {
    input.content = approvedContent;
    return;
  }

  if (approvedContent !== before.content && before.content.length > 0) {
    input.edits = [
      { oldText: before.content, newText: approvedContent },
    ];
  }
}

function getPath(input: Record<string, unknown>): string {
  return typeof input.path === "string" && input.path.trim()
    ? input.path
    : "unknown-file.txt";
}

function getWriteContent(input: Record<string, unknown>): string {
  return typeof input.content === "string" ? input.content : "";
}

function buildFileChangeMetadata(
  toolName: "edit" | "write",
  targetPath: string,
  before: FileSnapshot,
  afterContent: string,
  input: Record<string, unknown>,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Tool", toolName],
    ["File", targetPath],
    ["Before", summarizeTextSize(before.content)],
    ["After", summarizeTextSize(afterContent)],
  ];

  if (toolName === "write") {
    rows.push(["Workflow", before.exists ? "overwrite existing file" : "new file"]);
  } else {
    rows.push(["Edit blocks", String(Array.isArray(input.edits) ? input.edits.length : 0)]);
  }

  if (before.binary) rows.push(["Existing file", "binary-like"]);
  if (before.unreadable) rows.push(["Existing file", "unreadable"]);
  return rows;
}

function summarizeTextSize(text: string): string {
  return `${countLines(text)} line(s), ${formatBytes(byteLength(text))}`;
}

function getLargeContentWarning(beforeContent: string, afterContent: string): string | null {
  const bytes = Math.max(byteLength(beforeContent), byteLength(afterContent));
  const lines = Math.max(countLines(beforeContent), countLines(afterContent));
  const warnings: string[] = [];
  if (bytes > 1_000_000) warnings.push(formatBytes(bytes));
  if (lines > 20_000) warnings.push(`${lines.toLocaleString()} lines`);
  return warnings.length ? `Large diff: ${warnings.join(" / ")}.` : null;
}

function isTmpFileMutation(toolName: string, input: unknown, cwd: string): boolean {
  if (toolName !== "edit" && toolName !== "write") return false;
  if (!isRecord(input)) return false;
  const absolutePath = resolve(cwd, getPath(input));
  return absolutePath === "/tmp" || absolutePath.startsWith("/tmp/");
}

function isSubagentChild(): boolean {
  return process.env.PI_SUBAGENT_CHILD === "1";
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function countLines(text: string): number {
  return text.length ? splitLines(text).length : 0;
}

function isLikelyBinaryText(text: string): boolean {
  return text.includes("\0");
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} byte(s)`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function fieldBlock(fields: Array<[string, string]>): string {
  const width = Math.max(...fields.map(([label]) => label.length));
  return fields.map(([label, value]) => `${label.padEnd(width)} : ${value}`).join("\n");
}

function section(title: string, body: string): string {
  return `── ${title} ──\n${body}`;
}

function joinSections(parts: string[]): string {
  return parts.filter(Boolean).join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
