import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadBtwTimeout } from "./timeout-config.js";
import { createRegistry, type BtwChildProcess } from "./registry.js";
import { SpinningListComponent } from "./spinning-list.js";
import { BtwReviewComponent } from "./review.js";
import { spawnBtwProcess } from "./spawner.js";
import { truncate } from "./text-utils.js";

// Module-level BTW registry shared across the extension lifetime.
// Persists across /new, /fork, /reload within the same process.
const btwRegistry = createRegistry();

export default function btwExtension(pi: ExtensionAPI) {
  // BTW Child Guard: skip registration when running as a BTW child process
  if (process.env.PI_BTW_CHILD) return;

  // Set up the Spinning List widget above the editor once on startup.
  // The widget reads fresh state from the registry on each render.
  pi.on("session_start", async (_event, ctx) => {
    btwRegistry.clear(); // fresh slate for new session

    ctx.ui.setWidget(
      "btw-spinning-list",
      (tui) => new SpinningListComponent(btwRegistry, tui),
      { placement: "aboveEditor" },
    );
  });

  // Clean up running BTW processes on session shutdown.
  // Completed results are preserved so the BTW Review remains available
  // within the session. A fresh clear() happens on the next session_start.
  pi.on("session_shutdown", async () => {
    btwRegistry.killAll();
  });

  pi.registerCommand("btw", {
    description: "Ask a side-question or review BTW results",
    handler: async (args: string, ctx) => {
      if (!args.trim()) {
        // No-args: open BTW Review with completed results
        await ctx.ui.custom((tui, theme, keybindings, done) =>
          new BtwReviewComponent(btwRegistry.getCompleted(), tui, theme, done, keybindings),
        );
        return;
      }

      // Strip surrounding quotes from query
      const query = args.trim().replace(/^["']|["']$/g, "").trim();
      if (!query) {
        await ctx.ui.notify("BTW: empty question.", "warning");
        return;
      }

      // Load timeout from settings
      const { timeout } = loadBtwTimeout();

      // Get session file for fork (null = ephemeral)
      const sessionFile = ctx.sessionManager.getSessionFile() ?? null;

      // Generate unique ID for this BTW process
      const btwId = generateBtwId();

      try {
        const abortController = new AbortController();
        const result = await spawnBtwProcess({
          sessionFile,
          query,
          cwd: ctx.cwd,
          timeoutMs: timeout,
          signal: abortController.signal,
          onSpawn: (child) => {
            btwRegistry.addRunning(btwId, query, child as BtwChildProcess, abortController);
          },
        });

        if (result.ok) {
          btwRegistry.complete(btwId, {
            type: "success",
            text: result.text,
            toolTrace: result.toolTrace,
            usage: result.usage,
            model: result.model,
            stopReason: result.stopReason,
          });
          await ctx.ui.notify(`BTW: ${truncate(result.text, 200)}`, "info");
        } else {
          btwRegistry.fail(btwId, result.errorMessage, {
            exitCode: result.exitCode,
            stderr: result.stderr,
            toolTrace: result.toolTrace,
            partialText: result.partialText,
          });
          await ctx.ui.notify(`BTW error: ${result.errorMessage}`, "error");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        btwRegistry.fail(btwId, message);
        await ctx.ui.notify(`BTW failed: ${message}`, "error");
      }
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function generateBtwId(): string {
  return `btw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
