import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore } from "../workspace/store";
import { createRun, updateStatus, getRun } from "../lifecycle/run-store";
import { createBudget, type BudgetLimits } from "../budgets/budget";
import type { ResearchBrain } from "../brain/harness/types";
import { executeResearchRun } from "./run-loop";
import type { RunLoopOptions } from "./types";

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
});
