// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Approved budget limits for a Research Run.
 * All limits are hard caps enforced by the Research Orchestrator.
 */
export interface BudgetLimits {
  /** Maximum number of search queries. */
  maxSearches: number;
  /** Maximum number of fetch attempts (including failed fetches). */
  maxFetchAttempts: number;
  /** Maximum number of successful source visits (URL or local file). */
  maxSourceVisits: number;
  /** Maximum number of synthesis/brief-drafting rounds. */
  maxSynthesisRounds: number;
  /** Maximum number of model calls (all types, including extraction). */
  maxModelCalls: number;
  /** Maximum number of retry attempts for failed operations. */
  maxRetryAttempts: number;
  /** Maximum elapsed wall-clock seconds for the run. */
  maxElapsedSeconds: number;
}

/**
 * Accumulated usage counters for a Research Run.
 */
export interface BudgetUsage {
  searches: number;
  fetchAttempts: number;
  sourceVisits: number;
  synthesisRounds: number;
  modelCalls: number;
  retryAttempts: number;
}

/**
 * A Research Budget tracking approved limits and accumulated usage.
 */
export interface Budget {
  /** Approved hard limits. */
  limits: BudgetLimits;
  /** Accumulated usage. */
  usage: BudgetUsage;
  /** When the budget was created (ISO 8601). */
  startedAt: string;
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new budget with the approved limits and zero usage.
 */
export function createBudget(limits: BudgetLimits): Budget {
  return {
    limits: { ...limits },
    usage: {
      searches: 0,
      fetchAttempts: 0,
      sourceVisits: 0,
      synthesisRounds: 0,
      modelCalls: 0,
      retryAttempts: 0,
    },
    startedAt: new Date().toISOString(),
  };
}

// ── Usage tracking ──────────────────────────────────────────────────────────

/**
 * Track usage against a budget. Returns a new budget object (immutable-style).
 */
export function trackUsage(
  budget: Budget,
  usage: Partial<BudgetUsage>,
): Budget {
  const newUsage: BudgetUsage = {
    searches: budget.usage.searches + (usage.searches ?? 0),
    fetchAttempts: budget.usage.fetchAttempts + (usage.fetchAttempts ?? 0),
    sourceVisits: budget.usage.sourceVisits + (usage.sourceVisits ?? 0),
    synthesisRounds:
      budget.usage.synthesisRounds + (usage.synthesisRounds ?? 0),
    modelCalls: budget.usage.modelCalls + (usage.modelCalls ?? 0),
    retryAttempts: budget.usage.retryAttempts + (usage.retryAttempts ?? 0),
  };

  return {
    ...budget,
    usage: newUsage,
  };
}

// ── Limit enforcement ───────────────────────────────────────────────────────

/**
 * Check if any budget category has reached or exceeded its hard limit.
 * Usage counters use >= semantics (true hard cap: at limit = exhausted).
 * Elapsed time (if provided) also uses >=.
 */
export function isExhausted(budget: Budget, elapsedSeconds?: number): boolean {
  const usageExhausted =
    budget.usage.searches >= budget.limits.maxSearches ||
    budget.usage.fetchAttempts >= budget.limits.maxFetchAttempts ||
    budget.usage.sourceVisits >= budget.limits.maxSourceVisits ||
    budget.usage.synthesisRounds >= budget.limits.maxSynthesisRounds ||
    budget.usage.modelCalls >= budget.limits.maxModelCalls ||
    budget.usage.retryAttempts >= budget.limits.maxRetryAttempts;

  if (usageExhausted) return true;

  // Check elapsed time if provided
  if (elapsedSeconds !== undefined && elapsedSeconds >= budget.limits.maxElapsedSeconds) {
    return true;
  }

  return false;
}

/**
 * Return the remaining budget for each category (floored at zero).
 */
export function remainingBudget(budget: Budget): BudgetUsage {
  return {
    searches: Math.max(
      0,
      budget.limits.maxSearches - budget.usage.searches,
    ),
    fetchAttempts: Math.max(
      0,
      budget.limits.maxFetchAttempts - budget.usage.fetchAttempts,
    ),
    sourceVisits: Math.max(
      0,
      budget.limits.maxSourceVisits - budget.usage.sourceVisits,
    ),
    synthesisRounds: Math.max(
      0,
      budget.limits.maxSynthesisRounds - budget.usage.synthesisRounds,
    ),
    modelCalls: Math.max(
      0,
      budget.limits.maxModelCalls - budget.usage.modelCalls,
    ),
    retryAttempts: Math.max(
      0,
      budget.limits.maxRetryAttempts - budget.usage.retryAttempts,
    ),
  };
}
