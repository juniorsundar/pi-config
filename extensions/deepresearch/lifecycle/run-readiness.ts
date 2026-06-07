import { readinessGate, ReadinessError, type ResolvedModel } from "../brain/setup-policy/setup-policy.js";
import type { BrainWithModel } from "../brain/setup-policy/setup-policy.js";
import { writeRunReadinessDiagnostic } from "../brain/setup-policy/diagnostics.js";
import { updateStatus } from "./run-store.js";
import type { RunMeta } from "../domain/types.js";

export interface RunReadinessResult {
  ready: boolean;
  testedModel: string;
  testedProvider: string;
  status: "running" | "readiness_failed";
}

/**
 * Run the full Model Readiness Check after approval and before source work.
 *
 * On pass: transitions the run to `running` and returns the result.
 * On failure: writes run diagnostics, transitions to `readiness_failed`,
 *   and throws — hard-blocking execution.
 *
 * Must be called with the exact resolved Research Brain model.
 */
export async function runReadinessGate(
  cwd: string,
  runId: string,
  resolved: ResolvedModel,
  brain: BrainWithModel,
): Promise<RunReadinessResult> {
  try {
    const result = await readinessGate(resolved, brain);

    // Transition to running
    updateStatus(cwd, runId, "running");

    return {
      ready: true,
      testedModel: result.testedModel,
      testedProvider: result.testedProvider,
      status: "running",
    };
  } catch (err) {
    // Write run diagnostics using actual harness results when available
    const harness = err instanceof ReadinessError
      ? err.harness
      : {
          results: [],
          summary: err instanceof Error ? err.message : String(err),
          diagnostics: [err instanceof Error ? err.message : String(err)],
          passed: 0,
          recoverable: 0,
          failed: 1,
        };

    await writeRunReadinessDiagnostic(cwd, runId, harness);

    // Transition to readiness_failed — stable artifact
    try {
      updateStatus(cwd, runId, "readiness_failed");
    } catch {
      // If status update fails, still throw the original error
    }

    throw err;
  }
}
