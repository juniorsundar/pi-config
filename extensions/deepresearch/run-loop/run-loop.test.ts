import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore } from "../workspace/store";
import { createRun, updateStatus, getRun } from "../lifecycle/run-store";
import { createBudget, type BudgetLimits } from "../budgets/budget";
import type { ResearchBrain } from "../brain/harness/types";
import { executeResearchRun } from "./run-loop";
import type { RunLoopOptions, LedgerEntry } from "./types";

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
    const brain = createMockBrain(["search", "synthesize_brief"]);

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
