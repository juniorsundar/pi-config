/**
 * Diff Overlay Prototype (expand / contract views)
 *
 * Two visual surfaces for reviewing a write/edit tool's proposed diff:
 *
 *   • Inline (contracted) — a compact diff card embedded in the conversation
 *     as a custom message. Default state when a diff is pending.
 *   • Overlay (expanded) — the full scrolling diff in a floating modal. Opened
 *     with Ctrl+Alt+F when an inline diff is pending.
 *
 * Both surfaces accept approve/deny. The inline surface captures plain `a`/`d`
 * via raw terminal input (Pi's `ctx.ui.onTerminalInput`); the overlay handles
 * its own keys via `handleInput`.
 *
 * Trigger flow (prototype): the slash commands `/diff-preview` and
 * `/diff-overlay` stand in for the eventual write/edit tool interception.
 * Before/after data plumbing is deferred — see project notes.
 *
 * Prototype limitations:
 *   • Plain `a`/`d` conflict with typing while a diff is pending. Acceptable
 *     for a prototype; the real flow pauses the editor when a diff awaits
 *     decision.
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Key, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Sample content for the prototype ──────────────────────────────────
// Large files with changes spread far apart so diff produces multiple separate hunks
// (default context is 3 lines, so we need >3 unchanged lines between changes).

const FILE_A = `import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// === Section 1: Imports & Setup ===
const VERSION = "1.0.0";
const DEFAULT_NAME = "world";

function greet(name: string): string {
  return "Hello, " + name + "!";
}

function farewell(name: string): string {
  return "Goodbye, " + name + "!";
}

// === Section 2: Core Logic ===
function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}

function power(base: number, exp: number): number {
  return Math.pow(base, exp);
}

// === Section 3: Collection Helpers ===
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

function reverse<T>(arr: T[]): T[] {
  return arr.slice().reverse();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// === Section 4: Async Utilities ===
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => { throw new Error("Timeout"); }),
  ]);
}

// === Section 5: String Utilities ===
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

const users = ["Alice", "Bob", "Charlie"];

for (const user of users) {
  console.log(greet(user));
}

export { greet, farewell, add, subtract, multiply, divide };
`;

const FILE_B = `import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

// === Section 1: Imports & Setup ===
const VERSION = "2.0.0";
const DEFAULT_NAME = "world";
const AUTHOR = "Pi Team";

function greet(name: string, formal = false): string {
  if (formal) {
    return "Good day, " + name + ".";
  }
  return "Hello, " + name + "!";
}

function farewell(name: string): string {
  return "Farewell, " + name + "!";
}

// === Section 2: Core Logic ===
function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}

function modulo(a: number, b: number): number {
  return a % b;
}

function power(base: number, exp: number): number {
  return Math.pow(base, exp);
}

// === Section 3: Collection Helpers ===
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

function reverse<T>(arr: T[]): T[] {
  return arr.slice().reverse();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function flatten<T>(arr: T[][]): T[] {
  return arr.flat();
}

// === Section 4: Async Utilities ===
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => { throw new Error("Timeout after " + ms + "ms"); }),
  ]);
}

function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  return fn().catch((err) => {
    if (attempts <= 1) throw err;
    return retry(fn, attempts - 1);
  });
}

// === Section 5: String Utilities ===
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function padLeft(s: string, width: number, char = " "): string {
  return s.length >= width ? s : char.repeat(width - s.length) + s;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

const users = ["Alice", "Bob", "Charlie", "Diana"];

for (const user of users) {
  console.log(greet(user));
  console.log(farewell(user));
}

export { greet, farewell, add, subtract, multiply, divide, modulo };
`;

// ── Diff generation ───────────────────────────────────────────────────

function generateDiff(
  before: string,
  after: string,
  fileName: string,
  width: number,
): string {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-diff-overlay-"));
  const beforePath = join(tempDir, "a.ts");
  const afterPath = join(tempDir, "b.ts");

  try {
    writeFileSync(beforePath, before, "utf8");
    writeFileSync(afterPath, after, "utf8");

    // Try delta first (inline diff with line numbers + syntax highlighting)
    // Pass --width so delta fills the overlay width (defaults to 80 when piped)
    // Use base16 syntax theme which inherits the terminal's 16 ANSI colors,
    // so it automatically matches the terminal colorscheme.
    const deltaResult = spawnSync(
      "delta",
      [
        "--width", String(width),
        "--syntax-theme", "base16",
        "--file-modified-label", `after (${fileName})`,
        "--file-removed-label", `before (${fileName})`,
        "--file-added-label", `after (${fileName})`,
        "--file-renamed-label", `renamed (${fileName})`,
        beforePath,
        afterPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          FORCE_COLOR: "1",
          COLORTERM: "truecolor",
          TERM: "xterm-256color",
        },
        encoding: "utf8",
      },
    );

    // delta returns exit code 1 when files differ (like diff), which is success for us
    if (deltaResult.stdout.trim()) {
      return deltaResult.stdout;
    }

    // Fallback: unified diff with color
    const diffResult = spawnSync(
      "diff",
      [
        "--color=always",
        "-u",
        "--label", `before/${fileName}`,
        "--label", `after/${fileName}`,
        beforePath,
        afterPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "1" },
        encoding: "utf8",
      },
    );

    // diff exits 1 when files differ — that's success for our purpose
    if (diffResult.stdout.trim()) {
      return diffResult.stdout;
    }

    return "(no diff output generated)";
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── Compact diff summary (for the inline card) ───────────────────────
//
// Re-parses the output of `diff -u` into a small, structured shape:
// counts, hunks, and the first N lines of each hunk for the inline card.
// ANSI escapes are stripped — the inline card uses simple +/- prefixes
// coloured via theme.fg rather than delta's full syntax theme.
//
// Note: we deliberately shell out to `diff -u` here instead of reusing
// generateDiff(). Delta at `--width 200` emits a side-by-side layout with
// no literal `+`/`-` prefixes on content lines (only `─────┐` hunk bars),
// which makes counts impossible. `diff -u` always produces a unified stream
// with `+`/`-` prefixes.

interface HunkSummary {
  description: string;
  lines: string[];
  truncated: number;
}

interface CompactDiff {
  fileName: string;
  title: string;
  additions: number;
  deletions: number;
  hunks: HunkSummary[];
}

const DEFAULT_MAX_LINES_PER_HUNK = 5;

function generateCompactDiff(
  before: string,
  after: string,
  fileName: string,
  title: string,
  maxLinesPerHunk: number = DEFAULT_MAX_LINES_PER_HUNK,
): CompactDiff {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-compact-"));
  const beforePath = join(tempDir, "a.ts");
  const afterPath = join(tempDir, "b.ts");

  try {
    writeFileSync(beforePath, before, "utf8");
    writeFileSync(afterPath, after, "utf8");

    // FORCE_COLOR=1 so we get ANSI codes; we strip them in the parser.
    // diff exits 1 when files differ — that's success for our purpose.
    const r = spawnSync(
      "diff",
      [
        "-u",
        "--label", `before/${fileName}`,
        "--label", `after/${fileName}`,
        beforePath,
        afterPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "1" },
        encoding: "utf8",
      },
    );

    const rawLines = r.stdout.split("\n");
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();

    let additions = 0;
    let deletions = 0;
    let currentHunk: HunkSummary | null = null;
    const hunks: HunkSummary[] = [];

    for (const rawLine of rawLines) {
      const stripped = rawLine.replace(/\x1b\[[0-9;]*[mK]/g, "");

      // Unified-diff hunk header: @@ -10,7 +10,8 @@ [optional description]
      if (stripped.startsWith("@@")) {
        if (currentHunk) hunks.push(currentHunk);
        // Try to extract a function-style description first (e.g. the
        // text after the second @@ in "@@ -1,3 +1,4 @@ greet()").
        const trailing = stripped.match(/@@[^@]*@@\s*(.*)/)?.[1]?.trim();
        let desc: string;
        if (trailing) {
          desc = trailing;
        } else {
          // Fall back to a line-range description so the user still sees
          // something useful — diff often has no function context for
          // terse changes.
          const range = stripped.match(/@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
          if (range) {
            const oStart = parseInt(range[1]!, 10);
            const oLen = parseInt(range[2] ?? "1", 10);
            const nStart = parseInt(range[3]!, 10);
            const nLen = parseInt(range[4] ?? "1", 10);
            desc = `lines ${oStart}–${oStart + oLen - 1} → ${nStart}–${nStart + nLen - 1}`;
          } else {
            desc = "(hunk)";
          }
        }
        currentHunk = { description: desc, lines: [], truncated: 0 };
        continue;
      }

      // Skip diff metadata (file labels).
      if (
        stripped.startsWith("--- ") ||
        stripped.startsWith("+++ ") ||
        stripped.startsWith("Index: ") ||
        stripped.startsWith("diff --git ")
      ) {
        continue;
      }

      if (stripped.startsWith("+")) additions++;
      else if (stripped.startsWith("-")) deletions++;

      if (currentHunk) {
        if (currentHunk.lines.length < maxLinesPerHunk) {
          currentHunk.lines.push(stripped);
        } else {
          currentHunk.truncated++;
        }
      }
    }

    if (currentHunk) hunks.push(currentHunk);

    return { fileName, title, additions, deletions, hunks };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── Overlay component ─────────────────────────────────────────────────

class DiffOverlayComponent {
  private theme: Theme;
  private tui: { requestRender: (force?: boolean) => void; terminal: { rows: number } };
  private done: (result: "approve" | "deny" | "dismiss") => void;
  private lines: string[] = [];
  private hunkStarts: number[] = [];
  private scrollOffset = 0;
  private title: string;
  private before: string;
  private after: string;
  private fileName: string;
  private generated = false;

  constructor(
    tui: { requestRender: (force?: boolean) => void; terminal: { rows: number } },
    theme: Theme,
    title: string,
    before: string,
    after: string,
    fileName: string,
    done: (result: "approve" | "deny" | "dismiss") => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.title = title;
    this.before = before;
    this.after = after;
    this.fileName = fileName;
    this.done = done;
  }

  private ensureDiff(width: number): void {
    if (this.generated) return;
    this.generated = true;
    // Subtract 2 for the border chars (│...│) and 1 for the leading space
    const diffWidth = Math.max(20, width - 3);
    const diffOutput = generateDiff(this.before, this.after, this.fileName, diffWidth);
    this.lines = diffOutput.split("\n");
    // Remove trailing empty line if present
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] === "") {
      this.lines.pop();
    }
    // Build hunk index: delta uses ─────┐ markers, unified diff uses @@
    this.hunkStarts = [];
    for (let i = 0; i < this.lines.length; i++) {
      const stripped = this.lines[i]!.replace(/\x1b\[[0-9;]*[mK]/g, "");
      if (stripped.includes("─────┐") || stripped.startsWith("@@")) {
        this.hunkStarts.push(i);
      }
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done("deny");
      return;
    }

    // Ctrl+Alt+F — shrink back to inline (toggle, no decision made)
    if (matchesKey(data, "ctrl+alt+f")) {
      this.done("dismiss");
      return;
    }

    // Approve
    if (data === "a" || data === "A") {
      this.done("approve");
      return;
    }

    // Deny
    if (data === "d" || data === "D") {
      this.done("deny");
      return;
    }

    // Scroll
    if (matchesKey(data, "down") || data === "j") {
      this.scrollOffset = Math.min(
        this.lines.length - 1,
        this.scrollOffset + 1,
      );
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "up") || data === "k") {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.tui.requestRender();
      return;
    }

    // Page down — fixed page size; the overlay clips the actual viewport.
    const PAGE_SIZE = 20;

    if (matchesKey(data, "pageDown") || data === "J" || matchesKey(data, "ctrl+d")) {
      this.scrollOffset = Math.min(
        this.lines.length - 1,
        this.scrollOffset + PAGE_SIZE,
      );
      this.tui.requestRender();
      return;
    }

    // Page up
    if (matchesKey(data, "pageUp") || data === "K" || matchesKey(data, "ctrl+u")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - PAGE_SIZE);
      this.tui.requestRender();
      return;
    }

    // Jump to top
    if (data === "g") {
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }

    // Jump to bottom
    if (data === "G") {
      this.scrollOffset = Math.max(0, this.lines.length - 1);
      this.tui.requestRender();
      return;
    }

    // Next hunk: ]
    if (data === "]") {
      const nextIdx = this.hunkStarts.findIndex((h) => h > this.scrollOffset);
      if (nextIdx !== -1) {
        this.scrollOffset = Math.max(0, this.hunkStarts[nextIdx]! - 1);
      } else if (this.hunkStarts.length > 0) {
        // Wrap to first hunk
        this.scrollOffset = Math.max(0, this.hunkStarts[0]! - 1);
      }
      this.tui.requestRender();
      return;
    }

    // Previous hunk: [
    if (data === "[") {
      let prevIdx = -1;
      for (let i = this.hunkStarts.length - 1; i >= 0; i--) {
        if (this.hunkStarts[i]! < this.scrollOffset) {
          prevIdx = i;
          break;
        }
      }
      if (prevIdx !== -1) {
        this.scrollOffset = Math.max(0, this.hunkStarts[prevIdx]! - 1);
      } else if (this.hunkStarts.length > 0) {
        // Wrap to last hunk
        const last = this.hunkStarts.length - 1;
        this.scrollOffset = Math.max(0, this.hunkStarts[last]! - 1);
      }
      this.tui.requestRender();
      return;
    }
  }

  render(width: number): string[] {
    // Generate diff lazily on first render so we know the actual width
    this.ensureDiff(width);

    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const border = (c: string) => th.fg("border", c);
    const padLine = (s: string) => {
      const vw = visibleWidth(s);
      if (vw > innerW) return truncateToWidth(s, innerW, "", true);
      return s + " ".repeat(Math.max(0, innerW - vw));
    };

    const result: string[] = [];

    // ── Top border with title ──
    const titleStr = ` ${this.title} `;
    const titleVW = visibleWidth(th.fg("accent", titleStr));
    const leftDash = Math.floor((innerW - titleVW) / 2);
    const rightDash = Math.max(0, innerW - titleVW - leftDash);
    result.push(
      border("╭") +
        border("─".repeat(leftDash)) +
        th.fg("accent", titleStr) +
        border("─".repeat(rightDash)) +
        border("╮"),
    );

    // ── Line count + scroll info ──
    const canScrollUp = this.scrollOffset > 0;
    const canScrollDown = this.scrollOffset < this.lines.length - 1;
    const scrollPct =
      this.lines.length > 0
        ? Math.round((this.scrollOffset / this.lines.length) * 100)
        : 100;
    const scrollInfo = [
      `${this.lines.length} lines`,
      canScrollUp || canScrollDown ? `scroll ${scrollPct}%` : null,
      this.hunkStarts.length > 0 ? `${this.hunkStarts.length} hunk(s)` : null,
    ]
      .filter(Boolean)
      .join(" │ ");
    result.push(
      border("│") +
        padLine(th.fg("dim", ` ${scrollInfo}`)) +
        border("│"),
    );

    // ── Compute how many content lines fit in the overlay ──
    //
    // overlayOptions: maxHeight 80%, margin bottom 6, anchor center.
    // We derive the available content rows from the terminal height so
    // the bottom border always renders at a fixed position.
    const terminalRows = this.tui.terminal.rows;
    const overlayHeight = Math.max(10, Math.floor(terminalRows * 0.8) - 6);
    const fixedLines = 4; // top border + scroll info + footer + bottom border
    const maxContent = Math.max(1, overlayHeight - fixedLines);

    // ── Footer with keybindings (always visible, above content) ──
    const keys =
      th.fg("accent", "A") +
      th.fg("dim", "pprove  ") +
      th.fg("accent", "D") +
      th.fg("dim", "eny  ") +
      th.fg("accent", "↑↓") +
      th.fg("dim", "/") +
      th.fg("accent", "jk") +
      th.fg("dim", " scroll  ") +
      th.fg("accent", "[]") +
      th.fg("dim", " hunk  ") +
      th.fg("accent", "g/G") +
      th.fg("dim", " top/bot  ") +
      th.fg("accent", "Esc") +
      th.fg("dim", " deny  ") +
      th.fg("accent", "Ctrl+Alt+F") +
      th.fg("dim", " shrink");
    result.push(
      border("│") + padLine(` ${keys}`) + border("│"),
    );

    // ── Diff content ──
    for (let i = 0; i < maxContent; i++) {
      const lineIdx = this.scrollOffset + i;
      if (lineIdx < this.lines.length) {
        result.push(border("│") + padLine(` ${this.lines[lineIdx]!}`) + border("│"));
      } else {
        result.push(border("│") + padLine("") + border("│"));
      }
    }

    // ── Bottom border (fixed position, always visible) ──
    result.push(
      border("╰") + border("─".repeat(innerW)) + border("╯"),
    );

    return result;
  }

  invalidate(): void {}
}

// ── Extension ─────────────────────────────────────────────────────────

// ── Pending diff state ──────────────────────────────────────────────
//
// Closure-scoped inside the extension factory so it can call pi.appendEntry
// without exporting `pi` to module scope. Persisted to the session so a
// pending diff survives a session reload.

interface PendingDiff {
  before: string;
  after: string;
  fileName: string;
  title: string;
}

const PENDING_ENTRY_TYPE = "diff-preview-state";

interface PendingStateEntry {
  cleared?: true;
  before?: string;
  after?: string;
  fileName?: string;
  title?: string;
}

export default function (pi: ExtensionAPI) {
  // Closure-scoped state. Not exported.
  let pending: PendingDiff | null = null;
  let overlayOpen = false;
  let unsubscribeTerminal: (() => void) | null = null;

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

  // Shared overlay opener used by /diff-overlay (hardcoded sample) and
  // Ctrl+Alt+F (the currently-pending diff). Emits a verdict message and
  // clears the pending state on either decision.
  async function openOverlay(ctx: ExtensionCommandContext, diff: PendingDiff): Promise<void> {
    overlayOpen = true;
    try {
      const result = await ctx.ui.custom<"approve" | "deny" | "dismiss">(
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
            // Bottom margin keeps the overlay above the editor + footer.
            margin: { bottom: 6 },
          },
        },
      );

      // Dismiss = Ctrl+Alt+F toggle — close overlay without deciding.
      // Inline card and pending state survive so the user can review again.
      if (result !== "dismiss") {
        emitVerdict(result, diff.fileName);
        setPending(null);
      }
    } finally {
      overlayOpen = false;
    }
  }

  // ── Renderers ──────────────────────────────────────────────────────

  // "diff-preview" — the compact inline card. Stateless w.r.t. the pending
  // flag; the card always shows the same diff body. After A/D, a separate
  // "diff-verdict" message is emitted below.
  pi.registerMessageRenderer("diff-preview", (message, _options, theme) => {
    const summary = message.details as CompactDiff;
    const lines: string[] = [];

    // Header: tool icon + label + file + counts + hunk count.
    const hunkWord = summary.hunks.length === 1 ? "hunk" : "hunks";
    lines.push(
      theme.fg("accent", "✎ ") +
        theme.fg("toolTitle", `edit  ${summary.fileName}`) +
        theme.fg("dim", `  +${summary.additions} -${summary.deletions}  ${summary.hunks.length} ${hunkWord}`),
    );

    // Per-hunk blocks.
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

    // Footer: key hints. Accent on the key letters, dim on the labels.
    lines.push("");
    lines.push(
      theme.fg("accent", "Ctrl+Alt+F") +
        theme.fg("dim", " expand · ") +
        theme.fg("accent", "A") +
        theme.fg("dim", " approve · ") +
        theme.fg("accent", "D") +
        theme.fg("dim", " deny"),
    );

    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  });

  // "diff-verdict" — one-liner confirmation, sits beneath the inline card
  // after the user approves or denies.
  pi.registerMessageRenderer("diff-verdict", (message, _options, theme) => {
    const details = message.details as { verdict: "approved" | "denied"; fileName?: string };
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

  // /diff-overlay — open the overlay directly with the hardcoded sample.
  // Useful for testing the overlay surface in isolation; the "real" flow
  // uses Ctrl+Alt+F on a pending diff instead.
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

  // /diff-preview — inject the compact inline card into the conversation
  // and mark the diff as pending. Ctrl+Alt+F then expands it.
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

  // ── Ctrl+Alt+F shortcut — expand the pending diff ───────────────────
  //
  // ctrl+alt+letter has a universal legacy fallback: \x1b + control char.
  // Previous Ctrl+Shift+F had no legacy fallback — only worked via
  // Kitty/modifyOtherKeys protocols, breaking in tmux/screen/older terminals.
  // ctrl+alt+f is not bound by Pi. Mnemonic: F = "Full" view.

  pi.registerShortcut(Key.ctrlAlt("f"), {
    description: "Expand pending inline diff to full overlay",
    handler: (ctx) => {
      if (overlayOpen) {
        ctx.ui.notify("Diff overlay already open", "warning");
        return;
      }
      if (!pending) {
        // Bumped from info → warning so it isn't dismissed unnoticed.
        // If you see this, Ctrl+Alt+F did fire — pending was just cleared by an
        // earlier inline A/D. Run /diff-preview to inject a new card.
        ctx.ui.notify("No diff pending — run /diff-preview first", "warning");
        return;
      }
      // Open directly — shortcut handlers receive ExtensionContext, not
      // ExtensionCommandContext. The IIFE keeps `pending` referenced safely
      // inside the await chain.
      void (async () => {
        overlayOpen = true;
        try {
          const current = pending;
          if (!current) return;
          const result = await ctx.ui.custom<"approve" | "deny" | "dismiss">(
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

          // Dismiss = Ctrl+Alt+F toggle — close overlay without deciding.
          if (result !== "dismiss") {
            // pending may have been cleared by inline A/D while we were
            // opening the overlay; emit verdict regardless for feedback.
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

    // Restore pending diff from the session (survives /reload).
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i] as
        | { type: string; customType?: string; data?: PendingStateEntry }
        | undefined;
      if (entry?.type === "custom" && entry.customType === PENDING_ENTRY_TYPE) {
        const data = entry.data;
        if (data && !data.cleared && data.before && data.after && data.fileName && data.title) {
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

    // Clean up a stale subscription if session_start fires twice (e.g. /reload).
    if (unsubscribeTerminal) {
      unsubscribeTerminal();
      unsubscribeTerminal = null;
    }

    // Raw terminal input capture for inline A/D. Only consumes keys when
    // (a) a diff is pending and (b) the overlay is NOT open (so the overlay
    // keeps its own A/D). Otherwise passes through to the editor.
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
