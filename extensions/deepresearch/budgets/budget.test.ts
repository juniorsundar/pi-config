import { describe, it, expect } from "vitest";
import { createBudget, trackUsage, isExhausted, remainingBudget } from "./budget";
import type { Budget, BudgetLimits } from "./budget";

describe("Budget", () => {
  const defaultLimits: BudgetLimits = {
    maxSearches: 10,
    maxFetchAttempts: 20,
    maxSourceVisits: 15,
    maxSynthesisRounds: 3,
    maxModelCalls: 30,
    maxRetryAttempts: 5,
    maxElapsedSeconds: 600,
  };

  it("creates a budget with the approved limits", () => {
    const budget = createBudget(defaultLimits);

    expect(budget.limits).toEqual(defaultLimits);
    expect(budget.usage.searches).toBe(0);
    expect(budget.usage.fetchAttempts).toBe(0);
    expect(budget.usage.sourceVisits).toBe(0);
    expect(budget.usage.synthesisRounds).toBe(0);
    expect(budget.usage.modelCalls).toBe(0);
    expect(budget.usage.retryAttempts).toBe(0);
  });

  it("is not exhausted when no usage has been tracked", () => {
    const budget = createBudget(defaultLimits);

    expect(isExhausted(budget)).toBe(false);
  });

  it("tracks searches usage", () => {
    let budget = createBudget(defaultLimits);
    budget = trackUsage(budget, { searches: 3 });

    expect(budget.usage.searches).toBe(3);
  });

  it("tracks fetch attempt usage", () => {
    let budget = createBudget(defaultLimits);
    budget = trackUsage(budget, { fetchAttempts: 5 });

    expect(budget.usage.fetchAttempts).toBe(5);
  });

  it("tracks source visit usage", () => {
    let budget = createBudget(defaultLimits);
    budget = trackUsage(budget, { sourceVisits: 2 });

    expect(budget.usage.sourceVisits).toBe(2);
  });

  it("tracks multiple usage categories at once", () => {
    let budget = createBudget(defaultLimits);
    budget = trackUsage(budget, {
      searches: 1,
      fetchAttempts: 2,
      modelCalls: 3,
    });

    expect(budget.usage.searches).toBe(1);
    expect(budget.usage.fetchAttempts).toBe(2);
    expect(budget.usage.modelCalls).toBe(3);
    expect(budget.usage.sourceVisits).toBe(0);
  });

  it("accumulates usage across multiple trackUsage calls", () => {
    let budget = createBudget(defaultLimits);
    budget = trackUsage(budget, { searches: 1 });
    budget = trackUsage(budget, { searches: 2 });
    budget = trackUsage(budget, { modelCalls: 1 });

    expect(budget.usage.searches).toBe(3);
    expect(budget.usage.modelCalls).toBe(1);
  });

  it("isExhausted when searches reach limit", () => {
    let budget = createBudget({ ...defaultLimits, maxSearches: 3 });
    budget = trackUsage(budget, { searches: 2 });
    expect(isExhausted(budget)).toBe(false); // under limit

    budget = trackUsage(budget, { searches: 1 });
    expect(isExhausted(budget)).toBe(true); // at limit
  });

  it("isExhausted when model calls reach limit", () => {
    let budget = createBudget({ ...defaultLimits, maxModelCalls: 5 });
    budget = trackUsage(budget, { modelCalls: 4 });
    expect(isExhausted(budget)).toBe(false); // under limit

    budget = trackUsage(budget, { modelCalls: 1 });
    expect(isExhausted(budget)).toBe(true); // at limit
  });

  it("isExhausted when source visits reach limit", () => {
    let budget = createBudget({ ...defaultLimits, maxSourceVisits: 2 });
    budget = trackUsage(budget, { sourceVisits: 1 });
    expect(isExhausted(budget)).toBe(false); // under limit

    budget = trackUsage(budget, { sourceVisits: 1 });
    expect(isExhausted(budget)).toBe(true); // at limit
  });

  it("isExhausted when fetch attempts reach limit", () => {
    let budget = createBudget({ ...defaultLimits, maxFetchAttempts: 3 });
    budget = trackUsage(budget, { fetchAttempts: 2 });
    expect(isExhausted(budget)).toBe(false); // under limit

    budget = trackUsage(budget, { fetchAttempts: 1 });
    expect(isExhausted(budget)).toBe(true); // at limit
  });

  it("isExhausted when synthesis rounds reach limit", () => {
    let budget = createBudget({ ...defaultLimits, maxSynthesisRounds: 2 });
    budget = trackUsage(budget, { synthesisRounds: 1 });
    expect(isExhausted(budget)).toBe(false); // under limit

    budget = trackUsage(budget, { synthesisRounds: 1 });
    expect(isExhausted(budget)).toBe(true); // at limit
  });

  it("isExhausted when retry attempts reach limit", () => {
    let budget = createBudget({ ...defaultLimits, maxRetryAttempts: 2 });
    budget = trackUsage(budget, { retryAttempts: 1 });
    expect(isExhausted(budget)).toBe(false); // under limit

    budget = trackUsage(budget, { retryAttempts: 1 });
    expect(isExhausted(budget)).toBe(true); // at limit
  });

  it("remainingBudget returns budget left for each category", () => {
    let budget = createBudget(defaultLimits);
    budget = trackUsage(budget, { searches: 3, modelCalls: 5 });

    const remaining = remainingBudget(budget);
    expect(remaining.searches).toBe(7);  // 10 - 3
    expect(remaining.modelCalls).toBe(25); // 30 - 5
    expect(remaining.sourceVisits).toBe(15); // untouched
    expect(remaining.fetchAttempts).toBe(20); // untouched
  });

  it("remainingBudget floors at zero", () => {
    let budget = createBudget({ ...defaultLimits, maxSearches: 2 });
    budget = trackUsage(budget, { searches: 5 });

    const remaining = remainingBudget(budget);
    expect(remaining.searches).toBe(0);
  });

  it("canEnforceLimit returns true when usage is within limit", () => {
    const budget = createBudget({ ...defaultLimits, maxSearches: 3 });
    const can = remainingBudget(budget).searches >= 1;
    expect(can).toBe(true);
  });

  it("canEnforceLimit returns false when usage would exceed limit", () => {
    let budget = createBudget({ ...defaultLimits, maxSearches: 1 });
    budget = trackUsage(budget, { searches: 1 });

    const can = remainingBudget(budget).searches >= 1;
    expect(can).toBe(false);
  });

  it("isExhausted when elapsed time exceeds maxElapsedSeconds", () => {
    const budget = createBudget({ ...defaultLimits, maxElapsedSeconds: 10 });
    expect(isExhausted(budget, 5)).toBe(false);
    expect(isExhausted(budget, 10)).toBe(true); // equal IS exhausted (>= semantics)
    expect(isExhausted(budget, 11)).toBe(true);
  });

  it("isExhausted elapsed time check is optional (backward compat)", () => {
    const budget = createBudget({ ...defaultLimits, maxElapsedSeconds: 10 });
    // When elapsedSeconds is not provided, elapsed time is not checked
    // We need to provide a value that wouldn't affect the test
    expect(isExhausted(budget)).toBe(false); // no elapsedSec passed, other categories fine
  });

  it("tracks elapsed time through start time recording", () => {
    const budget = createBudget(defaultLimits);
    expect(budget.startedAt).toBeDefined();
    expect(budget.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("createBudget returns an immutable-like record (new object each track)", () => {
    const original = createBudget(defaultLimits);
    const updated = trackUsage(original, { searches: 1 });

    // original should not be mutated
    expect(original.usage.searches).toBe(0);
    expect(updated.usage.searches).toBe(1);
    expect(original).not.toBe(updated);
  });
});
