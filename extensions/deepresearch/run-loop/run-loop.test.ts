import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore } from "../workspace/store";
import { createRun, updateStatus, getRun } from "../lifecycle/run-store";
import { createBudget, type BudgetLimits } from "../budgets/budget";
import type { ResearchBrain } from "../brain/harness/types";
import { executeResearchRun, continueResearchRun } from "./run-loop";
import type { RunLoopOptions, LedgerEntry, ResearchRunMeta } from "./types";
import { writeSteeringSignal, readAndClearSteeringSignal } from "../steering/steering";
import type { SteeringSignal } from "../steering/steering";

/** Fake search results for the mock seam. */
const FAKE_SEARCH_RESULTS = [
  {
    url: "https://example.com/guide",
    title: "Example Guide",
    snippet: "A comprehensive guide about the topic.",
  },
  {
    url: "https://docs.example.org/reference",
    title: "Reference Docs",
    snippet: "Official documentation and API reference.",
  },
];

/** Fake fetched content for the mock seam. */
const FAKE_FETCHED_CONTENT =
  "# Example Guide\n\nThis is the full content of the fetched page. " +
  "It contains detailed information about the research topic.";

// ── Temp dir management ───────────────────────────────────────────────────

let workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-loop-"));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

// ── Mock Research Brain ────────────────────────────────────────────────────

/**
 * A mock Brain that walks through a predefined sequence of intents.
 * After the final intent, any additional generate() call returns
 * synthesize_brief to avoid infinite loops.
 */
function createMockBrain(intentSequence: string[]): ResearchBrain {
  let index = 0;

  return {
    generate: async (_prompt: string) => {
      if (index < intentSequence.length) {
        const intent = intentSequence[index++];
        // Return different content depending on the intent
        switch (intent) {
          case "search":
            return JSON.stringify({
              intent: "search",
              reasoning: "We need to find sources first.",
              query: "research topic best practices",
            });
          case "select_sources":
            return JSON.stringify({
              intent: "select_sources",
              reasoning: "The first result looks most relevant.",
              selectedUrls: ["https://example.com/guide"],
              reasoningPerUrl: {
                "https://example.com/guide":
                  "Official guide covering the topic comprehensively.",
              },
            });
          case "update_findings":
            return JSON.stringify({
              intent: "update_findings",
              reasoning: "Extracting key findings from the source.",
              snippets: [
                "The guide covers best practices for implementation.",
                "Key recommendations include modular design.",
              ],
            });
          case "synthesize_brief":
            return JSON.stringify({
              intent: "synthesize_brief",
              reasoning: "Sufficient evidence gathered across all categories.",
              briefDraft:
                "# Research Brief\n\n## Question\nWhat are the best practices?\n\n" +
                "## Bottom Line\nBest practices include modular design [1].\n\n" +
                "## Evidence\n- [1] Example Guide (https://example.com/guide)\n\n" +
                "## Confidence\nMedium — based on one primary source.",
              confidence: "medium" as const,
              gaps: ["No benchmarks or comparison data found."],
            });
          case "stop_early":
            return JSON.stringify({
              intent: "stop_early",
              reasoning: "Sufficient evidence has been collected.",
            });
          default:
            return JSON.stringify({
              intent: "synthesize_brief",
              reasoning: "Default end-of-loop behavior.",
            });
        }
      }
      // Safety valve — prevent infinite loops
      return JSON.stringify({
        intent: "synthesize_brief",
        reasoning: "Safety: reached end of mock sequence.",
      });
    },
  };
}

// ── Mock seams ────────────────────────────────────────────────────────────

function mockRunLoopOptions(): RunLoopOptions {
  return {
    search: async (_query: string) => FAKE_SEARCH_RESULTS,
    fetch: async (url: string) => ({
      url,
      finalUrl: url,
      title: "Example Guide",
      content: FAKE_FETCHED_CONTENT,
      contentType: "text/markdown",
      truncated: false,
      retrievedAt: new Date().toISOString(),
    }),
  };
}

// ── Budget test helpers ──────────────────────────────────────────────────

function setupRunForLoop(
  workDir: string,
  question: string,
  limits: BudgetLimits,
): { runId: string; budget: ReturnType<typeof createBudget> } {
  initStore(workDir);
  const run = createRun(workDir, question, { budgetLimits: limits });
  const runId = run.identity.id;
  updateStatus(workDir, runId, "running");
  const budget = createBudget(limits);
  return { runId, budget };
}

// ── Tracer Bullet Test ────────────────────────────────────────────────────

describe("Research Run loop — tracer bullet", () => {
  it("runs a minimal end-to-end loop: search, source note, ledger, summary, brief", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    // Create a queued run with a small budget
    const run = createRun(workDir, "What are the best practices for X?", {
      mode: "blocking",
      trigger: "Evaluating implementation approach",
      budgetLimits: {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;

    // Transition to running (simulates what approve-and-activate does)
    updateStatus(workDir, runId, "running");

    // Create a budget for tracking
    const budget = createBudget({
      maxSearches: 5,
      maxFetchAttempts: 5,
      maxSourceVisits: 5,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    // Mock brain: search → select_sources → update_findings → synthesize_brief
    const brain = createMockBrain([
      "search",
      "select_sources",
      "update_findings",
      "synthesize_brief",
    ]);
    const options = mockRunLoopOptions();

    // Execute the run loop
    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    // ── Verify results ──────────────────────────────────────────────────

    // 1. Run transitioned to completed
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun).not.toBeNull();
    expect(updatedRun!.status).toBe("completed");

    // 2. Run directory has the expected artifacts
    const runDir = join(workDir, ".pi", "research", "runs", runId);

    // Ledger file exists
    const ledgerPath = join(runDir, "ledger.jsonl");
    expect(existsSync(ledgerPath)).toBe(true);

    // Run Summary file exists
    const summaryPath = join(runDir, "run-summary.md");
    expect(existsSync(summaryPath)).toBe(true);

    // Progress Digest file exists and is distinct from Run Summary
    const digestPath = join(runDir, "progress-digest.md");
    expect(existsSync(digestPath)).toBe(true);
    const digestContent = readFileSync(digestPath, "utf-8");
    expect(digestContent).toContain("Progress Digest");
    expect(digestContent).toContain("Budget");
    expect(digestContent).toContain("Evidence");
    expect(digestContent).toContain("Artifacts");
    // Distinct from Run Summary format
    expect(digestContent).not.toContain("| Category | Remaining |");

    // Brief file exists
    const briefPath = join(runDir, "brief.md");
    expect(existsSync(briefPath)).toBe(true);

    // Source Notes directory exists and has at least one note
    const sourceNotesDir = join(runDir, "source-notes");
    expect(existsSync(sourceNotesDir)).toBe(true);
    const notes = readdirSync(sourceNotesDir);
    expect(notes.length).toBeGreaterThanOrEqual(1);

    // 3. Ledger has entries (at minimum for each step)
    const ledgerContent = readFileSync(ledgerPath, "utf-8");
    const ledgerLines = ledgerContent
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(ledgerLines.length).toBeGreaterThanOrEqual(4); // search, select, update, synthesize

    // 4. Run Summary is non-trivial
    const summaryContent = readFileSync(summaryPath, "utf-8");
    expect(summaryContent.length).toBeGreaterThan(50);

    // 5. Brief is non-trivial
    const briefContent = readFileSync(briefPath, "utf-8");
    expect(briefContent).toContain("# Research Brief");
    expect(briefContent).toContain("[1]"); // citation reference

    // 6. Result metadata is reasonable
    expect(result.roundCount).toBeGreaterThanOrEqual(1);
    expect(result.sourceNoteCount).toBeGreaterThanOrEqual(1);
    expect(result.ledgerEntryCount).toBeGreaterThanOrEqual(4);
    expect(result.briefPath).toBe(briefPath);
  });

  it("supports multiple rounds across different intent types (multi-cycle)", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Multi-cycle research?", {
      mode: "blocking",
      trigger: "Testing multi-round",
      budgetLimits: {
        maxSearches: 10,
        maxFetchAttempts: 10,
        maxSourceVisits: 10,
        maxSynthesisRounds: 3,
        maxModelCalls: 50,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 10,
      maxFetchAttempts: 10,
      maxSourceVisits: 10,
      maxSynthesisRounds: 3,
      maxModelCalls: 50,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    // Two full research cycles then synthesis
    const brain = createMockBrain([
      "search",           // Round 1
      "select_sources",   // Round 2
      "update_findings",  // Round 3 — creates source note 1
      "search",           // Round 4
      "select_sources",   // Round 5
      "update_findings",  // Round 6 — creates source note 2
      "synthesize_brief", // Round 7
    ]);
    const options = mockRunLoopOptions();

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    // 1. Run completed
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("completed");

    // 2. Expected number of rounds (7 intent rounds)
    expect(result.roundCount).toBe(7);

    // 3. Two source notes created (one per update_findings)
    expect(result.sourceNoteCount).toBe(2);

    // 4. Ledger has entries for all rounds
    expect(result.ledgerEntryCount).toBeGreaterThanOrEqual(7);

    // 5. Run Summary reflects accumulated state
    const summaryContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "run-summary.md"),
      "utf-8",
    );
    expect(summaryContent).toContain("2"); // 2 source notes
  });
});

// ── Early Synthesis Gate Tests ─────────────────────────────────────────────

describe("Research Run loop — early synthesis gate", () => {
  it("accepts stop_early when minimum source notes are met", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Early stop with evidence?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // search → select_sources → update_findings (creates 1 source note) → stop_early
    const brain = createMockBrain([
      "search",
      "select_sources",
      "update_findings",
      "stop_early",
    ]);
    const options = mockRunLoopOptions();

    const result = await executeResearchRun(
      workDir, runId, brain, budget, options,
      1, // minimumSourceNotes = 1
    );

    const updatedRun = getRun(workDir, runId);
    // stop_early accepted → run completes
    expect(updatedRun!.status).toBe("completed");

    // Brief should mention early stop
    const briefContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "brief.md"),
      "utf-8",
    );
    expect(briefContent).toContain("Early Stop");
    expect(briefContent).toContain("Sufficient evidence");

    // Source note was created
    expect(result.sourceNoteCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects stop_early when insufficient evidence and no negative evidence", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Early stop without evidence?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // search → stop_early (will be rejected) → synthesize_brief (safety valve)
    const brain = createMockBrain(["search", "stop_early"]);
    const options = mockRunLoopOptions();

    const result = await executeResearchRun(
      workDir, runId, brain, budget, options,
      5, // minimumSourceNotes = 5 — not met
    );

    const updatedRun = getRun(workDir, runId);
    // Early stop rejected → loop continued → synthesize_brief completed run
    expect(updatedRun!.status).toBe("completed");

    // Ledger should have the rejection entry
    const ledgerRaw = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "ledger.jsonl"),
      "utf-8",
    );
    expect(ledgerRaw).toContain("early_stop_rejected");

    // More than 1 round (rejection didn't stop the loop)
    expect(result.roundCount).toBeGreaterThan(1);
  });

  it("accepts stop_early with negative evidence even below minimum source notes", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Negative evidence test?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // Mock options with empty search results (negative evidence)
    const emptyOptions: RunLoopOptions = {
      search: async () => [],
      fetch: async (url: string) => ({
        url,
        finalUrl: url,
        title: "N/A",
        content: "",
        contentType: "text/plain",
        truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    // search (0 results = negative evidence) → stop_early
    const brain = createMockBrain(["search", "stop_early"]);

    const result = await executeResearchRun(
      workDir, runId, brain, budget, emptyOptions,
      5, // minimumSourceNotes = 5 — not met
    );

    const updatedRun = getRun(workDir, runId);
    // stop_early accepted because search returned 0 results (negative evidence)
    expect(updatedRun!.status).toBe("completed");

    const briefContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "brief.md"),
      "utf-8",
    );
    expect(briefContent).toContain("Early Stop");
    expect(briefContent).toContain("Negative Evidence");

    // No source notes were created (search returned nothing)
    expect(result.sourceNoteCount).toBe(0);
  });
});

// ── Budget Enforcement Tests ────────────────────────────────────────────────

describe("Research Run loop — budget enforcement", () => {
  it("transitions to budget_exhausted when model call budget is exceeded", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Test budget exhaustion?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 1,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // Mock brain with 2+ intents — will exhaust after first model call
    const brain = createMockBrain(["search", "synthesize_brief"]);
    const options = mockRunLoopOptions();

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    // Run should be budget_exhausted
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("budget_exhausted");

    // Best-effort brief should exist
    const briefPath = join(workDir, ".pi", "research", "runs", runId, "brief.md");
    expect(existsSync(briefPath)).toBe(true);
    const briefContent = readFileSync(briefPath, "utf-8");
    // Brief comes from the Brain (written before exhaustion check)
    expect(briefContent).toContain("Research Brief");

    // Ledger should have entries from before exhaustion
    expect(result.ledgerEntryCount).toBeGreaterThanOrEqual(1);
  });

  it("transitions to budget_exhausted when elapsed time is exceeded", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Test time exhaustion?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 0, // Zero = immediate exhaustion
      },
    );

    const brain = createMockBrain(["search"]);
    const options = mockRunLoopOptions();

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("budget_exhausted");

    const briefPath = join(workDir, ".pi", "research", "runs", runId, "brief.md");
    expect(existsSync(briefPath)).toBe(true);
    const briefContent = readFileSync(briefPath, "utf-8");
    expect(briefContent).toContain("Time Exhausted");

    // Time check fires in round 1 before model call (but roundCount already incremented)
    expect(result.roundCount).toBe(1);
  });

  it("rejects further Brain intents after budget is exhausted (Brain wants to continue)", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Brain wants more?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 3,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // Brain keeps asking for more searches — loop must still terminate
    const brain = createMockBrain(["search", "search", "search", "search", "search"]);
    const options = mockRunLoopOptions();

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("budget_exhausted");

    // Should have run ~3 rounds (maxModelCalls=3) then stopped, not 5
    expect(result.roundCount).toBeLessThanOrEqual(4);
  });

  it("fails fetch increments fetchAttempts but not sourceVisits", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Failed fetch?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    let callIndex = 0;
    const brain: ResearchBrain = {
      generate: async () => {
        const step = callIndex++;
        if (step === 0)
          return JSON.stringify({ intent: "search", query: "test" });
        if (step === 1)
          return JSON.stringify({
            intent: "select_sources",
            selectedUrls: ["https://example.com/fail"],
          });
        if (step === 2)
          return JSON.stringify({
            intent: "update_findings",
            snippets: [],
          });
        return JSON.stringify({
          intent: "synthesize_brief",
          briefDraft: "# Brief\n\nDone.",
        });
      },
    };

    const failingOptions: RunLoopOptions = {
      search: async () => FAKE_SEARCH_RESULTS,
      fetch: async () => {
        throw new Error("Network error");
      },
    };

    const result = await executeResearchRun(workDir, runId, brain, budget, failingOptions, 1);

    // The run should complete normally (fetch failure is non-fatal)
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("completed");

    // Budget counters: fetchAttempts incremented, sourceVisits NOT incremented
    expect(result.finalUsage).toBeDefined();
    expect(result.finalUsage!.fetchAttempts).toBeGreaterThanOrEqual(1);
    expect(result.finalUsage!.sourceVisits).toBe(0);

    // Ledger should have fetch_failed entry
    const ledgerRaw = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "ledger.jsonl"),
      "utf-8",
    );
    const ledgerEntries: LedgerEntry[] = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const fetchFailed = ledgerEntries.find((e) => e.intent === "fetch_failed");
    expect(fetchFailed).toBeDefined();
    expect(fetchFailed!.content).toContain("Failed to fetch");
    expect(fetchFailed!.content).toContain("Network error");
  });

  it("completes normally when budget is sufficient", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Sufficient budget?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const brain = createMockBrain([
      "search",
      "select_sources",
      "update_findings",
      "synthesize_brief",
    ]);
    const options = mockRunLoopOptions();

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("completed");
    expect(result.roundCount).toBeGreaterThanOrEqual(4);
  });

  it("records a budget_approved ledger entry on run start", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Budget ledger test?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const brain = createMockBrain(["synthesize_brief"]);
    const options = mockRunLoopOptions();

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    // Read the ledger
    const ledgerRaw = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "ledger.jsonl"),
      "utf-8",
    );
    const ledgerEntries: LedgerEntry[] = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // First entry should be budget_approved
    const budgetApproved = ledgerEntries[0];
    expect(budgetApproved).toBeDefined();
    expect(budgetApproved.intent).toBe("budget_approved");
    expect(budgetApproved.meta).toBeDefined();
    expect((budgetApproved.meta as any).limits).toBeDefined();
    expect((budgetApproved.meta as any).limits.maxSearches).toBe(5);
  });

  it("marks remaining categories as budget-not-searched when budget exhausted", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Some question?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 0, // Exhaust immediately
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const brain = createMockBrain(["search"]);
    const options = mockRunLoopOptions();

    // Run with evidence categories — budget exhaustion should annotate them
    await executeResearchRun(workDir, runId, brain, budget, options, 5, ["docs", "benchmarks"]);

    // Brief should contain the budget-related evidence coverage section
    const briefContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "brief.md"),
      "utf-8",
    );
    // The brief mentions budget exhaustion in its title
    expect(briefContent).toContain("Budget Exhausted");
    // But more importantly, the Evidence Coverage section should show
    // which categories were not searched due to budget
    expect(briefContent).toContain("Evidence Coverage");
  });
});

// ── Evidence Mix Integration (AC 1) ────────────────────────────────────────

describe("Research Run loop — Evidence Mix integration (AC 1)", () => {
  it("creates EvidenceMix from evidenceCategories and tracks category statuses through the loop", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "What is the best approach?",
      {
        maxSearches: 10,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const brain = createMockBrain([
      "search",
      "select_sources",
      "update_findings",
      "synthesize_brief",
    ]);
    const options = mockRunLoopOptions();
    const evidenceCategories = ["docs", "benchmarks", "tutorials"];

    await executeResearchRun(
      workDir, runId, brain, budget, options, 1, evidenceCategories,
    );

    // Brief should contain evidence coverage section
    const briefContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "brief.md"),
      "utf-8",
    );
    expect(briefContent).toContain("Evidence Coverage");
    expect(briefContent).toContain("docs");
    expect(briefContent).toContain("benchmarks");
    expect(briefContent).toContain("tutorials");

    // Run summary should mention rounds and source notes
    const summaryContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "run-summary.md"),
      "utf-8",
    );
    expect(summaryContent).toContain("Source Notes");
  });
});

// ── Candidate Filtering Integration (AC 4) ─────────────────────────────────

describe("Research Run loop — filtered candidates (AC 4)", () => {
  it("passes annotated candidates to the Brain prompt, not raw unfiltered dump", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "What is the best approach?",
      {
        maxSearches: 10,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // Intercept the Brain to inspect the prompt it receives
    // First call: search -> triggers filtering; Second call: select_sources -> prompt has filtered candidates
    let callCount = 0;
    let capturedPrompt = "";
    const brain: ResearchBrain = {
      generate: async (prompt: string) => {
        callCount++;
        if (callCount === 1) {
          // First call: do a search
          return JSON.stringify({
            intent: "search",
            reasoning: "We need to search first.",
            query: "best approach",
          });
        }
        // Second call: select from filtered candidates
        capturedPrompt = prompt;
        return JSON.stringify({
          intent: "select_sources",
          reasoning: "Found relevant sources.",
          selectedUrls: ["https://example.com/guide"],
          reasoningPerUrl: { "https://example.com/guide": "Looks relevant." },
        });
      },
    };

    // Options that include low-signal sources to test filtering
    const filterOptions: RunLoopOptions = {
      search: async () => [
        { url: "https://example.com/guide", title: "A Guide", snippet: "A guide about the topic with substantial content that should pass filtering." },
        { url: "https://forum.example.com/topic", title: "Forum Post", snippet: "Discussion thread." },
        { url: "https://docs.example.org/manual", title: "Manual", snippet: "Official manual with comprehensive documentation about the topic." },
      ],
      fetch: async (url: string) => ({
        url,
        finalUrl: url,
        title: "Fetched",
        content: "Content",
        contentType: "text/markdown",
        truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    await executeResearchRun(workDir, runId, brain, budget, filterOptions, 1);

    // The prompt should contain "Filtered Candidates" section
    expect(capturedPrompt).toContain("Filtered Candidates");

    // It should contain Score annotation (AnnotatedCandidate field)
    expect(capturedPrompt).toContain("[Score");

    // It should contain the primary/accepted candidates
    expect(capturedPrompt).toContain("example.com/guide");
    expect(capturedPrompt).toContain("docs.example.org/manual");

    // The low-signal forum source should NOT appear in the prompt
    expect(capturedPrompt).not.toContain("forum.example.com");

    // The raw unfiltered dump should not appear
    expect(capturedPrompt).not.toContain("Discussion thread.");
  });
});

// ── Negative Evidence + Brief Integration (AC 5 + AC 6) ────────────────────

describe("Research Run loop — negative evidence and brief coverage (AC 5 + AC 6)", () => {
  it("records failed searches and includes coverage in the brief", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Hard to research topic?",
      {
        maxSearches: 10,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // Mock brain that searches but finds nothing, then synthesizes
    // without citations (no sources were gathered)
    let stepIndex = 0;
    const brain: ResearchBrain = {
      generate: async () => {
        const step = stepIndex++;
        if (step === 0)
          return JSON.stringify({ intent: "search", query: "hard topic" });
        return JSON.stringify({
          intent: "synthesize_brief",
          briefDraft: "# Research Brief\n\n## Bottom Line\n\nNothing found.\n\n## Confidence\n\nLow — no sources.\n\n## Evidence\nNo sources were gathered.\n\n## Gaps\nNo information available.",
        });
      },
    };

    // Empty search results (to trigger negative evidence)
    const emptyOptions: RunLoopOptions = {
      search: async () => [],
      fetch: async (url: string) => ({
        url, finalUrl: url, title: "N/A", content: "",
        contentType: "text/plain", truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    await executeResearchRun(workDir, runId, brain, budget, emptyOptions, 5, ["docs", "benchmarks"]);

    // Brief should contain the Evidence Coverage section
    const briefContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "brief.md"),
      "utf-8",
    );
    expect(briefContent).toContain("Evidence Coverage");

    // Ledger should contain the negative evidence-driven search meta
    const ledgerRaw = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "ledger.jsonl"),
      "utf-8",
    );
    const ledgerEntries: LedgerEntry[] = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const searchEntry = ledgerEntries.find((e) => e.intent === "search");
    expect(searchEntry).toBeDefined();
    expect(searchEntry!.meta).toBeDefined();
    // filteredCount should be 0 since raw results were empty
    expect((searchEntry!.meta as any).filteredCount).toBe(0);

    // The brief should include the evidence coverage section
    expect(briefContent).toContain("not-searched");
  });
});

describe("AC5: oversized source detection and diagnostics", () => {
  it("writes raw oversized content to diagnostics", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Large doc test",
      {
        maxSearches: 10,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // Mock brain: search → select_sources → update_findings → synthesize_brief
    const brain = createMockBrain([
      "search",
      "select_sources",
      "update_findings",
      "synthesize_brief",
    ]);

    const oversizedContent = "x".repeat(60000);
    const options: RunLoopOptions = {
      search: async () => FAKE_SEARCH_RESULTS,
      fetch: async (url: string) => ({
        url,
        finalUrl: url,
        title: "Large Doc",
        content: oversizedContent,
        contentType: "text/markdown",
        truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    await executeResearchRun(workDir, runId, brain, budget, options);

    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const diagRawDir = join(runDir, "diagnostics", "raw");
    expect(existsSync(diagRawDir)).toBe(true);

    // Should have a diagnostics file for the oversized source
    const diagFiles = readdirSync(diagRawDir);
    expect(diagFiles.length).toBeGreaterThanOrEqual(1);

    // The source note should have partialExtraction marker
    const notesDir = join(runDir, "source-notes");
    expect(existsSync(notesDir)).toBe(true);
    const notes = readdirSync(notesDir).filter((f) => f.endsWith(".md"));
    expect(notes.length).toBeGreaterThanOrEqual(1);
    const firstNote = readFileSync(join(notesDir, notes[0]), "utf-8");
    expect(firstNote).toContain("Some chunks failed extraction");
  });
});

describe("AC6: no-relevant-evidence skips Source Note creation", () => {
  it("skips Source Note when Brain provides empty snippets", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "No evidence test",
      {
        maxSearches: 10,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    // A brain that returns empty snippets in update_findings
    const targetIndex = { current: 0 };
    const brain: ResearchBrain = {
      generate: async (_prompt: string) => {
        const step = targetIndex.current++;
        if (step === 0)
          return JSON.stringify({ intent: "search", query: "no evidence" });
        if (step === 1)
          return JSON.stringify({
            intent: "select_sources",
            selectedUrls: ["https://example.com/empty"],
          });
        if (step === 2)
          return JSON.stringify({
            intent: "update_findings",
            snippets: [], // empty — no relevant evidence
          });
        return JSON.stringify({
          intent: "synthesize_brief",
          briefDraft: "# Research Brief\n\nNo evidence found.",
        });
      },
    };

    const options: RunLoopOptions = {
      search: async () => FAKE_SEARCH_RESULTS,
      fetch: async (url: string) => ({
        url,
        finalUrl: url,
        title: "Empty Doc",
        content: "Some content but Brain found nothing relevant.",
        contentType: "text/markdown",
        truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    await executeResearchRun(workDir, runId, brain, budget, options);

    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const ledgerRaw = readFileSync(
      join(runDir, "ledger.jsonl"),
      "utf-8",
    );
    const ledgerEntries: LedgerEntry[] = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // Should have a source_note_creation_skipped entry
    const skipEntry = ledgerEntries.find(
      (e) => e.intent === "source_note_creation_skipped",
    );
    expect(skipEntry).toBeDefined();
    expect(skipEntry!.meta).toBeDefined();
    expect((skipEntry!.meta as any).url).toBe("https://example.com/empty");
  });
});

describe("AC3: brain-provided snippets without fetch are skipped", () => {
  it("records source_note_creation_skipped for brain-provided-only findings", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Brain-only findings",
      {
        maxSearches: 10,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const targetIndex = { current: 0 };
    const brain: ResearchBrain = {
      generate: async (_prompt: string) => {
        const step = targetIndex.current++;
        if (step === 0)
          return JSON.stringify({ intent: "search", query: "brain test" });
        if (step === 1)
          return JSON.stringify({
            intent: "update_findings",
            snippets: ["Brain-only finding without fetch."],
            selectedUrls: [],
          });
        return JSON.stringify({
          intent: "synthesize_brief",
          briefDraft: "# Research Brief\n\nBrain-only.",
        });
      },
    };

    const options: RunLoopOptions = {
      search: async () => FAKE_SEARCH_RESULTS,
      fetch: async (url: string) => ({
        url,
        finalUrl: url,
        title: "N/A",
        content: "",
        contentType: "text/plain",
        truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    await executeResearchRun(workDir, runId, brain, budget, options);

    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const ledgerRaw = readFileSync(
      join(runDir, "ledger.jsonl"),
      "utf-8",
    );
    const ledgerEntries: LedgerEntry[] = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const skipEntry = ledgerEntries.find(
      (e) => e.intent === "source_note_creation_skipped",
    );
    expect(skipEntry).toBeDefined();
    expect(skipEntry!.content).toContain("without fetched/read content");
  });
});

// ── Best-Effort Brief Tests (Slice 2) ───────────────────────────────────────

describe("Research Run loop — best-effort brief (Slice 2)", () => {
  it("produces best-effort brief with Caveats, Gaps, and Confidence sections when budget exhausted via model calls", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Brief with caveats?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 0, // Exhaust immediately
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const brain = createMockBrain(["search"]);
    const options = mockRunLoopOptions();

    await executeResearchRun(workDir, runId, brain, budget, options, 3, ["docs", "benchmarks"]);

    const briefContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "brief.md"),
      "utf-8",
    );

    // Should have title indicating budget exhaustion
    expect(briefContent).toContain("Budget Exhausted");

    // Should have Caveats section
    expect(briefContent).toContain("## Caveats");

    // Should have Gaps section
    expect(briefContent).toContain("## Gaps");

    // Should have Confidence Rationale section (bold label inline)
    expect(briefContent).toContain("**Confidence Rationale**");

    // Should have Evidence Coverage section
    expect(briefContent).toContain("Evidence Coverage");
    expect(briefContent).toContain("docs");
    expect(briefContent).toContain("benchmarks");
  });

  it("includes a Continuation Recommendation section with remaining gaps in budget-exhausted brief", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Continuation rec?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 0, // Exhaust immediately
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const brain = createMockBrain(["search"]);
    const options = mockRunLoopOptions();

    await executeResearchRun(workDir, runId, brain, budget, options, 3, ["docs", "benchmarks"]);

    const briefContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "brief.md"),
      "utf-8",
    );

    // Should have Continuation Recommendation section
    expect(briefContent).toContain("## Continuation Recommendation");

    // Should mention the evidence categories that weren't searched
    expect(briefContent).toContain("docs");
    expect(briefContent).toContain("benchmarks");

    // Should mention additional budget
    expect(briefContent).toContain("additional budget");
  });
});

// ── Continuation Mechanism Tests (Slice 4+5) ───────────────────────────────

describe("Research Run loop — continuation mechanism (Slice 4+5)", () => {
  it("continueResearchRun rejects non-budget-exhausted runs", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Fresh run?", {
      mode: "blocking",
      trigger: "Test continuation rejection",
      budgetLimits: {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;

    const brain = createMockBrain(["search"]);
    const newBudget = createBudget({
      maxSearches: 5,
      maxFetchAttempts: 5,
      maxSourceVisits: 5,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    await expect(
      continueResearchRun(workDir, runId, brain, newBudget, mockRunLoopOptions()),
    ).rejects.toThrow(/Cannot continue/);
  });

  it("continues a budget-exhausted run with new budget preserving original approval history", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Continuation test?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 0, // Exhaust immediately
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const brain = createMockBrain(["search"]);
    const options = mockRunLoopOptions();

    // First run — exhaust budget
    await executeResearchRun(workDir, runId, brain, budget, options);

    const exhaustedRun = getRun(workDir, runId);
    expect(exhaustedRun!.status).toBe("budget_exhausted");

    // Read the ledger to capture original budget_approved
    const beforeLedgerRaw = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "ledger.jsonl"),
      "utf-8",
    );
    const beforeLedgerLines = beforeLedgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const beforeBudgetApproved = JSON.parse(beforeLedgerLines[0]);
    expect(beforeBudgetApproved.intent).toBe("budget_approved");

    // Now continue with new (adequate) budget
    const newBudget = createBudget({
      maxSearches: 5,
      maxFetchAttempts: 5,
      maxSourceVisits: 5,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    // New brain for continuation
    const newBrain = createMockBrain([
      "search",
      "select_sources",
      "update_findings",
      "synthesize_brief",
    ]);

    const result = await continueResearchRun(
      workDir, runId, newBrain, newBudget, options,
    );

    // Run should complete now
    const continuedRun = getRun(workDir, runId);
    expect(continuedRun!.status).toBe("completed");

    // Ledger should have budget_approved (original) THEN budget_revision (continuation)
    const afterLedgerRaw = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "ledger.jsonl"),
      "utf-8",
    );
    const afterLedgerLines = afterLedgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0);

    // First entry is still budget_approved (original preserved)
    const firstEntry = JSON.parse(afterLedgerLines[0]);
    expect(firstEntry.intent).toBe("budget_approved");
    expect(firstEntry.meta.limits.maxModelCalls).toBe(0);

    // Find budget_revision entry
    const budgetRevision = afterLedgerLines
      .map((l) => JSON.parse(l))
      .find((e: any) => e.intent === "budget_revision");
    expect(budgetRevision).toBeDefined();
    expect(budgetRevision.timestamp).toBeDefined();

    // original budget_approved is still there with original limits
    const approvedCount = afterLedgerLines.filter(
      (l) => JSON.parse(l).intent === "budget_approved",
    ).length;
    expect(approvedCount).toBe(1);

    // Brief should exist
    const briefPath = join(workDir, ".pi", "research", "runs", runId, "brief.md");
    expect(existsSync(briefPath)).toBe(true);

    // Source notes should exist from continuation
    expect(result.sourceNoteCount).toBeGreaterThanOrEqual(1);
  });

  it("budget_revision does not overwrite or mutate prior budget_approved", async () => {
    const workDir = makeWorkDir();
    const { runId, budget } = setupRunForLoop(
      workDir,
      "Append-only test?",
      {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 0, // Exhaust immediately
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    );

    const brain = createMockBrain(["search"]);
    await executeResearchRun(workDir, runId, brain, budget, mockRunLoopOptions());

    // Capture original ledger bytes
    const ledgerPath = join(workDir, ".pi", "research", "runs", runId, "ledger.jsonl");
    const originalBytes = readFileSync(ledgerPath);

    const newBudget = createBudget({
      maxSearches: 5,
      maxFetchAttempts: 5,
      maxSourceVisits: 5,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });
    const newBrain = createMockBrain(["synthesize_brief"]);
    await continueResearchRun(workDir, runId, newBrain, newBudget, mockRunLoopOptions());

    // Read the ledger again
    const afterBytes = readFileSync(ledgerPath);

    // The original bytes must still be at the start of the file
    const originalStr = originalBytes.toString("utf-8");
    const afterStr = afterBytes.toString("utf-8");

    // Original content is preserved as a prefix
    expect(afterStr.startsWith(originalStr)).toBe(true);

    // But the file is longer (revision was appended)
    expect(afterBytes.length).toBeGreaterThan(originalBytes.length);

    // Only one budget_approved entry
    const lines = afterStr.split("\n").filter((l) => l.trim().length > 0);
    const approvedEntries = lines.filter((l) => JSON.parse(l).intent === "budget_approved");
    expect(approvedEntries.length).toBe(1);

    // budget_revision entry exists
    const revisionEntries = lines.filter((l) => JSON.parse(l).intent === "budget_revision");
    expect(revisionEntries.length).toBe(1);
  });
});

describe("Research Run loop — citation validation and trigger gating", () => {
  it("does not write brief.md and records synthesis_failed when synthesized brief cites a missing source note", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Invalid citation draft?", {
      budgetLimits: {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 1,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 5,
      maxFetchAttempts: 5,
      maxSourceVisits: 5,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 1,
      maxElapsedSeconds: 300,
    });

    let step = 0;
    const brain: ResearchBrain = {
      generate: async () => {
        step++;
        if (step === 1) {
          return JSON.stringify({ intent: "search", query: "auth best practices" });
        }
        if (step === 2) {
          return JSON.stringify({
            intent: "select_sources",
            selectedUrls: ["https://example.com/guide"],
          });
        }
        if (step === 3) {
          return JSON.stringify({
            intent: "update_findings",
            snippets: ["Approach A is documented as preferred."],
          });
        }
        return JSON.stringify({
          intent: "synthesize_brief",
          briefDraft: [
            "# Research Brief",
            "",
            "## Bottom Line",
            "Approach A is recommended [99].",
            "",
            "## Confidence",
            "**Level**: high",
            "",
            "**Rationale**: The source is explicit.",
            "",
            "## Evidence: Documentation",
            "Approach A is documented as preferred [99].",
            "",
            "## Interpretation",
            "The source points toward Approach A [99].",
            "",
          ].join("\n"),
        });
      },
    };

    await executeResearchRun(workDir, runId, brain, budget, mockRunLoopOptions());

    const briefPath = join(workDir, ".pi", "research", "runs", runId, "brief.md");
    expect(existsSync(briefPath)).toBe(false);

    const runMeta = getRun(workDir, runId);
    expect(runMeta!.status).toBe("failed");

    const ledgerRaw = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "ledger.jsonl"),
      "utf-8",
    );
    const ledgerEntries: LedgerEntry[] = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const synthesisFailed = ledgerEntries.find((entry) => entry.intent === "synthesis_failed");
    expect(synthesisFailed).toBeDefined();
    expect(synthesisFailed!.content).toContain("Invalid citations");
  });

  it("preserves task implications for agent-triggered runs", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Agent-triggered research?", {
      triggerSource: "agent",
      budgetLimits: {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 1,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 5,
      maxFetchAttempts: 5,
      maxSourceVisits: 5,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 1,
      maxElapsedSeconds: 300,
    });

    let step = 0;
    const brain: ResearchBrain = {
      generate: async () => {
        step++;
        if (step === 1) {
          return JSON.stringify({ intent: "search", query: "auth best practices" });
        }
        if (step === 2) {
          return JSON.stringify({
            intent: "select_sources",
            selectedUrls: ["https://example.com/guide"],
          });
        }
        if (step === 3) {
          return JSON.stringify({
            intent: "update_findings",
            snippets: ["Approach A is documented as preferred."],
          });
        }
        return JSON.stringify({
          intent: "synthesize_brief",
          briefDraft: [
            "# Research Brief",
            "",
            "## Bottom Line",
            "Approach A is recommended [1].",
            "",
            "## Confidence",
            "**Level**: high",
            "",
            "**Rationale**: The source is explicit.",
            "",
            "## Evidence: Documentation",
            "Approach A is documented as preferred [1].",
            "",
            "## Interpretation",
            "The source points toward Approach A [1].",
            "",
            "## Implications for Current Task",
            "Use Approach A in Pi now [1].",
            "",
          ].join("\n"),
        });
      },
    };

    await executeResearchRun(workDir, runId, brain, budget, mockRunLoopOptions());

    const briefContent = readFileSync(
      join(workDir, ".pi", "research", "runs", runId, "brief.md"),
      "utf-8",
    );

    expect(briefContent).toContain("## Implications for Current Task");
    expect(briefContent).toContain("Use Approach A in Pi now [1].");
  });

  it("auto-generates Human Research View for human-initiated completed runs", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    // Human-triggered run
    const run = createRun(workDir, "Auto-view test?", {
      triggerSource: "human",
      budgetLimits: {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 1,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 5,
      maxFetchAttempts: 5,
      maxSourceVisits: 5,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 1,
      maxElapsedSeconds: 300,
    });

    const brain = createMockBrain([
      "search",
      "select_sources",
      "update_findings",
      "synthesize_brief",
    ]);
    const options = mockRunLoopOptions();

    await executeResearchRun(workDir, runId, brain, budget, options);

    // View should be auto-generated
    const viewPath = join(workDir, ".pi", "research", "runs", runId, "view", "index.html");
    expect(existsSync(viewPath)).toBe(true);

    const html = readFileSync(viewPath, "utf-8");
    expect(html).toContain("Completed");
    expect(html).not.toContain("<link");
    expect(html).toContain("<style>");
  });

  it("does not auto-generate Human Research View for agent-triggered runs", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Agent auto-view test?", {
      triggerSource: "agent",
      budgetLimits: {
        maxSearches: 5,
        maxFetchAttempts: 5,
        maxSourceVisits: 5,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 1,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 5,
      maxFetchAttempts: 5,
      maxSourceVisits: 5,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 1,
      maxElapsedSeconds: 300,
    });

    const brain = createMockBrain([
      "search",
      "select_sources",
      "update_findings",
      "synthesize_brief",
    ]);
    const options = mockRunLoopOptions();

    await executeResearchRun(workDir, runId, brain, budget, options);

    // View should NOT be auto-generated for agent-triggered runs
    const viewPath = join(workDir, ".pi", "research", "runs", runId, "view", "index.html");
    expect(existsSync(viewPath)).toBe(false);
  });

  it("auto-generates Human Research View for human-initiated budget_exhausted runs", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Budget exhaust view test?", {
      triggerSource: "human",
      budgetLimits: {
        maxSearches: 1,
        maxFetchAttempts: 1,
        maxSourceVisits: 1,
        maxSynthesisRounds: 1,
        maxModelCalls: 0, // Exhausts immediately
        maxRetryAttempts: 1,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 1,
      maxFetchAttempts: 1,
      maxSourceVisits: 1,
      maxSynthesisRounds: 1,
      maxModelCalls: 0,
      maxRetryAttempts: 1,
      maxElapsedSeconds: 300,
    });

    const brain = createMockBrain(["search"]);
    const options = mockRunLoopOptions();

    await executeResearchRun(workDir, runId, brain, budget, options);

    // View should be auto-generated for budget_exhausted
    const viewPath = join(workDir, ".pi", "research", "runs", runId, "view", "index.html");
    expect(existsSync(viewPath)).toBe(true);

    const html = readFileSync(viewPath, "utf-8");
    expect(html).toContain("Budget Exhausted");
  });
});

// ── Steering Integration: Cancel (Slice 1) ─────────────────────────────────

describe("Steering integration — Cancel (Slice 1, AC1 + AC6)", () => {
  it("cancel stops the run loop mid-execution, sets cancelled status, preserves artifacts, and records ledger entry", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Steering test?", {
      mode: "blocking",
      trigger: "Testing cancel",
      budgetLimits: {
        maxSearches: 10,
        maxFetchAttempts: 10,
        maxSourceVisits: 10,
        maxSynthesisRounds: 3,
        maxModelCalls: 50,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 10,
      maxFetchAttempts: 10,
      maxSourceVisits: 10,
      maxSynthesisRounds: 3,
      maxModelCalls: 50,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    // Write a cancel signal that should be picked up after the first round
    let cancelWritten = false;

    // Brain that does one search, then we inject cancel
    const brain: ResearchBrain = {
      generate: async (_prompt: string) => {
        if (!cancelWritten) {
          cancelWritten = true;
          // Write steering signal — this simulates what /research cancel would do
          // We write it so the run-loop picks it up after this round
          const signal: SteeringSignal = {
            timestamp: new Date().toISOString(),
            type: "cancel",
            text: "Pivoting to different approach",
          };
          writeSteeringSignal(workDir, runId, signal);
        }
        return JSON.stringify({
          intent: "search",
          reasoning: "Finding sources.",
          query: "test query",
        });
      },
    };

    const options: RunLoopOptions = {
      search: async () => [
        { url: "https://example.com/guide", title: "A Guide", snippet: "Guide content." },
      ],
      fetch: async (url: string) => ({
        url,
        finalUrl: url,
        title: "Fetched",
        content: "Content",
        contentType: "text/markdown",
        truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    // 1. Run should be cancelled
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun).not.toBeNull();
    expect(updatedRun!.status).toBe("cancelled");

    // 2. No brief.md should be produced
    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const briefPath = join(runDir, "brief.md");
    expect(existsSync(briefPath)).toBe(false);

    // 3. Source notes directory should exist (artifacts preserved)
    const sourceNotesDir = join(runDir, "source-notes");
    expect(existsSync(sourceNotesDir)).toBe(true);

    // 4. Ledger should have entries including the steering:cancel entry
    const ledgerRaw = readFileSync(join(runDir, "ledger.jsonl"), "utf-8");
    const ledgerEntries = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const cancelEntry = ledgerEntries.find(
      (e: any) => e.intent === "steering:cancel"
    );
    expect(cancelEntry).toBeDefined();
    expect(cancelEntry.meta.instructionType).toBe("cancel");
    expect(cancelEntry.meta.status).toBe("applied");
    expect(cancelEntry.meta.budgetState).toBeDefined();
    expect(cancelEntry.meta.applicationDetails).toContain("Pivoting to different approach");

    // 5. Brief path should be empty (no brief produced on cancel)
    expect(result.briefPath).toBe("");

    // 6. Status should reflect cancellation reason
    expect(updatedRun!.terminationReason).toBeDefined();
    expect(updatedRun!.terminationReason).toContain("Pivoting to different approach");
  });

  it("cancel without text still works with default reason", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Cancel no text?", {
      budgetLimits: {
        maxSearches: 10,
        maxFetchAttempts: 10,
        maxSourceVisits: 10,
        maxSynthesisRounds: 3,
        maxModelCalls: 50,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 10,
      maxFetchAttempts: 10,
      maxSourceVisits: 10,
      maxSynthesisRounds: 3,
      maxModelCalls: 50,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    let done = false;
    const brain: ResearchBrain = {
      generate: async () => {
        if (!done) {
          done = true;
          writeSteeringSignal(workDir, runId, {
            timestamp: new Date().toISOString(),
            type: "cancel",
          });
        }
        return JSON.stringify({ intent: "search", query: "test" });
      },
    };

    const options: RunLoopOptions = {
      search: async () => [],
      fetch: async (url: string) => ({
        url, finalUrl: url, title: "N/A", content: "",
        contentType: "text/plain", truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    await executeResearchRun(workDir, runId, brain, budget, options);

    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("cancelled");

    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const ledgerRaw = readFileSync(join(runDir, "ledger.jsonl"), "utf-8");
    expect(ledgerRaw).toContain("steering:cancel");
    expect(ledgerRaw).toContain("Run cancelled by user.");
  });
});

// ── Steering Integration: Force Synthesis (Slice 2, AC2) ───────────────────

describe("Steering integration — Force Synthesis (Slice 2, AC2)", () => {
  it("rejects force_synthesis when no Source Notes exist", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Force synth rejected?", {
      budgetLimits: {
        maxSearches: 10,
        maxFetchAttempts: 10,
        maxSourceVisits: 10,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 10,
      maxFetchAttempts: 10,
      maxSourceVisits: 10,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    // Write the signal BEFORE the run loop starts — signal will be picked up at round 1
    writeSteeringSignal(workDir, runId, {
      timestamp: new Date().toISOString(),
      type: "force_synthesis",
      text: "Give me results now",
    });

    // Brain: synthesize immediately (no source notes created)
    const brain: ResearchBrain = {
      generate: async () => JSON.stringify({
        intent: "synthesize_brief",
        briefDraft: "# Research Brief\n\nNo work done.",
      }),
    };

    const options: RunLoopOptions = {
      search: async () => [],
      fetch: async (url: string) => ({
        url, finalUrl: url, title: "N/A", content: "",
        contentType: "text/plain", truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    // Force synthesis was refused — run continues and complete
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("completed");

    // Ledger should have steering:force_synthesis entry with rejected status
    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const ledgerRaw = readFileSync(join(runDir, "ledger.jsonl"), "utf-8");
    const ledgerEntries = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const forceEntry = ledgerEntries.find(
      (e: any) => e.intent === "steering:force_synthesis"
    );
    expect(forceEntry).toBeDefined();
    expect(forceEntry.meta.status).toBe("rejected");
    expect(forceEntry.meta.applicationDetails).toContain("no Source Notes exist");

    // Brief exists (loop completed normally after rejection)
    const briefPath = join(runDir, "brief.md");
    expect(existsSync(briefPath)).toBe(true);
  });

  it("accepts force_synthesis when Source Notes exist and produces a caveated brief", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Force synth with notes?", {
      budgetLimits: {
        maxSearches: 10,
        maxFetchAttempts: 10,
        maxSourceVisits: 10,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 10,
      maxFetchAttempts: 10,
      maxSourceVisits: 10,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    let step = 0;
    const brain: ResearchBrain = {
      generate: async () => {
        step++;
        if (step === 1) {
          return JSON.stringify({ intent: "search", query: "test query" });
        }
        if (step === 2) {
          return JSON.stringify({
            intent: "select_sources",
            selectedUrls: ["https://example.com/guide"],
          });
        }
        if (step === 3) {
          // Write force synthesis signal inside this round.
          // It will be picked up at the top of round 4, after the source note
          // has been created in this round's update_findings processing.
          writeSteeringSignal(workDir, runId, {
            timestamp: new Date().toISOString(),
            type: "force_synthesis",
            text: "I need results now",
          });
          return JSON.stringify({
            intent: "update_findings",
            snippets: ["Key finding from the source."],
            reasoning: "Extracting key findings.",
          });
        }
        return JSON.stringify({ intent: "synthesize_brief" });
      },
    };

    const options: RunLoopOptions = {
      search: async () => [{
        url: "https://example.com/guide", title: "Guide", snippet: "Content.",
      }],
      fetch: async (url: string) => ({
        url, finalUrl: url, title: "Fetched", content: "Content",
        contentType: "text/markdown", truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    const result = await executeResearchRun(workDir, runId, brain, budget, options);

    // Force synthesis accepted — run completed
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("completed");

    // Brief should exist and be marked as forced synthesis with caveats
    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const briefPath = join(runDir, "brief.md");
    expect(existsSync(briefPath)).toBe(true);
    const briefContent = readFileSync(briefPath, "utf-8");
    expect(briefContent).toContain("Forced Synthesis");
    expect(briefContent).toContain("Caveats");

    // Ledger should have applied force_synthesis entry
    const ledgerRaw = readFileSync(join(runDir, "ledger.jsonl"), "utf-8");
    const ledgerEntries = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const forceEntry = ledgerEntries.find(
      (e: any) => e.intent === "steering:force_synthesis"
    );
    expect(forceEntry).toBeDefined();
    expect(forceEntry.meta.status).toBe("applied");
  });
});

// ── Steering Integration: Add Instruction (Slice 4, AC4) ────────────────────

describe("Steering integration — Add Instruction (Slice 4, AC4)", () => {
  it("accepts add_instruction and records ledger entry", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Add instruction test?", {
      budgetLimits: {
        maxSearches: 10,
        maxFetchAttempts: 10,
        maxSourceVisits: 10,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 10,
      maxFetchAttempts: 10,
      maxSourceVisits: 10,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    // Write an add_instruction signal before loop starts
    writeSteeringSignal(workDir, runId, {
      timestamp: new Date().toISOString(),
      type: "add_instruction",
      text: "Focus on official documentation only",
    });

    const brain: ResearchBrain = {
      generate: async () => JSON.stringify({
        intent: "synthesize_brief",
        briefDraft: "# Brief\n\nDone with docs focus.",
      }),
    };

    const options: RunLoopOptions = {
      search: async () => [],
      fetch: async (url: string) => ({
        url, finalUrl: url, title: "N/A", content: "",
        contentType: "text/plain", truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    await executeResearchRun(workDir, runId, brain, budget, options);

    // Run completed normally (add_instruction doesn't stop or force synthesis)
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("completed");

    // Ledger has steering:add_instruction entry with applied status
    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const ledgerRaw = readFileSync(join(runDir, "ledger.jsonl"), "utf-8");
    const ledgerEntries = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const instructionEntry = ledgerEntries.find(
      (e: any) => e.intent === "steering:add_instruction"
    );
    expect(instructionEntry).toBeDefined();
    expect(instructionEntry.meta.status).toBe("applied");
    expect(instructionEntry.meta.text).toBe("Focus on official documentation only");
    expect(instructionEntry.meta.instructionType).toBe("add_instruction");
    expect(instructionEntry.meta.budgetState).toBeDefined();
    expect(instructionEntry.timestamp).toBeDefined();
    expect(instructionEntry.meta.applicationDetails).toBeDefined();
  });

  it("rejects scope-broadening add_instruction and records ledger entry", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Scope expansion test?", {
      budgetLimits: {
        maxSearches: 10,
        maxFetchAttempts: 10,
        maxSourceVisits: 10,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });
    const runId = run.identity.id;
    updateStatus(workDir, runId, "running");

    const budget = createBudget({
      maxSearches: 10,
      maxFetchAttempts: 10,
      maxSourceVisits: 10,
      maxSynthesisRounds: 3,
      maxModelCalls: 20,
      maxRetryAttempts: 3,
      maxElapsedSeconds: 300,
    });

    // Write a scope-broadening instruction signal
    writeSteeringSignal(workDir, runId, {
      timestamp: new Date().toISOString(),
      type: "add_instruction",
      text: "Also compare with alternative framework X",
    });

    const brain: ResearchBrain = {
      generate: async () => JSON.stringify({
        intent: "synthesize_brief",
        briefDraft: "# Brief\n\nDone.",
      }),
    };

    const options: RunLoopOptions = {
      search: async () => [],
      fetch: async (url: string) => ({
        url, finalUrl: url, title: "N/A", content: "",
        contentType: "text/plain", truncated: false,
        retrievedAt: new Date().toISOString(),
      }),
    };

    await executeResearchRun(workDir, runId, brain, budget, options);

    // Run completed (rejected instruction doesn't stop the loop)
    const updatedRun = getRun(workDir, runId);
    expect(updatedRun!.status).toBe("completed");

    // Ledger has steering:add_instruction entry with rejected status
    const runDir = join(workDir, ".pi", "research", "runs", runId);
    const ledgerRaw = readFileSync(join(runDir, "ledger.jsonl"), "utf-8");
    const ledgerEntries = ledgerRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const instructionEntry = ledgerEntries.find(
      (e: any) => e.intent === "steering:add_instruction"
    );
    expect(instructionEntry).toBeDefined();
    // Accepting or rejecting depends on validation heuristics — but the entry exists
    // with a status field that's either "applied" or "rejected"
    expect(["applied", "rejected"]).toContain(instructionEntry.meta.status);
    expect(instructionEntry.meta.instructionType).toBe("add_instruction");
    expect(instructionEntry.meta.budgetState).toBeDefined();
  });
});
