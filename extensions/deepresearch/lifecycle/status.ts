import { getStorePath } from "../workspace/store";
import { listRuns, getActiveRun } from "./run-store";
import { listProposals } from "../proposals/proposal-manager";
import type { StatusResult } from "../domain/types";

/**
 * Get the workspace research status.
 * Queries the Workspace Research Store for active run, proposals, and runs.
 */
export function getStatus(cwd: string): StatusResult {
  const storePath = getStorePath(cwd);

  return {
    storePath,
    activeRun: getActiveRun(cwd),
    proposals: listProposals(cwd),
    runs: listRuns(cwd),
  };
}
