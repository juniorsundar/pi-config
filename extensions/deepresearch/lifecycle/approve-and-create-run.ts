import { copyFileSync } from "fs";
import { join } from "path";
import { approveProposal } from "../proposals/proposal-manager";
import { createRun, getActiveRun, getRun } from "./run-store";
import { runReadinessGate, type RunReadinessResult } from "./run-readiness";
import type { ResolvedModel, BrainWithModel } from "../brain/setup-policy/setup-policy";
import { getStorePath } from "../workspace/store";
import type { RunMeta } from "../domain/types";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the filesystem path for a proposal's proposal.md. */
function proposalMdPath(cwd: string, proposalId: string): string {
  return join(getStorePath(cwd), "proposals", proposalId, "proposal.md");
}

/** Resolve the filesystem path for a run's proposal.md copy. */
function runProposalMdPath(cwd: string, runId: string): string {
  return join(getStorePath(cwd), "runs", runId, "proposal.md");
}

// ── Approve + Create ───────────────────────────────────────────────────────

/**
 * Approve a draft Research Proposal and create a Research Run.
 *
 * 1. Validates and approves the proposal via `approveProposal`
 *    (re-reads proposal.md, validates required fields, transitions to "approved").
 * 2. Creates a Research Run with the proposal's question, mode, trigger, and
 *    budget limits carried over. The run starts in `queued` status.
 * 3. Copies the approved `proposal.md` into the run directory as the
 *    human-readable approved request artifact.
 *
 * The caller is responsible for deciding whether to activate the run
 * immediately or leave it queued based on the one-active-run constraint.
 *
 * @param cwd Workspace root directory.
 * @param proposalId The proposal identity to approve.
 * @returns The created (queued) Research Run metadata.
 * @throws If the proposal is not found, not in draft status, or fails validation.
 */
export function approveAndCreateRun(
  cwd: string,
  proposalId: string,
): RunMeta {
  // 1. Approve the proposal (validates + transitions to "approved")
  //    Do this BEFORE createRun: if approval fails (invalid proposal),
  //    no orphan run directory is left behind.
  const approved = approveProposal(cwd, proposalId);

  // 2. Create a Research Run with carried-over proposal content
  const run = createRun(cwd, approved.question, {
    mode: approved.mode,
    trigger: approved.trigger,
    budgetLimits: approved.budget,
  });

  // 3. Copy the approved proposal.md into the run directory
  copyFileSync(proposalMdPath(cwd, proposalId), runProposalMdPath(cwd, run.identity.id));

  return run;
}

// ── Approve + Activate ────────────────────────────────────────────────────

/** Result of approving a proposal and conditionally activating the run. */
export interface ApproveAndActivateResult {
  /** The created Research Run metadata. */
  run: RunMeta;
  /** Whether the run was activated (readiness checked + transitioned to running). */
  activated: boolean;
  /** Readiness result if activated, null if queued. */
  activationResult: RunReadinessResult | null;
}

/**
 * Approve a draft Research Proposal, create a Research Run, and conditionally
 * activate it based on the one-active-run constraint.
 *
 * 1. Validates, approves, creates the run, and copies proposal.md
 *    (same as `approveAndCreateRun`).
 * 2. Checks whether another run is currently active.
 * 3. If no active run: runs the full Model Readiness Check and transitions
 *    to `running` on success. On failure, transitions to `readiness_failed`
 *    and throws — the caller receives the error and can inspect the stable
 *    readiness_failed artifact.
 * 4. If another run is active: leaves the new run in `queued` status.
 *
 * @param cwd Workspace root directory.
 * @param proposalId The proposal identity to approve.
 * @param resolved The resolved Research Brain model for the readiness check.
 * @param brain The Research Brain instance for the readiness check.
 * @returns The result including run metadata, activation status, and readiness result.
 * @throws If the proposal is not found, not in draft status, fails validation,
 *   or readiness fails during activation.
 */
export async function approveAndActivateRun(
  cwd: string,
  proposalId: string,
  resolved: ResolvedModel,
  brain: BrainWithModel,
): Promise<ApproveAndActivateResult> {
  // 1. Approve and create the queued run
  const run = approveAndCreateRun(cwd, proposalId);

  // 2. Check the one-active-run constraint
  const activeRun = getActiveRun(cwd);

  if (activeRun) {
    // Another run is active — leave queued
    return {
      run,
      activated: false,
      activationResult: null,
    };
  }

  // 3. No active run — run readiness gate and activate
  // Note: runReadinessGate transitions the run to "running" on success
  // or "readiness_failed" on failure (and throws)
  const activationResult = await runReadinessGate(
    cwd,
    run.identity.id,
    resolved,
    brain,
  );

  // Re-read the run to get the updated status (runReadinessGate updates it)
  const updatedRun = getRun(cwd, run.identity.id);

  return {
    run: updatedRun ?? run,
    activated: true,
    activationResult,
  };
}
