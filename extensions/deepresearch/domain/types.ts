/**
 * Lifecycle statuses for Research Proposals.
 */
export type ProposalStatus = "draft" | "approved" | "denied";

/**
 * Lifecycle statuses for Research Runs.
 *
 * - `queued`: Approved but waiting for an active run to finish.
 * - `readiness_failed`: Full Model Readiness Check failed — hard blocks execution.
 * - `running`: Source work is in progress.
 * - `synthesizing`: Research Brain is drafting the Research Brief.
 * - `completed`: Research Brief produced successfully (normal or forced_synthesis).
 * - `budget_exhausted`: Hard budget limit reached; best-effort brief may exist.
 * - `cancelled`: User cancelled before completion.
 * - `interrupted`: Pi shutdown or crash during an active run.
 * - `failed`: No trustworthy Research Brief was produced.
 */
export type RunStatus =
  | "queued"
  | "readiness_failed"
  | "running"
  | "synthesizing"
  | "completed"
  | "budget_exhausted"
  | "cancelled"
  | "interrupted"
  | "failed";

/**
 * Active statuses — these count against the one-active-run limit.
 */
export const ACTIVE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "running",
  "synthesizing",
]);

/**
 * Run identity components derived from a date, slug, and short ID.
 */
export interface RunIdentity {
  /** Full directory name: <date>-<slug>-<short-id> */
  id: string;
  /** ISO date prefix (YYYY-MM-DD). */
  date: string;
  /** Human-readable slug. */
  slug: string;
  /** 8-char hex short ID. */
  shortId: string;
}

/**
 * Research Run metadata stored alongside run artifacts.
 */
export interface RunMeta {
  /** Run identity. */
  identity: RunIdentity;
  /** Current lifecycle status. */
  status: RunStatus;
  /** The Research Question for this run. */
  question: string;
  /** When the run was created (ISO 8601). */
  createdAt: string;
  /** When the status was last updated (ISO 8601). */
  updatedAt: string;
  /** Optional: termination reason when status is terminal. */
  terminationReason?: string;
}

/**
 * Summary of a Research Proposal (lightweight, before approval).
 */
export interface ProposalSummary {
  id: string;
  status: ProposalStatus;
  question: string;
}

/**
 * Summary of a Research Run exposed to status queries.
 */
export interface RunSummary {
  id: string;
  status: RunStatus;
  question: string;
}

/**
 * Full workspace research status.
 */
export interface StatusResult {
  storePath: string;
  activeRun: RunSummary | null;
  proposals: ProposalSummary[];
  runs: RunSummary[];
}
