/**
 * Validate that a Research Trigger describes an external, decision-relevant
 * uncertainty suitable for a Research Run, rather than a routine lookup,
 * local-codebase exploration, or curiosity-only query.
 *
 * Preconditions:
 * - Caller must ensure the trigger is a non-empty string.
 *   Presence checks belong to the tool entrypoint and proposal-manager,
 *   not this semantic validator.
 */

export type TriggerValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Check whether a Research Trigger represents a valid external
 * decision-relevant uncertainty suitable for a Research Proposal.
 *
 * Returns `{ valid: false, reason }` for triggers that are routine
 * lookups, local-codebase exploration, or curiosity-only queries
 * without a decision context.
 */
export function validateTrigger(trigger: string): TriggerValidationResult {
  // Guard against non-string input from JSON deserialization.
  if (typeof trigger !== "string") {
    return {
      valid: false,
      reason: "Research Trigger must be a non-empty string.",
    };
  }

  const normalized = trigger.trim().toLowerCase();

  // ── Local-codebase exploration detection ────────────────────────────
  // Reject triggers seeking info within the current project rather than
  // external sources. Check BEFORE routine lookup to catch overlaps.
  if (isLocalCodebaseExploration(normalized)) {
    return {
      valid: false,
      reason:
        "This trigger appears to be local-codebase exploration rather than " +
        "an external decision-relevant uncertainty. Use normal tools " +
        "(bash, grep, read, find) to explore the codebase. Research " +
        "Proposals require external research triggers — technology " +
        "comparisons, API behavior, benchmarks, pricing, etc.",
    };
  }

  // ── Routine lookup detection ───────────────────────────────────────
  // Reject pure fact-finding questions that lack a decision context.
  if (isRoutineLookup(normalized)) {
    return {
      valid: false,
      reason:
        "This trigger appears to be a routine lookup or fact-finding query " +
        "without a decision context. Use the normal search tool (web_search) " +
        "or read local files instead. Research Proposals require an external, " +
        "decision-relevant uncertainty (e.g., technology comparison, " +
        "API behavior check, architecture choice).",
    };
  }

  // ── Curiosity-only detection ───────────────────────────────────────
  // Reject triggers expressing interest without a concrete decision.
  if (isCuriosityOnly(normalized)) {
    return {
      valid: false,
      reason:
        "This trigger appears to be curiosity-driven without a clear " +
        "decision context. Research Proposals require an external, " +
        "decision-relevant uncertainty. If you have a concrete decision " +
        "to make (technology choice, architecture decision, API evaluation), " +
        "rephrase the trigger to name the decision and why it matters now.",
    };
  }

  return { valid: true };
}

// ── Detection helpers ──────────────────────────────────────────────────

const LOCAL_CODEBASE_PATTERNS = [
  /^find\b/i,
  /^where\b/i,
  /^search\s+for\b/i,
  /^grep\b/i,
  /^locate\b/i,
  /\b(in\s+this\s+(project|repo|codebase|module))\b/i,
  /\b(our\s+(project|codebase|repo))\b/i,
];

function isLocalCodebaseExploration(trigger: string): boolean {
  return LOCAL_CODEBASE_PATTERNS.some((p) => p.test(trigger));
}

const ROUTINE_LOOKUP_PATTERNS = [
  /^what\s+is\s+(the\s+)?(current\s+)?(version|syntax|api)\b/i,
  /^what\s+(is|are|does|do)\b/i,
  /^how\s+(does|do|to)\b/i,
  /^(explain|describe|list|tell me)\b/i,
];

const CURIOSITY_ONLY_PATTERNS = [
  /\bi\s+wonder\b/i,
  /\binteresting\s+to\s+(know|see|find\s+out)\b/i,
  /\bi('|\s+)m\s+curious\b/i,
  /\bwould\s+be\s+(nice|good|interesting)\s+to\s+(know|see|find\s+out)\b/i,
  /\bjust\s+(curious|wondering)\b/i,
  /\bcurious\s+about\b/i,
];

function isCuriosityOnly(trigger: string): boolean {
  return CURIOSITY_ONLY_PATTERNS.some((p) => p.test(trigger));
}

function isRoutineLookup(trigger: string): boolean {
  return ROUTINE_LOOKUP_PATTERNS.some((p) => p.test(trigger));
}
