import type { ResearchBrain } from "../brain/harness/types.js";
import { quickReachability } from "../brain/setup-policy/setup-policy.js";
import { writeReachabilityDiagnostic } from "../brain/setup-policy/diagnostics.js";
import { createProposal, type ProposalInput, type ProposalMeta } from "./proposal-manager.js";

export type ProposeWithReadinessInput = ProposalInput;

export interface ProposalCreated {
  type: "proposal_created";
  meta: ProposalMeta;
  /** Always null for proposal_created — no diagnostic needed. */
  diagnosticPath: null;
  question: string;
  trigger: string;
}

export interface SetupBlocked {
  type: "setup_blocked";
  error: string;
  /** Guidance for the user on how to fix the setup. */
  guidance: string;
  /** Path to the written workspace diagnostic file. */
  diagnosticPath: string | null;
  meta: null;
  question: string;
  trigger: string;
}

export type ProposeResult = ProposalCreated | SetupBlocked;

/**
 * Create a Research Proposal with a quick reachability guard.
 *
 * Runs a minimal ping to the Research Brain before creating the proposal.
 * If the brain is unreachable, returns setup-blocked guidance and writes
 * a workspace diagnostic — no proposal or run is created.
 *
 * @param brain The ResearchBrain to test reachability against.
 * @param cwd Workspace root directory.
 * @param input Proposal creation input.
 */
export async function proposeWithReadiness(
  brain: ResearchBrain,
  cwd: string,
  input: ProposeWithReadinessInput,
): Promise<ProposeResult> {
  const reachability = await quickReachability(brain);

  if (!reachability.reachable) {
    const diagnosticPath = await writeReachabilityDiagnostic(
      cwd,
      "ollama", // model name resolved elsewhere; diagnostic records the error
      reachability,
    );

    return {
      type: "setup_blocked",
      error: reachability.error ?? "Research Brain model is unreachable",
      guidance:
        "The configured Research Brain model is not reachable. " +
        "Run `/research doctor` to diagnose the setup and check your Ollama configuration, " +
        "Modelfile template, and model availability. " +
        "Once the model is reachable, retry creating the proposal.",
      diagnosticPath,
      meta: null,
      question: input.question,
      trigger: input.trigger,
    };
  }

  const meta = createProposal(cwd, input);

  return {
    type: "proposal_created",
    meta,
    diagnosticPath: null,
    question: input.question,
    trigger: input.trigger,
  };
}
