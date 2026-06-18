/**
 * btw — Spinning List Widget.
 *
 * A TUI widget rendered above the editor showing running BTW Processes.
 * Displays a header with progress count and one spinner line per active
 * query.  Reads fresh state from the BtwRegistry on every render, so
 * it automatically reflects entries being completed/failed/cleared.
 *
 * Spinner animation is driven by a setInterval that cycles the frame
 * index and calls tui.requestRender() every ~160ms.  Cleans up on
 * dispose().
 */

import type { BtwRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Spinner frames
// ---------------------------------------------------------------------------

/**
 * 4-frame braille spinner — one moving dot in a 2×2 grid.
 * Same set as rpiv-warp/title-spinner.ts.  Reads as a 3-dot cluster
 * with a hole rotating clockwise.
 */
export const SPINNER_FRAMES: readonly string[] = ["⠴", "⠦", "⠖", "⠲"];

/** Tick rate for spinner animation (ms). */
export const SPINNER_INTERVAL_MS = 160;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Minimal TUI surface that SpinningListComponent depends on.
 */
export interface TuiLike {
  requestRender(): void;
  terminal: { rows: number };
}

export class SpinningListComponent {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: BtwRegistry,
    private readonly tui: TuiLike,
  ) {
    this.startAnimation();
  }

  // ── Component interface ───────────────────────────────────────────

  render(width: number): string[] {
    const running = this.registry.getRunning();
    if (running.length === 0) return [];

    const completed = this.registry.getCompleted();
    const total = running.length + completed.length;
    const spinner = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];

    const lines: string[] = [`● btw (${completed.length}/${total})`];

    for (let i = 0; i < running.length; i++) {
      const prefix = i === running.length - 1 ? " └─ " : " ├─ ";

      // Compute available width for the question text.
      // prefix = 4 chars (e.g. " └─ "), spinner = 2 chars, space = 1 char
      const qAvail = Math.max(0, width - 4 - 2 - 1);
      const text = qAvail < running[i].query.length
        ? running[i].query.slice(0, Math.max(0, qAvail - 1)) + "…"
        : running[i].query;

      const question = text.length === 0 ? " " : text;
      lines.push(`${prefix}${spinner} ${question}`);
    }

    return lines;
  }

  handleInput(_data: string): void {
    // No input handling needed — the spinning list is display-only.
  }

  invalidate(): void {
    // No state to invalidate; render() reads fresh from registry each call.
  }

  // ── Animation ─────────────────────────────────────────────────────

  private startAnimation(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.frame++;
      this.tui.requestRender();
    }, SPINNER_INTERVAL_MS);
    if (typeof (this.timer as NodeJS.Timeout).unref === "function") {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ── Testing support ───────────────────────────────────────────────

  /** Exposed for tests: get or set the current animation frame index. */
  get currentFrame(): number {
    return this.frame;
  }

  set currentFrame(f: number) {
    this.frame = f;
  }
}
