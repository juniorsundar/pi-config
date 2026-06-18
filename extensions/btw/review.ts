/**
 * btw — BTW Review Component.
 *
 * A full-screen TUI view for reviewing completed BTW results.
 * Renders entries newest-first, most recent expanded by default,
 * older collapsed, with keyboard navigation and expand/collapse.
 *
 * Pass to ctx.ui.custom() to open:
 *
 *   const component = new BtwReviewComponent(
 *     registry.getCompleted(), tui, theme, done
 *   );
 *   ctx.ui.custom(component);
 */

import type { CompletedEntry } from "./registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip ANSI SGR escape sequences from a string.
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Return the visible (ANSI-stripped) width of a string.
 */
function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Truncate a string so that its visible width does not exceed `maxWidth`.
 * Strips ANSI codes first, truncates plain text, then appends ellipsis.
 * This avoids corrupting partial escape sequences.
 */
function truncateToWidth(str: string, maxWidth: number, ellipsis = "…"): string {
  const plain = stripAnsi(str);
  if (plain.length <= maxWidth) return str;
  // Truncate the plain text, then find where that truncation corresponds
  // in the original string by matching prefix character by character
  const keepLen = maxWidth - ellipsis.length;
  let visibleCount = 0;
  let resultEnd = 0;
  for (let i = 0; i < str.length && visibleCount < keepLen; i++) {
    const ch = str[i];
    // Skip ANSI escape sequences without counting them
    if (ch === "\x1b") {
      // Consume the escape sequence: \x1b [ 0-9;... m
      while (i < str.length && str[i] !== "m") i++;
      resultEnd = i + 1; // include the 'm'
      continue;
    }
    visibleCount++;
    resultEnd = i + 1;
  }
  return str.slice(0, resultEnd) + ellipsis;
}

// ---------------------------------------------------------------------------
// Minimal interfaces for testability
// ---------------------------------------------------------------------------

export interface BtwReviewTuiLike {
  requestRender(): void;
}

export interface BtwReviewThemeLike {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BtwReviewKeybindingsLike {
  matches(data: string, keybinding: string): boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class BtwReviewComponent {
  private selectedIndex = 0;
  private expandedIndices: Set<number> = new Set();
  private toolTraceExpandedIndices: Set<number> = new Set();

  constructor(
    private readonly entries: readonly CompletedEntry[],
    private readonly tui: BtwReviewTuiLike,
    private readonly theme: BtwReviewThemeLike,
    public readonly onClose: () => void,
    private readonly keybindings?: BtwReviewKeybindingsLike,
  ) {
    // Most recent entry (index 0 in newest-first order) expanded by default
    if (entries.length > 0) {
      this.expandedIndices.add(0);
    }
    // Tool traces default to collapsed
  }

  // ── Component interface ───────────────────────────────────────────

  render(width: number): string[] {
    return this.computeRender(width);
  }

  private computeRender(width: number): string[] {
    if (this.entries.length === 0) {
      return [this.theme.fg("muted", "No completed BTW results yet.")];
    }

    const lines: string[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const isSelected = i === this.selectedIndex;
      const isExpanded = this.expandedIndices.has(i);
      const prefix = isSelected ? this.theme.fg("accent", ">") : " ";
      const icon = entry.result.type === "success"
        ? this.theme.fg("success", "✓")
        : this.theme.fg("error", "✗");

      // Header line — truncate to fit width
      const header = `${prefix} ${icon} btw: ${entry.query}`;
      lines.push(truncateToWidth(header, width));

      // Expanded content
      if (isExpanded) {
        const contentIndent = 2;
        const contentWidth = Math.max(1, width - contentIndent);
        const resultLines = this.renderExpandedContent(entry, contentWidth);
        for (const rl of resultLines) {
          lines.push(`  ${truncateToWidth(rl, contentWidth)}`);
        }
      }
    }
    return lines;
  }

  private renderExpandedContent(entry: CompletedEntry, contentWidth: number): string[] {
    const lines: string[] = [];
    const result = entry.result;

    // Usage stats (only for success results)
    if (result.type === "success") {
      const { usage } = result;
      const usageParts: string[] = [];
      if (usage.input) usageParts.push(`↑${this.formatTokens(usage.input)}`);
      if (usage.output) usageParts.push(`↓${this.formatTokens(usage.output)}`);
      if (usage.cacheRead) usageParts.push(`R${this.formatTokens(usage.cacheRead)}`);
      if (usage.cacheWrite) usageParts.push(`W${this.formatTokens(usage.cacheWrite)}`);
      if (usage.cost !== undefined && usage.cost > 0) usageParts.push(`$${usage.cost.toFixed(4)}`);
      if (result.model) usageParts.push(result.model);
      if (result.stopReason) usageParts.push(result.stopReason);
      if (usageParts.length > 0) {
        lines.push(this.theme.fg("dim", usageParts.join(" ")));
      }
    }

    // Separator — dynamic width
    const sepLen = Math.min(contentWidth, 40);
    lines.push(this.theme.fg("muted", "─".repeat(sepLen)));

    // Tool trace — collapsed by default
    if (result.toolTrace.length > 0) {
      const traceCount = result.toolTrace.length;
      const isTraceExpanded = this.toolTraceExpandedIndices.has(
        this.entries.indexOf(entry),
      );
      if (isTraceExpanded) {
        lines.push(this.theme.fg("muted", "▾ Tool trace"));
        for (const tool of result.toolTrace) {
          lines.push(`  ${this.renderToolCall(tool.toolName, tool.args)}`);
        }
      } else {
        lines.push(
          this.theme.fg("muted", `▸ Tool trace (${traceCount} ${traceCount === 1 ? "tool" : "tools"})`),
        );
      }
    }

    // Result content
    if (result.type === "success") {
      lines.push(this.theme.fg("toolOutput", result.text));
    } else {
      lines.push(this.theme.fg("error", `Error: ${result.error}`));
      if (result.exitCode !== undefined) {
        lines.push(this.theme.fg("dim", `Exit code: ${result.exitCode}`));
      }
      if (result.stderr) {
        lines.push(this.theme.fg("dim", result.stderr));
      }
    }

    return lines;
  }

  private formatTokens(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    return `${(count / 1000000).toFixed(1)}M`;
  }

  private renderToolCall(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case "read":
      case "edit":
      case "write":
      case "ls": {
        const filePath = (args.file_path || args.path || "...") as string;
        return `${this.theme.fg("muted", "→")} ${this.theme.fg("muted", `${toolName} `)}${this.theme.fg("accent", filePath)}`;
      }
      case "bash": {
        const command = (args.command || "") as string;
        const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
        return `${this.theme.fg("muted", "→")} ${this.theme.fg("muted", "$ ")}${this.theme.fg("toolOutput", preview)}`;
      }
      case "grep": {
        const pattern = (args.pattern || "") as string;
        return `${this.theme.fg("muted", "→")} ${this.theme.fg("muted", `grep /${pattern}/`)}`;
      }
      case "find": {
        const pattern = (args.pattern || "*") as string;
        const filePath = (args.path || ".") as string;
        return `${this.theme.fg("muted", "→")} ${this.theme.fg("muted", `find `)}${this.theme.fg("accent", pattern)}${this.theme.fg("dim", ` in ${filePath}`)}`;
      }
      default: {
        const argsStr = JSON.stringify(args);
        const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
        return `${this.theme.fg("muted", "→")} ${this.theme.fg("accent", toolName)}${this.theme.fg("dim", ` ${preview}`)}`;
      }
    }
  }

  handleInput(data: string): void {
    // Escape works regardless of entries state
    if (data === "\x1b") {
      this.onClose();
      return;
    }

    if (this.entries.length === 0) return;

    if (data === "\x1b[A") {
      // Up arrow
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.tui.requestRender();
      }
    } else if (data === "\x1b[B") {
      // Down arrow
      if (this.selectedIndex < this.entries.length - 1) {
        this.selectedIndex++;
        this.tui.requestRender();
      }
    } else if (
      data === "\r" || data === "\x0f" ||
      (this.keybindings?.matches(data, "tui.select.confirm") ?? false)
    ) {
      // Enter, Ctrl+O, or configured confirm key
      const entry = this.entries[this.selectedIndex];
      const isExpanded = this.expandedIndices.has(this.selectedIndex);
      const hasToolTrace = isExpanded && entry?.result.toolTrace.length > 0;

      if (hasToolTrace) {
        // If entry is expanded and has tool trace, toggle tool trace
        if (this.toolTraceExpandedIndices.has(this.selectedIndex)) {
          this.toolTraceExpandedIndices.delete(this.selectedIndex);
        } else {
          this.toolTraceExpandedIndices.add(this.selectedIndex);
        }
      } else {
        // Otherwise toggle entry expand/collapse
        if (this.expandedIndices.has(this.selectedIndex)) {
          this.expandedIndices.delete(this.selectedIndex);
        } else {
          this.expandedIndices.add(this.selectedIndex);
        }
      }
      this.tui.requestRender();
    }
  }

  invalidate(): void {
    // No caching — render reads state fresh each time
  }
}
