import { describe, it, expect } from "vitest";
import { renderProgressDigest, type ProgressDigestInput } from "./progress-digest";
import type { RunStatus } from "../domain/types";

const ALL_RUN_STATUSES: RunStatus[] = [
  "queued",
  "readiness_failed",
  "running",
  "synthesizing",
  "completed",
  "budget_exhausted",
  "cancelled",
  "interrupted",
  "failed",
];

const STATUS_ICONS: Record<RunStatus, string> = {
  queued: "⏳",
  readiness_failed: "🔧",
  running: "🔍",
  synthesizing: "✍️",
  completed: "✅",
  budget_exhausted: "💰",
  cancelled: "🚫",
  interrupted: "⚠️",
  failed: "❌",
};

function makeSampleInput(overrides?: Partial<ProgressDigestInput>): ProgressDigestInput {
  return {
    runId: "2026-06-08-test-run-abc12345",
    status: "running",
    question: "What is the best way to implement X?",
    roundCount: 3,
    budget: {
      usage: { searches: 2, fetchAttempts: 3, sourceVisits: 2, synthesisRounds: 0, modelCalls: 4, retryAttempts: 0 },
      limits: { maxSearches: 10, maxFetchAttempts: 20, maxSourceVisits: 10, maxSynthesisRounds: 3, maxModelCalls: 30, maxRetryAttempts: 5, maxElapsedSeconds: 300 },
    },
    evidenceMix: {
      categories: [
        { category: "docs", status: "found", note: undefined },
        { category: "benchmarks", status: "not-searched", note: undefined },
        { category: "source code", status: "found", note: undefined },
      ],
      found: 2, weak: 0, missing: 0, excluded: 0, notSearched: 1,
      overall: "partial",
    },
    negativeEvidenceCount: 0,
    gaps: [],
    nextStep: "Searching for benchmarks evidence",
    sourceNoteCount: 2,
    ledgerEntryCount: 5,
    hasBrief: false,
    elapsedSeconds: 45.2,
    ...overrides,
  };
}

describe("renderProgressDigest", () => {
  it("produces a compact human-readable digest for an active run", () => {
    const input = makeSampleInput();
    const output = renderProgressDigest(input);

    // Should include the run ID
    expect(output).toContain(input.runId);
    // Should include status icon and label
    expect(output).toContain("🔍");
    expect(output).toContain("running (Round 3)");
    // Should include elapsed time
    expect(output).toContain("45s");
    // Should include budget line
    expect(output).toContain("2/10 searches");
    expect(output).toContain("3/20 fetches");
    expect(output).toContain("4/30 model calls");
    // Should include evidence summary
    expect(output).toContain("partial");
    expect(output).toContain("2 found · 1 not searched");
    // Should include next step
    expect(output).toContain("Searching for benchmarks evidence");
    // Should include artifact pointers
    expect(output).toContain("2 source-notes");
    expect(output).toContain("5 ledger entries");
    // Should include gaps section even when empty
    expect(output).toContain("None identified.");
    // Should NOT have brief since hasBrief is false
    expect(output).not.toContain("brief.md");

    // Verify it's distinctly different from a run-summary.md style
    // (no Budget Remaining table, no Recent Ledger Entries section)
    expect(output).not.toContain("| Category | Remaining |");
    expect(output).not.toContain("## Recent Ledger Entries");
  });

  it("includes interruption state when provided", () => {
    const input = makeSampleInput({
      status: "interrupted",
      interruptionState: "Run paused due to Pi shutdown. Use /research resume to continue.",
    });
    const output = renderProgressDigest(input);
    expect(output).toContain("⚠️");
    expect(output).toContain("Run paused due to Pi shutdown");
  });

  it("shows gaps when present (truncated at 3 + overflow note)", () => {
    const input = makeSampleInput({
      gaps: [
        "Missing official docs for API v2",
        "Benchmark results not found",
        "Source code not accessible",
        "Community reports inconclusive",
      ],
    });
    const output = renderProgressDigest(input);
    // First 3 gaps should appear
    expect(output).toContain("Missing official docs for API v2");
    expect(output).toContain("Benchmark results not found");
    expect(output).toContain("Source code not accessible");
    // Overflow note
    expect(output).toContain("and 1 more");
  });

  it("shows synthesizing status and brief pointer when brief exists", () => {
    const input = makeSampleInput({
      status: "synthesizing",
      hasBrief: false,
      nextStep: "Drafting Research Brief",
    });
    const output = renderProgressDigest(input);
    expect(output).toContain("✍️");
    expect(output).toContain("synthesizing (Round 3)");
    expect(output).toContain("Drafting Research Brief");
    // No brief yet
    expect(output).not.toContain("brief.md");

    // Now with brief
    const withBrief = makeSampleInput({
      status: "completed",
      hasBrief: true,
      nextStep: "",
    });
    const output2 = renderProgressDigest(withBrief);
    expect(output2).toContain("brief.md");
    expect(output2).toContain("✅");
  });

  it("renders current signal when provided", () => {
    const input = makeSampleInput({
      currentSignal: "Documentation confirms API v2 supports streaming",
    });
    const output = renderProgressDigest(input);
    expect(output).toContain("📡");
    expect(output).toContain("Documentation confirms API v2 supports streaming");
  });

  it("omits current signal line when not provided", () => {
    const output = renderProgressDigest(makeSampleInput());
    expect(output).not.toContain("📡");
  });

  it("renders null evidenceMix without crashing", () => {
    const input = makeSampleInput({ evidenceMix: null });
    const output = renderProgressDigest(input);
    expect(output).toContain("No evidence categories defined.");
  });

  it("shows exactly 3 gaps without overflow note", () => {
    const input = makeSampleInput({
      gaps: [
        "Missing official docs for API v2",
        "Benchmark results not found",
        "Source code not accessible",
      ],
    });
    const output = renderProgressDigest(input);
    expect(output).toContain("Missing official docs for API v2");
    expect(output).toContain("Benchmark results not found");
    expect(output).toContain("Source code not accessible");
    expect(output).not.toContain("more");
  });

  it.each(ALL_RUN_STATUSES)("renders correct icon for status: %s", (status) => {
    const input = makeSampleInput({ status, roundCount: 0 });
    const output = renderProgressDigest(input);
    expect(output).toContain(STATUS_ICONS[status]);
    expect(output).toContain(status.replace(/_/g, " "));
  });

  it("formats 0 elapsed seconds", () => {
    const input = makeSampleInput({ elapsedSeconds: 0 });
    const output = renderProgressDigest(input);
    expect(output).toContain("0s");
  });

  it("formats elapsed time at minute boundary", () => {
    const input = makeSampleInput({ elapsedSeconds: 60 });
    const output = renderProgressDigest(input);
    expect(output).toContain("1m 0s");
  });

  it("formats long elapsed time", () => {
    const input = makeSampleInput({ elapsedSeconds: 3661 });
    const output = renderProgressDigest(input);
    expect(output).toContain("61m 1s");
  });

  it("includes synthesis rounds in budget line", () => {
    const input = makeSampleInput({
      budget: {
        usage: { searches: 2, fetchAttempts: 3, sourceVisits: 2, synthesisRounds: 2, modelCalls: 4, retryAttempts: 1 },
        limits: { maxSearches: 10, maxFetchAttempts: 20, maxSourceVisits: 10, maxSynthesisRounds: 3, maxModelCalls: 30, maxRetryAttempts: 5, maxElapsedSeconds: 300 },
      },
    });
    const output = renderProgressDigest(input);
    expect(output).toContain("2/3 synth rounds");
  });
});