import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { getStorePath } from "../workspace/store";
import type { RunMeta, RunStatus, RunSummary } from "../domain/types";
import { ACTIVE_RUN_STATUSES } from "../domain/types";
import { generateIdentity } from "../workspace/identity";

// Re-export for backward compatibility
export { generateIdentity };

// ── Run storage ─────────────────────────────────────────────────────────────

function statusPath(cwd: string, runId: string): string {
  return join(getStorePath(cwd), "runs", runId, "status.json");
}

function runDirPath(cwd: string, runId: string): string {
  return join(getStorePath(cwd), "runs", runId);
}

/**
 * Create a new Research Run from an approved Research Proposal.
 * Creates the run directory and writes initial status.json.
 * Initial status is `queued`.
 */
export function createRun(
  cwd: string,
  question: string,
  opts?: {
    mode?: "blocking" | "background";
    trigger?: string;
    triggerSource?: "human" | "agent" | "task";
    budgetLimits?: import("../domain/types").RunMeta["budgetLimits"];
  },
): RunMeta {
  const identity = generateIdentity(question);
  const now = new Date().toISOString();
  const runPath = runDirPath(cwd, identity.id);

  mkdirSync(runPath, { recursive: true });

  const meta: RunMeta = {
    identity,
    status: "queued",
    question,
    createdAt: now,
    updatedAt: now,
    mode: opts?.mode,
    trigger: opts?.trigger,
    triggerSource: opts?.triggerSource,
    budgetLimits: opts?.budgetLimits,
  };

  writeFileSync(statusPath(cwd, identity.id), JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * Read a run's metadata from its status.json.
 * Returns null if the run directory or status file does not exist.
 */
export function getRun(cwd: string, runId: string): RunMeta | null {
  const sp = statusPath(cwd, runId);
  if (!existsSync(sp)) return null;

  try {
    const raw = readFileSync(sp, "utf-8");
    return JSON.parse(raw) as RunMeta;
  } catch {
    return null;
  }
}

/**
 * List all runs in the workspace, sorted by identity (which is date-prefixed).
 */
export function listRuns(cwd: string): RunSummary[] {
  const runsDir = join(getStorePath(cwd), "runs");
  if (!existsSync(runsDir)) return [];

  const entries = readdirSync(runsDir, { withFileTypes: true });
  const runs: RunSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = getRun(cwd, entry.name);
    if (meta) {
      runs.push({
        id: meta.identity.id,
        status: meta.status,
        question: meta.question,
        mode: meta.mode,
      });
    }
  }

  return runs.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Update a run's lifecycle status. Persists to status.json immediately.
 * Throws if the run is not found.
 */
export function updateStatus(
  cwd: string,
  runId: string,
  status: RunStatus,
): RunMeta {
  const meta = getRun(cwd, runId);
  if (!meta) {
    throw new Error(`Run not found: ${runId}`);
  }

  meta.status = status;
  meta.updatedAt = new Date().toISOString();

  writeFileSync(statusPath(cwd, runId), JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * Return the currently active run (status is `running` or `synthesizing`),
 * or null if no run is active. Enforces the v1 one-active-run constraint by
 * design: only one run can be in an active status at a time.
 */
export function getActiveRun(cwd: string): RunSummary | null {
  const runs = listRuns(cwd);

  for (const run of runs) {
    if (ACTIVE_RUN_STATUSES.has(run.status)) {
      return run;
    }
  }

  return null;
}
