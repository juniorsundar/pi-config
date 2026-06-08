/**
 * Steering Instruction types for v1 Limited Steering.
 *
 * Cancel: stop the run without producing a Research Brief.
 * ForceSynthesis: produce a Research Brief after the current step (refused if no Source Notes).
 * AddInstruction: narrow, prioritize, exclude, or clarify within the approved Research Question.
 */
export type SteeringInstructionType = "cancel" | "force_synthesis" | "add_instruction";

/**
 * Status of a steering instruction after processing.
 */
export type SteeringStatus = "applied" | "rejected" | "deferred";

/**
 * A user-provided steering instruction for an active Research Run.
 */
export interface SteeringInstruction {
  /** Instruction type. */
  type: SteeringInstructionType;
  /** ISO 8601 timestamp of when the instruction was written. */
  timestamp: string;
  /** User-provided text (for add_instruction) or reason (for cancel). */
  text?: string;
  /** Budget state at the time the instruction was written (embedded before processing). */
  budgetState?: {
    searches: number;
    fetchAttempts: number;
    sourceVisits: number;
    modelCalls: number;
  };
}

/**
 * A steering instruction that has been processed and recorded in the ledger.
 */
export interface ProcessedSteeringEntry {
  /** ISO 8601 timestamp of when the instruction was issued. */
  timestamp: string;
  /** Instruction type. */
  type: SteeringInstructionType;
  /** User-provided text, if any. */
  text?: string;
  /** Budget state at the time of the instruction. */
  budgetState?: {
    searches: number;
    fetchAttempts: number;
    sourceVisits: number;
    modelCalls: number;
  };
  /** Whether the instruction was applied, rejected, or deferred. */
  status: SteeringStatus;
  /** Human-readable detail about how the instruction was handled. */
  applicationDetails: string;
}

/**
 * Result of processing a steering instruction.
 */
export interface SteeringResult {
  /** The processed entry to record in the ledger. */
  entry: ProcessedSteeringEntry;
  /** Action the loop should take. */
  action: "continue" | "stop" | "synthesize";
  /** If synthesize, a reason for the brief caveat. */
  synthesisReason?: string;
  /** If stop, the reason for stopping. */
  stopReason?: string;
}