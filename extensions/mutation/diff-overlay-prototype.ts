/**
 * Diff Overlay Prototype — extension factory.
 *
 * Two visual surfaces for reviewing a write/edit tool's proposed diff:
 *
 *   • Inline (contracted) — a compact diff card embedded in the conversation
 *     as a custom message. Default state when a diff is pending.
 *   • Overlay (expanded) — the full scrolling diff in a floating modal. Opened
 *     with Ctrl+Alt+F when an inline diff is pending.
 *
 * Both surfaces accept approve/deny/edit-in-nvim. The inline surface captures
 * plain `a`/`d`/`e` via raw terminal input (Pi's `ctx.ui.onTerminalInput`);
 * the overlay handles its own keys via `handleInput`.
 *
 * Trigger flow (prototype): the slash commands `/diff-preview` and
 * `/diff-overlay` stand in for the eventual write/edit tool interception.
 * Before/after data plumbing is deferred — see project notes.
 *
 * Prototype limitations:
 *   • Plain `a`/`d`/`e` conflict with typing while a diff is pending.
 *     Acceptable for a prototype; the real flow pauses the editor when a diff
 *     awaits decision.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Key, Text } from "@earendil-works/pi-tui";
import { DiffOverlayComponent, type OverlayResult } from "./overlay-component";
import { generateCompactDiff, type CompactDiff } from "./diff-generation";
import { FILE_A, FILE_B } from "./sample-data";
import {
  runNeovimDiffApproval,
  commandExists,
  validateAndApplyEditPreview,
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
  let unsubscribeTerminal: (() => void) | null = null;
  // Captured from session_start so openNeovimForPending can use the real ui.
  let sessionCtx: UiContext | null = null;

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
      pi.sendMessage({
        customType: "diff-verdict",
        content: "Neovim not found — install nvim to use E",
        display: true,
        details: { verdict: "denied", fileName: pending.fileName },
      });
      return;
    }

    // Use pending.before directly (works for both prototype sample data
    // and real tool calls where before is already populated).
    let beforeContent = pending.before;

    // Compute after-content: use toolInput if available (real tool call),
    // otherwise fall back to the stored pending.after (slash command sample).
    let afterContent = pending.after;
    if (pending.toolName === "edit" && pending.toolInput) {
      const validation = validateAndApplyEditPreview(beforeContent, pending.toolInput);
      afterContent = validation.afterContent;
    } else if (pending.toolName === "write" && pending.toolInput) {
      afterContent =
        typeof pending.toolInput.content === "string"
          ? pending.toolInput.content
          : pending.after;
    }

    const metadata: Array<[string, string]> = [
      ["Tool", pending.toolName ?? "edit"],
      ["File", pending.fileName],
    ];

    const result = await runNeovimDiffApproval(
      sessionCtx,
      {
        toolName: pending.toolName ?? "edit",
        targetPath: pending.fileName,
        beforeContent,
        afterContent,
        metadata,
      },
    );

    if (result.decision === "approve") {
      if (
        typeof result.approvedContent === "string" &&
        result.approvedContent !== afterContent
      ) {
        // User edited the diff in nvim — update stored after content.
        pending.after = result.approvedContent;
      }
      emitVerdict("approve", pending.fileName);
      setPending(null);
    }
    // deny: keep pending, user can try again
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
      } else {
        emitVerdict(result, diff.fileName);
        setPending(null);
      }
    } finally {
      overlayOpen = false;
    }
  }

  // ── Renderers ──────────────────────────────────────────────────────

  pi.registerMessageRenderer("diff-preview", (message, _options, theme) => {
    const summary = message.details as CompactDiff;
    const lines: string[] = [];

    const hunkWord = summary.hunks.length === 1 ? "hunk" : "hunks";
    lines.push(
      theme.fg("accent", "✎ ") +
        theme.fg("toolTitle", `edit  ${summary.fileName}`) +
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
        lines.push(
          theme.fg("dim", `   ... +${hunk.truncated} more ${moreWord} in this hunk`),
        );
      }
    }

    lines.push("");
    lines.push(
      theme.fg("accent", "Ctrl+Alt+F") +
        theme.fg("dim", " expand · ") +
        theme.fg("accent", "A") +
        theme.fg("dim", " approve · ") +
        theme.fg("accent", "D") +
        theme.fg("dim", " deny · ") +
        theme.fg("accent", "E") +
        theme.fg("dim", "dit in nvim"),
    );

    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  });

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

  // ── Commands ───────────────────────────────────────────────────────

  pi.registerCommand("diff-overlay", {
    description: "Prototype: show a fixed diff in a floating overlay",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const sampleDiff: PendingDiff = {
        before: FILE_A,
        after: FILE_B,
        fileName: "src/greet.ts",
        title: "Pi Approval | edit | src/greet.ts",
      };
      await openOverlay(ctx, sampleDiff);
    },
  });

  pi.registerCommand("diff-preview", {
    description: "Prototype: show a compact diff card in the conversation",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      const fileName = "src/greet.ts";
      const title = "Pi Approval | edit | src/greet.ts";
      const compact = generateCompactDiff(FILE_A, FILE_B, fileName, title);
      pi.sendMessage({
        customType: "diff-preview",
        content: `${fileName}  +${compact.additions} -${compact.deletions}  ${compact.hunks.length} hunk(s)`,
        display: true,
        details: compact satisfies CompactDiff,
      });
      setPending({
        before: FILE_A,
        after: FILE_B,
        fileName,
        title,
      });
    },
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
        ctx.ui.notify("No diff pending — run /diff-preview first", "warning");
        return;
      }
      void (async () => {
        overlayOpen = true;
        try {
          const current = pending;
          if (!current) return;
          const result = await ctx.ui.custom<OverlayResult>(
            (tui, theme, _kb, done) =>
              new DiffOverlayComponent(
                tui,
                theme,
                current.title,
                current.before,
                current.after,
                current.fileName,
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
          } else {
            emitVerdict(result, current.fileName);
            setPending(null);
          }
        } finally {
          overlayOpen = false;
        }
      })();
    },
  });

  // ── Session lifecycle ──────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // Capture the real session context so openNeovimForPending can use
    // ctx.ui.custom() to suspend the TUI and open Neovim.
    sessionCtx = {
      cwd: process.cwd(),
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
        emitVerdict("approve");
        setPending(null);
        return { consume: true };
      }
      if (data === "d" || data === "D") {
        emitVerdict("deny");
        setPending(null);
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
