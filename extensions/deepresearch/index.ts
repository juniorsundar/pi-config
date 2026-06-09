import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResearchCommand } from "./entrypoints/command";
import { registerDeepresearchTool } from "./entrypoints/tool";
import { getActiveRun, updateStatus, listRuns } from "./lifecycle/run-store";
import { ACTIVE_RUN_STATUSES } from "./domain/types";

/**
 * Pi-native Research Orchestrator extension entry point.
 *
 * Keeps startup composition thin: human command surface and high-level agent
 * tool are registered from dedicated entrypoint modules.
 */
export default function deepresearchEntryPoint(pi: ExtensionAPI): void {
  registerResearchCommand(pi);
  registerDeepresearchTool(pi);

  // Scan for orphaned active runs on session start (defense-in-depth for
  // crashes where session_shutdown couldn't fire, e.g. SIGKILL).
  // Analogous to subagents' reapOrphans() pattern.
  pi.on("session_start", async (_event, ctx) => {
    try {
      const cwd = ctx.cwd;
      const runs = listRuns(cwd);
      for (const run of runs) {
        if (ACTIVE_RUN_STATUSES.has(run.status as any)) {
          updateStatus(cwd, run.id, "interrupted", "Session crashed");
        }
      }
    } catch (err) {
      // Orphan scan is best-effort — never throw during startup.
      console.error("[deepresearch] session_start orphan scan error:", err);
    }
  });

  // Mark active Research Runs as interrupted on session shutdown (Issue 0034).
  // This prevents runs from being left in a dangling "running" state.
  // For "quit" the reason is "Pi shutdown"; for other reasons the extension
  // runtime is being replaced (reload, resume, new, fork) so the run is
  // interrupted with the corresponding event reason.
  pi.on("session_shutdown", async (event, ctx) => {
    try {
      const cwd = ctx.cwd;
      const activeRun = getActiveRun(cwd);
      if (!activeRun) return;

      const reason =
        event.reason === "quit"
          ? "Pi shutdown"
          : `Session ${event.reason}`;
      updateStatus(cwd, activeRun.id, "interrupted", reason);
    } catch (err) {
      // Shutdown marking is best-effort — never throw during shutdown.
      console.error("[deepresearch] session_shutdown handler error:", err);
    }
  });
}