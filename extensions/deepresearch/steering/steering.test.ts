import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  processSteeringSignal,
  writeSteeringSignal,
  readAndClearSteeringSignal,
  validateInstruction,
  steeringEntryToLedger,
  steeringSignalPath,
} from "./steering";
import type { SteeringSignal } from "./steering";
import type { RunMeta, RunStatus } from "../domain/types";
import { createBudget, type BudgetLimits } from "../budgets/budget";
import type { Budget } from "../budgets/budget";

// ── Test defaults ──────────────────────────────────────────────────────────

const DEFAULT_RUN_META: RunMeta = {
  identity: { id: "test-run-001", date: "2026-01-01", slug: "test", shortId: "001" },
  status: "running",
  question: "What is the best approach for X?",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxSearches: 10,
  maxFetchAttempts: 10,
  maxSourceVisits: 10,
  maxSynthesisRounds: 3,
  maxModelCalls: 20,
  maxRetryAttempts: 3,
  maxElapsedSeconds: 300,
};

const DEFAULT_EVIDENCE_CATEGORIES = ["docs", "benchmarks"];

function makeBudget(): Budget {
  return createBudget(DEFAULT_BUDGET_LIMITS);
}

// ── Temp dir management ───────────────────────────────────────────────────

let workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "steering-test-"));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ── Slice 1: Cancel (Tracer Bullet) ────────────────────────────────────────

describe("Steering — Cancel (AC1)", () => {
  it("returns stop action with status=applied and includes reason", () => {
    const budget = makeBudget();
    // Simulate some usage
    const usedBudget = {
      ...budget,
      usage: { ...budget.usage, searches: 3, modelCalls: 5 },
    };

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "cancel",
        text: "User decided to pivot to a different approach",
      },
      DEFAULT_RUN_META,
      2, // sourceNoteCount
      usedBudget,
      DEFAULT_EVIDENCE_CATEGORIES,
    );

    // Action should be "stop"
    expect(result.action).toBe("stop");
    expect(result.stopReason).toContain("User decided to pivot");

    // Entry should be applied
    expect(result.entry.type).toBe("cancel");
    expect(result.entry.status).toBe("applied");
    expect(result.entry.timestamp).toBe("2026-01-01T01:00:00Z");
    expect(result.entry.text).toBe("User decided to pivot to a different approach");

    // Entry should capture budget state at the time
    expect(result.entry.budgetState).toBeDefined();
    expect(result.entry.budgetState!.searches).toBe(3);
    expect(result.entry.budgetState!.modelCalls).toBe(5);

    // Application detail should mention the reason
    expect(result.entry.applicationDetails).toContain("User decided to pivot");
  });

  it("returns stop action with default reason when no text provided", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "cancel",
      },
      DEFAULT_RUN_META,
      0,
      budget,
    );

    expect(result.action).toBe("stop");
    expect(result.stopReason).toBe("User cancelled the run.");
    expect(result.entry.status).toBe("applied");
  });

  it("uses -1 round for ledger event formatting", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "cancel",
        text: "No longer needed",
      },
      DEFAULT_RUN_META,
      5,
      budget,
    );

    // Convert to ledger format
    const ledgerEntry = steeringEntryToLedger(result.entry);

    expect((ledgerEntry as any).round).toBe(-1);
    expect((ledgerEntry as any).intent).toBe("steering:cancel");
    expect((ledgerEntry as any).meta.instructionType).toBe("cancel");
    expect((ledgerEntry as any).meta.status).toBe("applied");
    expect((ledgerEntry as any).meta.applicationDetails).toContain("No longer needed");
  });
});

// ── Slice 2: Force Synthesis Refused (AC2) ────────────────────────────────

describe("Steering — Force Synthesis Refused (AC2)", () => {
  it("rejects force_synthesis when sourceNoteCount is 0", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "force_synthesis",
        text: "I need answers now",
      },
      DEFAULT_RUN_META,
      0, // sourceNoteCount = 0
      budget,
    );

    // Action should be "continue" (not synthesize)
    expect(result.action).toBe("continue");
    expect(result.synthesisReason).toBeUndefined();

    // Entry should be rejected
    expect(result.entry.type).toBe("force_synthesis");
    expect(result.entry.status).toBe("rejected");
    expect(result.entry.applicationDetails).toContain("no Source Notes exist");
    expect(result.entry.applicationDetails).toContain("refused");

    // Budget state should be captured
    expect(result.entry.budgetState).toBeDefined();
  });

  it("accepts force_synthesis when sourceNoteCount > 0", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "force_synthesis",
        text: "I have enough info",
      },
      DEFAULT_RUN_META,
      3, // sourceNoteCount = 3
      budget,
    );

    // Action should be "synthesize"
    expect(result.action).toBe("synthesize");
    expect(result.synthesisReason).toContain("I have enough info");

    // Entry should be applied
    expect(result.entry.type).toBe("force_synthesis");
    expect(result.entry.status).toBe("applied");
    expect(result.entry.applicationDetails).toContain("3 source note(s)");
  });

  it("uses default synthesis reason when force_synthesis without text", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "force_synthesis",
      },
      DEFAULT_RUN_META,
      2,
      budget,
    );

    expect(result.action).toBe("synthesize");
    expect(result.synthesisReason).toContain("User forced synthesis with partial evidence");
    expect(result.entry.status).toBe("applied");
  });

  it("ledger entry for rejected force_synthesis has correct intent and status", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "force_synthesis",
      },
      DEFAULT_RUN_META,
      0,
      budget,
    );

    const ledgerEntry = steeringEntryToLedger(result.entry);
    expect((ledgerEntry as any).intent).toBe("steering:force_synthesis");
    expect((ledgerEntry as any).meta.status).toBe("rejected");
    expect((ledgerEntry as any).meta.instructionType).toBe("force_synthesis");
  });
});

// ── Slice 4: Add Instruction — Accepted (AC4) ─────────────────────────────

describe("Steering — Add Instruction Accepted (AC4)", () => {
  it("accepts narrowing instruction", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Focus on official documentation only",
      },
      DEFAULT_RUN_META,
      0,
      budget,
      ["docs", "benchmarks"],
    );

    expect(result.action).toBe("continue");
    expect(result.entry.type).toBe("add_instruction");
    expect(result.entry.status).toBe("applied");
    expect(result.entry.applicationDetails).toContain("Instruction applied");
    expect(result.entry.budgetState).toBeDefined();
  });

  it("accepts prioritizing instruction", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Prioritize benchmarks and performance data",
      },
      DEFAULT_RUN_META,
      2,
      budget,
    );

    expect(result.action).toBe("continue");
    expect(result.entry.status).toBe("applied");
  });

  it("accepts excluding/clarifying instruction", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Exclude outdated articles, focus on this year",
      },
      DEFAULT_RUN_META,
      2,
      budget,
    );

    expect(result.action).toBe("continue");
    expect(result.entry.status).toBe("applied");
  });

  it("accepts clarification within research question", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Specifically look at TypeScript examples",
      },
      DEFAULT_RUN_META,
      2,
      budget,
    );

    expect(result.action).toBe("continue");
    expect(result.entry.status).toBe("applied");
  });

  it("deferred when no instruction text provided", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
      },
      DEFAULT_RUN_META,
      0,
      budget,
    );

    expect(result.action).toBe("continue");
    expect(result.entry.status).toBe("deferred");
    expect(result.entry.applicationDetails).toContain("no instruction text was provided");
  });

  it("ledger entry for add_instruction has correct intent and fields", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Focus on docs",
      },
      DEFAULT_RUN_META,
      0,
      budget,
    );

    const ledgerEntry = steeringEntryToLedger(result.entry);
    expect((ledgerEntry as any).intent).toBe("steering:add_instruction");
    expect((ledgerEntry as any).meta.instructionType).toBe("add_instruction");
    expect((ledgerEntry as any).meta.status).toBe("applied");
    expect((ledgerEntry as any).meta.text).toBe("Focus on docs");
    expect((ledgerEntry as any).meta.budgetState).toBeDefined();
  });
});

// ── Slice 5: Add Instruction — Scope Expansion Rejected (AC5) ─────────────

describe("Steering — Add Instruction Scope Expansion Rejected (AC5)", () => {
  it("rejects instruction that broadens scope (add keyword)", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Also compare with alternative framework X",
      },
      DEFAULT_RUN_META,
      2,
      budget,
      ["docs", "benchmarks"],
    );

    expect(result.action).toBe("continue");
    expect(result.entry.status).toBe("rejected");
    expect(result.entry.applicationDetails).toContain("broaden scope");
  });

  it("rejects instruction that adds a new comparison axis (versus)", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Investigate whether we should migrate to Y instead",
      },
      DEFAULT_RUN_META,
      2,
      budget,
      ["docs"],
    );

    expect(result.action).toBe("continue");
    expect(result.entry.status).toBe("rejected");
    expect(result.entry.applicationDetails).toContain("broaden scope");
  });

  it("rejects instruction that requires a new evidence category", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Look at security vulnerabilities and CVEs related to this",
      },
      DEFAULT_RUN_META,
      2,
      budget,
      ["docs"], // Only docs approved — security/benchmarks not in mix
    );

    expect(result.action).toBe("continue");
    expect(result.entry.status).toBe("rejected");
    expect(result.entry.applicationDetails).toContain("new evidence categories");
  });

  it("accepts an instruction that introduces categories within accepted mix", () => {
    const budget = makeBudget();

    // Both docs and benchmarks are in the accepted evidence mix
    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Look at benchmarks more carefully",
      },
      DEFAULT_RUN_META,
      2,
      budget,
      ["docs", "benchmarks"],
    );

    expect(result.action).toBe("continue");
    expect(result.entry.status).toBe("applied");
    expect(result.entry.applicationDetails).toContain("Instruction applied");
  });

  it("ledger entry for rejected add_instruction has rejected status", () => {
    const budget = makeBudget();

    const result = processSteeringSignal(
      {
        timestamp: "2026-01-01T01:00:00Z",
        type: "add_instruction",
        text: "Also compare with framework Z",
      },
      DEFAULT_RUN_META,
      2,
      budget,
      ["docs"],
    );

    const ledgerEntry = steeringEntryToLedger(result.entry);
    expect((ledgerEntry as any).meta.status).toBe("rejected");
    expect((ledgerEntry as any).meta.text).toBe("Also compare with framework Z");
    expect((ledgerEntry as any).meta.applicationDetails).toContain("broaden scope");
  });
});

// ── Write/Read/Clear steering signal ──────────────────────────────────────

describe("Steering signal file — write/read/clear", () => {
  it("writes and reads a steering signal", () => {
    const workDir = makeWorkDir();
    const storePath = join(workDir, ".pi", "research", "runs", "run-001");
    mkdirSync(storePath, { recursive: true });

    const signal: SteeringSignal = {
      timestamp: "2026-01-01T01:00:00Z",
      type: "cancel",
      text: "Cancel test",
    };

    writeSteeringSignal(workDir, "run-001", signal);

    const signalPath = steeringSignalPath(workDir, "run-001");
    expect(existsSync(signalPath)).toBe(true);

    const read = readAndClearSteeringSignal(workDir, "run-001");
    expect(read).not.toBeNull();
    expect(read!.type).toBe("cancel");
    expect(read!.text).toBe("Cancel test");

    // After reading, file should be cleared
    expect(existsSync(signalPath)).toBe(false);
  });

  it("returns null when no signal exists", () => {
    const workDir = makeWorkDir();
    const result = readAndClearSteeringSignal(workDir, "nonexistent");
    expect(result).toBeNull();
  });

  it("handles corrupt signal file gracefully", () => {
    const workDir = makeWorkDir();
    const storePath = join(workDir, ".pi", "research", "runs", "run-001");
    mkdirSync(storePath, { recursive: true });

    // Write corrupt data
    writeFileSync(steeringSignalPath(workDir, "run-001"), "corrupt-json{{{");

    const result = readAndClearSteeringSignal(workDir, "run-001");
    expect(result).toBeNull();

    // File should have been removed
    expect(existsSync(steeringSignalPath(workDir, "run-001"))).toBe(false);
  });

  it("rejects invalid signal structure (missing timestamp)", () => {
    const workDir = makeWorkDir();
    const storePath = join(workDir, ".pi", "research", "runs", "run-001");
    mkdirSync(storePath, { recursive: true });

    // Valid JSON but wrong structure — missing timestamp
    writeFileSync(
      steeringSignalPath(workDir, "run-001"),
      JSON.stringify({ type: "cancel" }),
    );

    const result = readAndClearSteeringSignal(workDir, "run-001");
    expect(result).toBeNull();

    // File should have been removed
    expect(existsSync(steeringSignalPath(workDir, "run-001"))).toBe(false);
  });

  it("rejects invalid signal type", () => {
    const workDir = makeWorkDir();
    const storePath = join(workDir, ".pi", "research", "runs", "run-001");
    mkdirSync(storePath, { recursive: true });

    writeFileSync(
      steeringSignalPath(workDir, "run-001"),
      JSON.stringify({ timestamp: "t", type: "unknown_type" }),
    );

    const result = readAndClearSteeringSignal(workDir, "run-001");
    expect(result).toBeNull();
    expect(existsSync(steeringSignalPath(workDir, "run-001"))).toBe(false);
  });
});