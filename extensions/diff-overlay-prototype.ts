/**
 * Diff Overlay Prototype
 *
 * Renders a fixed diff (generated from two temp files via delta/diff) in a
 * floating Pi overlay. Invoked with /diff-overlay command.
 *
 * Purpose: validate that a Pi-native overlay can display delta/diff output
 * with scrolling and approve/deny keys — as a prototype for replacing the
 * full nvim spawn in confirm-mutating-tools.ts.
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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

// ── Overlay component ─────────────────────────────────────────────────

class DiffOverlayComponent {
  private theme: Theme;
  private tui: { requestRender: (force?: boolean) => void };
  private done: (result: "approve" | "deny") => void;
  private lines: string[] = [];
  private hunkStarts: number[] = [];
  private scrollOffset = 0;
  private title: string;
  private before: string;
  private after: string;
  private fileName: string;
  private generated = false;

  constructor(
    tui: { requestRender: (force?: boolean) => void },
    theme: Theme,
    title: string,
    before: string,
    after: string,
    fileName: string,
    done: (result: "approve" | "deny") => void,
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
        Math.max(0, this.lines.length - this.visibleContentHeight()),
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

    // Page down
    if (matchesKey(data, "pagedown") || data === "J" || matchesKey(data, "ctrl+d")) {
      const jump = Math.max(1, this.visibleContentHeight() - 2);
      this.scrollOffset = Math.min(
        Math.max(0, this.lines.length - this.visibleContentHeight()),
        this.scrollOffset + jump,
      );
      this.tui.requestRender();
      return;
    }

    // Page up
    if (matchesKey(data, "pageup") || data === "K" || matchesKey(data, "ctrl+u")) {
      const jump = Math.max(1, this.visibleContentHeight() - 2);
      this.scrollOffset = Math.max(0, this.scrollOffset - jump);
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
      this.scrollOffset = Math.max(0, this.lines.length - this.visibleContentHeight());
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

  private visibleContentHeight(totalHeight?: number): number {
    // Reserve: 1 top border + 1 scroll indicator + 1 footer
    const reserved = 3;
    const available = (totalHeight ?? 30) - reserved;
    return Math.max(1, available);
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
    const maxVisible = this.visibleContentHeight(30);
    const canScrollUp = this.scrollOffset > 0;
    const canScrollDown =
      this.scrollOffset + maxVisible < this.lines.length;
    const scrollPct =
      this.lines.length > 0
        ? Math.round(
            ((this.scrollOffset + maxVisible) / this.lines.length) * 100,
          )
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

    // ── Diff content ──
    const visibleLines = this.lines.slice(
      this.scrollOffset,
      this.scrollOffset + maxVisible,
    );
    for (const line of visibleLines) {
      result.push(border("│") + padLine(` ${line}`) + border("│"));
    }

    // Pad remaining content lines
    for (let i = visibleLines.length; i < maxVisible; i++) {
      result.push(border("│") + padLine("") + border("│"));
    }

    // ── Footer with keybindings ──
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
      th.fg("dim", " deny");
    result.push(
      border("│") + padLine(` ${keys}`) + border("│"),
    );

    // ── Bottom border ──
    result.push(
      border("╰") + border("─".repeat(innerW)) + border("╯"),
    );

    return result;
  }

  invalidate(): void {}
}

// ── Extension ─────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("diff-overlay", {
    description: "Prototype: show a fixed diff in a floating overlay",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const result = await ctx.ui.custom<"approve" | "deny">(
        (tui, theme, _kb, done) =>
          new DiffOverlayComponent(
            tui,
            theme,
            "Pi Approval | edit | src/greet.ts",
            FILE_A,
            FILE_B,
            "src/greet.ts",
            done,
          ),
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "90%",
            maxHeight: "80%",
          },
        },
      );

      ctx.ui.notify(
        `Result: ${result}`,
        result === "approve" ? "info" : "warning",
      );
    },
  });
}
