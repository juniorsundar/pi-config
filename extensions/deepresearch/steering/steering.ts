/**
 * Steering Instruction processor for v1 Limited Steering.
 *
 * Processes steering instructions (cancel, force_synthesis, add_instruction)
 * and returns a SteeringResult indicating what action the run loop should take.
 *
 * All steering instructions are recorded as ProcessedSteeringEntry objects
 * that can be appended to the ledger.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { getStorePath } from "../workspace/store";
import type { Budget } from "../budgets/budget";
import type { RunMeta } from "../domain/types";
import type { ProcessedSteeringEntry, SteeringInstructionType, SteeringStatus, SteeringResult } from "./types";
import type { LedgerEntry } from "../run-loop/types";

// ── Signal file path ────────────────────────────────────────────────────────

/**
 * Path to the steering signal file for a run.
 * The command handler writes this file; the run loop reads and clears it.
 */
export function steeringSignalPath(cwd: string, runId: string): string {
  return join(getStorePath(cwd), "runs", runId, "steering-signal.json");
}

// ── Signal types ────────────────────────────────────────────────────────────

/**
 * A steering signal written by the command handler and consumed by the run loop.
 */
export interface SteeringSignal {
  /** ISO 8601 timestamp of when the signal was written. */
  timestamp: string;
  /** Instruction type. */
  type: SteeringInstructionType;
  /** User-provided text, if any. */
  text?: string;
}

// ── Write / Read / Clear steering signal ────────────────────────────────────

/**
 * Write a steering signal to the run directory.
 * Used by the command handler to signal the run loop.
 */
export function writeSteeringSignal(
  cwd: string,
  runId: string,
  signal: SteeringSignal,
): void {
  writeFileSync(steeringSignalPath(cwd, runId), JSON.stringify(signal, null, 2));
}

/**
 * Read and clear a pending steering signal from the run directory.
 * Used by the run loop to check for steering instructions.
 * Returns null if no signal is pending or the signal is invalid.
 *
 * Note: This uses a non-atomic read-then-unlink pattern. In rare cases
 * a concurrent writer could write between read and unlink. This is acceptable
 * for v1 since the command handler and run loop are not actually concurrent
 * (both run in the same Pi session).
 */
export function readAndClearSteeringSignal(
  cwd: string,
  runId: string,
): SteeringSignal | null {
  const path = steeringSignalPath(cwd, runId);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    const signal = JSON.parse(raw);
    // Validate signal structure
    if (
      typeof signal !== "object" ||
      signal === null ||
      typeof (signal as any).timestamp !== "string" ||
      typeof (signal as any).type !== "string" ||
      !["cancel", "force_synthesis", "add_instruction"].includes((signal as any).type)
    ) {
      // Invalid structure: clear the file and return null
      try { unlinkSync(path); } catch {}
      return null;
    }
    unlinkSync(path); // Clear signal after reading
    return signal as SteeringSignal;
  } catch {
    // If read or parse fails, clear the corrupt file and return null
    try { unlinkSync(path); } catch {}
    return null;
  }
}

// ── Scope validation for add_instruction ────────────────────────────────────

/**
 * Maximum allowed scope expansion ratio for add_instruction.
 * Instructions that would increase the Evidence Mix by more than this ratio
 * are rejected as scope-broadening.
 */
const MAX_SCOPE_EXPANSION_RATIO = 0.5;

/**
 * Keywords that indicate scope broadening when present in an instruction.
 * These suggest a substantially new comparison axis or topic area.
 */
const SCOPE_BROADENING_KEYWORDS = [
  "also compare",
  "also consider",
  "instead of",
  "compare with",
  "versus",
  "vs",
  "in addition to",
  "add",
  "broaden",
  "expand",
  "including",
  // New comparison axes
  "migrate",
  "rewrite",
  "alternative",
  "instead",
];

/**
 * Keywords that indicate acceptable narrowing, prioritizing, or clarifying.
 */
const ACCEPTABLE_NARROWING_KEYWORDS = [
  "focus",
  "narrow",
  "prioritize",
  "exclude",
  "skip",
  "ignore",
  "concentrate",
  "emphasize",
  "prefer",
  "favor",
  "especially",
  "specifically",
  "clarify",
  "refine",
  "limit",
  "restrict",
];

/**
 * Validate whether an add_instruction stays within the approved scope.
 *
 * Returns an object with:
 * - `valid`: true if the instruction is acceptable
 * - `reason`: human-readable explanation if rejected
 * - `status`: "applied" or "rejected"
 *
 * @param runMeta - Reserved for future use (e.g., checking instruction against
 *   the Research Question). Currently consumed by `processAddInstruction`
 *   signature compatibility.
 */
export function validateInstruction(
  instructionText: string,
  runMeta: RunMeta,
  evidenceCategories: string[],
): { valid: boolean; reason: string; status: SteeringStatus } {
  const lower = instructionText.toLowerCase();

  // Step 1: Check if mentioned categories are entirely within the approved Evidence Mix
  // Run this before narrowing/broadening keyword checks so that instructions
  // mentioning categories in the approved mix are accepted even with keywords
  // like "benchmarks" that are also in SCOPE_BROADENING_KEYWORDS.
  const mentionedCategories = evidenceCategories.length > 0 && instructionText.length > 10
    ? extractMentionedCategories(instructionText)
    : [];
  const newCategories = mentionedCategories.filter(
    (cat) => !evidenceCategories.some((ec) =>
      ec.toLowerCase() === cat.toLowerCase() ||
      ec.toLowerCase().includes(cat.toLowerCase()) ||
      cat.toLowerCase().includes(ec.toLowerCase()),
    ),
  );

  // If new categories significantly expand the mix, reject
  if (newCategories.length > evidenceCategories.length * MAX_SCOPE_EXPANSION_RATIO) {
    return {
      valid: false,
      reason:
        `Instruction introduces new evidence categories (${newCategories.join(", ")}) ` +
        `that are not part of the approved Evidence Mix (${evidenceCategories.join(", ")}). ` +
        "Scope-expanding instructions require a continuation or new Research Proposal.",
      status: "rejected",
    };
  }

  // Step 2: Check for scope-broadening keywords
  // Do this BEFORE narrowing keyword check so a broadening instruction
  // phrased with narrowing language (e.g. "focus on comparing with X") is rejected.
  const hasBroadening = SCOPE_BROADENING_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasBroadening) {
    return {
      valid: false,
      reason:
        "Instruction appears to broaden scope " +
        "(contains keywords suggesting a new comparison axis or topic expansion). " +
        "Scope-broadening instructions are not allowed without a continuation or new Research Proposal.",
      status: "rejected",
    };
  }

  // Step 3: Check for narrowing/clarifying keywords — accept
  const isNarrowing = ACCEPTABLE_NARROWING_KEYWORDS.some((kw) => lower.includes(kw));
  if (isNarrowing) {
    return { valid: true, reason: "Narrowing/clarifying instruction accepted.", status: "applied" };
  }

  // Step 4: Default — accept as within-scope prioritization/exclusion
  return { valid: true, reason: "Within-scope instruction accepted.", status: "applied" };
}

/**
 * Heuristically extract evidence category names from an instruction text.
 * Used for scope validation.
 */
function extractMentionedCategories(text: string): string[] {
  // Common evidence category names to detect
  const commonCategories = [
    "docs", "documentation", "official docs",
    "source code", "code", "implementation",
    "benchmarks", "performance", "benchmark",
    "changelog", "release notes", "changelogs",
    "issues", "issue tracker", "bugs",
    "users", "user reports", "feedback",
    "alternatives", "competitors", "competing",
    "articles", "reviews", "blog posts",
    "tutorials", "guides", "how-to",
    "api", "apis", "sdk", "sdks",
    "pricing", "cost", "license",
    "community", "forum", "discussions",
    "security", "vulnerabilities", "cve",
  ];

  const lower = text.toLowerCase();
  return commonCategories.filter((cat) => lower.includes(cat));
}

// ── Process cancel ──────────────────────────────────────────────────────────

function processCancel(
  signal: { timestamp: string; text?: string },
  budget: Budget,
): SteeringResult {
  return {
    action: "stop",
    stopReason: signal.text ?? "User cancelled the run.",
    entry: {
      timestamp: signal.timestamp,
      type: "cancel",
      text: signal.text,
      budgetState: {
        searches: budget.usage.searches,
        fetchAttempts: budget.usage.fetchAttempts,
        sourceVisits: budget.usage.sourceVisits,
        modelCalls: budget.usage.modelCalls,
      },
      status: "applied",
      applicationDetails: signal.text
        ? `Run cancelled by user: ${signal.text}`
        : "Run cancelled by user.",
    },
  };
}

// ── Process force_synthesis ────────────────────────────────────────

function processForceSynthesis(
  signal: { timestamp: string; text?: string },
  sourceNoteCount: number,
  budget: Budget,
): SteeringResult {
  if (sourceNoteCount === 0) {
    return {
      action: "continue",
      synthesisReason: undefined,
      entry: {
        timestamp: signal.timestamp,
        type: "force_synthesis",
        text: signal.text,
        budgetState: {
          searches: budget.usage.searches,
          fetchAttempts: budget.usage.fetchAttempts,
          sourceVisits: budget.usage.sourceVisits,
          modelCalls: budget.usage.modelCalls,
        },
        status: "rejected",
        applicationDetails:
          "Force synthesis refused: no Source Notes exist yet. " +
          "Cannot produce a Research Brief without any extracted evidence.",
      },
    };
  }

  return {
    action: "synthesize",
    synthesisReason: signal.text
      ? `User forced synthesis: ${signal.text}`
      : "User forced synthesis with partial evidence.",
    entry: {
      timestamp: signal.timestamp,
      type: "force_synthesis",
      text: signal.text,
      budgetState: {
        searches: budget.usage.searches,
        fetchAttempts: budget.usage.fetchAttempts,
        sourceVisits: budget.usage.sourceVisits,
        modelCalls: budget.usage.modelCalls,
      },
      status: "applied",
      applicationDetails: sourceNoteCount > 0
        ? `Force synthesis accepted with ${sourceNoteCount} source note(s). ` +
          "Brief will be caveated as user-forced synthesis with partial evidence."
        : "Force synthesis accepted without Source Notes — no caveat needed.",
    },
  };
}

// ── Process add_instruction ────────────────────────────────────────

function processAddInstruction(
  signal: { timestamp: string; text?: string },
  runMeta: RunMeta,
  evidenceCategories: string[],
  budget: Budget,
): SteeringResult {
  if (!signal.text) {
    return {
      action: "continue",
      entry: {
        timestamp: signal.timestamp,
        type: "add_instruction",
        budgetState: {
          searches: budget.usage.searches,
          fetchAttempts: budget.usage.fetchAttempts,
          sourceVisits: budget.usage.sourceVisits,
          modelCalls: budget.usage.modelCalls,
        },
        status: "deferred",
        applicationDetails: "Add instruction received but no instruction text was provided.",
      },
    };
  }

  // Validate scope
  const validation = validateInstruction(signal.text, runMeta, evidenceCategories);

  if (!validation.valid) {
    return {
      action: "continue",
      entry: {
        timestamp: signal.timestamp,
        type: "add_instruction",
        text: signal.text,
        budgetState: {
          searches: budget.usage.searches,
          fetchAttempts: budget.usage.fetchAttempts,
          sourceVisits: budget.usage.sourceVisits,
          modelCalls: budget.usage.modelCalls,
        },
        status: "rejected",
        applicationDetails: validation.reason,
      },
    };
  }

  // Accepted
  return {
    action: "continue",
    entry: {
      timestamp: signal.timestamp,
      type: "add_instruction",
      text: signal.text,
      budgetState: {
        searches: budget.usage.searches,
        fetchAttempts: budget.usage.fetchAttempts,
        sourceVisits: budget.usage.sourceVisits,
        modelCalls: budget.usage.modelCalls,
      },
      status: "applied",
      applicationDetails: `Instruction applied: "${signal.text}". The run loop will incorporate this narrowing/prioritizing constraint.`,
    },
  };
}

// ── Main processing entry point ─────────────────────────────────────────────

/**
 * Process a steering signal and return the result.
 *
 * @param signal - The steering signal to process
 * @param runMeta - Current run metadata
 * @param sourceNoteCount - Current number of Source Notes
 * @param budget - Current budget state
 * @param evidenceCategories - Approved evidence categories from the proposal
 * @returns Result with action for the run loop and ledger entry
 */
export function processSteeringSignal(
  signal: SteeringSignal,
  runMeta: RunMeta,
  sourceNoteCount: number,
  budget: Budget,
  evidenceCategories: string[] = [],
): SteeringResult {
  switch (signal.type) {
    case "cancel":
      return processCancel(signal, budget);
    case "force_synthesis":
      return processForceSynthesis(signal, sourceNoteCount, budget);
    case "add_instruction":
      return processAddInstruction(signal, runMeta, evidenceCategories, budget);
    default:
      return {
        action: "continue",
        entry: {
          timestamp: signal.timestamp,
          type: signal.type,
          budgetState: {
            searches: budget.usage.searches,
            fetchAttempts: budget.usage.fetchAttempts,
            sourceVisits: budget.usage.sourceVisits,
            modelCalls: budget.usage.modelCalls,
          },
          status: "deferred",
          applicationDetails: `Unknown steering instruction type: "${signal.type}".`,
        },
      };
  }
}

// ── Format steering entry for ledger ────────────────────────────────────────

/**
 * Format a ProcessedSteeringEntry as a ledger JSON object.
 */
export function steeringEntryToLedger(entry: ProcessedSteeringEntry): LedgerEntry {
  return {
    round: -1, // steering events happen outside the round cycle
    intent: `steering:${entry.type}`,
    timestamp: entry.timestamp,
    content: entry.applicationDetails,
    meta: {
      instructionType: entry.type,
      text: entry.text,
      budgetState: entry.budgetState,
      status: entry.status,
      applicationDetails: entry.applicationDetails,
    },
  };
}