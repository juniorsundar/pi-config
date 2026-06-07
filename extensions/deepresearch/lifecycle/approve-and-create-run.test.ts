import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore } from "../workspace/store";
import {
  createProposal,
  getProposal,
} from "../proposals/proposal-manager";
import { approveAndCreateRun, approveAndActivateRun } from "./approve-and-create-run";
import { updateStatus } from "./run-store";
import type { ResolvedModel } from "../brain/setup-policy/setup-policy";

let workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-approve-"));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe("approveAndCreateRun (tracer bullet)", () => {
  it("approves a proposal and creates a Research Run with readable identity", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Is Deno better than Node.js for CLI tools?",
      trigger: "Evaluating runtime options for a new CLI project",
      mode: "blocking",
    });

    const result = approveAndCreateRun(workDir, proposal.identity.id);

    // Run has a readable identity (date-slug-shortId)
    expect(result.identity.id).toMatch(/^\d{4}-\d{2}-\d{2}-is-deno-better-than-nodejs[0-9a-f-]+/);
    expect(result.identity.date).toBeTypeOf("string");
    expect(result.identity.slug).toContain("is-deno-better-than-nodejs");
    expect(result.identity.shortId).toHaveLength(8);

    // Run starts as queued (tracer bullet — no activation yet)
    expect(result.status).toBe("queued");
  });

  it("carries approved proposal content into the Research Run", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Should we use Rust or Go?",
      trigger: "Choosing a language for a high-performance service",
      mode: "background",
      budget: { maxSearches: 5, maxSourceVisits: 3 },
    });

    const result = approveAndCreateRun(workDir, proposal.identity.id);

    // Run carries the question
    expect(result.question).toBe("Should we use Rust or Go?");

    // Run carries the trigger
    expect(result.trigger).toBe(
      "Choosing a language for a high-performance service",
    );

    // Run carries the mode
    expect(result.mode).toBe("background");

    // Run carries the budget limits
    expect(result.budgetLimits).toEqual({
      maxSearches: 5,
      maxSourceVisits: 3,
    });
  });

  it("writes a copy of proposal.md into the run directory", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Which framework is best?",
      trigger: "Evaluating frameworks for a new project",
    });

    const result = approveAndCreateRun(workDir, proposal.identity.id);

    // proposal.md should exist in the run directory
    const runProposalPath = join(
      workDir,
      ".pi",
      "research",
      "runs",
      result.identity.id,
      "proposal.md",
    );
    expect(existsSync(runProposalPath)).toBe(true);

    const content = readFileSync(runProposalPath, "utf-8");
    expect(content).toContain("Which framework is best?");
    expect(content).toContain("approved"); // status header
  });

  it("persists the run status.json with all carried fields", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Persistence test?",
      trigger: "Testing on-disk persistence",
      mode: "blocking",
    });

    const result = approveAndCreateRun(workDir, proposal.identity.id);

    // Re-read from disk to verify persistence
    const statusPath = join(
      workDir,
      ".pi",
      "research",
      "runs",
      result.identity.id,
      "status.json",
    );
    const raw = readFileSync(statusPath, "utf-8");
    const reloaded = JSON.parse(raw);

    expect(reloaded.question).toBe("Persistence test?");
    expect(reloaded.trigger).toBe("Testing on-disk persistence");
    expect(reloaded.mode).toBe("blocking");
    expect(reloaded.status).toBe("queued");
  });

  it("marks the proposal as approved", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Will be approved?",
      trigger: "A valid trigger",
    });

    approveAndCreateRun(workDir, proposal.identity.id);

    // Proposal should be marked approved
    const reloaded = getProposal(workDir, proposal.identity.id);
    expect(reloaded.status).toBe("approved");
  });

  it("throws when proposal is not found", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    expect(() => approveAndCreateRun(workDir, "nonexistent-id")).toThrow(
      "Proposal not found",
    );
  });

  it("throws when proposal has missing required fields", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Will be corrupted",
      trigger: "A trigger",
    });

    // Corrupt proposal.md
    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      proposal.identity.id,
    );
    rmSync(join(proposalPath, "proposal.md"));

    expect(() => approveAndCreateRun(workDir, proposal.identity.id)).toThrow(
      "cannot be approved",
    );
  });
});

describe("approveAndCreateRun (proposal.md roundtrip)", () => {
  it("hand-edited proposal.md is authoritative for run content", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Original question?",
      trigger: "Original trigger",
      mode: "blocking",
    });

    // Hand-edit proposal.md
    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      proposal.identity.id,
    );
    const handEdited = `# Research Proposal
**Status**: draft
**Trigger**: human

## Research Question

Hand-edited question?

## Research Trigger

Hand-edited trigger

## Mode

background
`;
    writeFileSync(
      join(proposalPath, "proposal.md"),
      handEdited,
    );

    const result = approveAndCreateRun(workDir, proposal.identity.id);

    // Run should use the hand-edited content
    expect(result.question).toBe("Hand-edited question?");
    expect(result.trigger).toBe("Hand-edited trigger");
    expect(result.mode).toBe("background");

    // Run proposal.md copy should also have hand-edited content
    const runProposalPath = join(
      workDir,
      ".pi",
      "research",
      "runs",
      result.identity.id,
      "proposal.md",
    );
    const runCopy = readFileSync(runProposalPath, "utf-8");
    expect(runCopy).toContain("Hand-edited question?");
    expect(runCopy).toContain("Hand-edited trigger");
  });
});

// ── Shared test helpers for activation phases ────────────────────────────

const resolvedModel: ResolvedModel = {
  model: "tongyi-deepresearch:30b",
  provider: "ollama",
  host: "http://localhost:11434",
  source: "conventional_default",
};

function passingBrain(model: string) {
  const responses: Record<string, string> = {
    "structured-intents": JSON.stringify({ intent: "search" }),
    "inline-thinking": "Clean response without thinking tags.",
    "stop-behavior": JSON.stringify({
      intent: "stop_early",
      reasoning: "sufficient",
    }),
    "fenced-output": JSON.stringify({ intent: "search" }),
    "source-note": JSON.stringify({
      url: "https://example.com",
      title: "Example",
      snippets: ["Finding"],
      citation_number: 1,
    }),
    synthesis: "Findings show results [1] and [2] support the conclusion.",
  };
  return {
    model,
    generate: async (prompt: string) => {
      for (const [key, value] of Object.entries(responses)) {
        if (prompt.includes(`probe: ${key}`)) return value;
      }
      return "";
    },
  };
}

// ── Phase 3: Immediate activation when no active run ────────────────────

describe("approveAndActivateRun (immediate activation)", () => {
  it("activates immediately when no active run exists", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Is Rust good for web servers?",
      trigger: "Choosing a backend language",
      mode: "blocking",
    });
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await approveAndActivateRun(
      workDir,
      proposal.identity.id,
      resolvedModel,
      brain,
    );

    expect(result.run.status).toBe("running");
    expect(result.activated).toBe(true);
  });

  it("carries proposal content into the activated run", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Which database should we use?",
      trigger: "Evaluating database options for production",
      mode: "blocking",
      budget: { maxSearches: 5, maxSourceVisits: 3 },
    });
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await approveAndActivateRun(
      workDir,
      proposal.identity.id,
      resolvedModel,
      brain,
    );

    expect(result.run.question).toBe("Which database should we use?");
    expect(result.run.trigger).toBe(
      "Evaluating database options for production",
    );
    expect(result.run.mode).toBe("blocking");
  });

  it("returns the readiness result when activated", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Test readiness result?",
      trigger: "A valid trigger",
    });
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await approveAndActivateRun(
      workDir,
      proposal.identity.id,
      resolvedModel,
      brain,
    );

    expect(result.activationResult).toBeDefined();
    expect(result.activationResult!.ready).toBe(true);
    expect(result.activationResult!.testedModel).toBe(
      "tongyi-deepresearch:30b",
    );
  });
});

// ── Phase 4: Queued activation when active run exists ───────────────────

describe("approveAndActivateRun (queued activation)", () => {
  it("stays queued when another run is already active", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    // Create and activate a run (simulate active run)
    const { createRun } = await import("./run-store");
    const activeRun = createRun(workDir, "Active run question");
    updateStatus(workDir, activeRun.identity.id, "running");

    // Create and approve a new proposal
    const proposal = createProposal(workDir, {
      question: "This should be queued",
      trigger: "A valid trigger",
    });
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await approveAndActivateRun(
      workDir,
      proposal.identity.id,
      resolvedModel,
      brain,
    );

    expect(result.run.status).toBe("queued");
    expect(result.activated).toBe(false);
  });

  it("does not run readiness when queued", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    // Create an active run
    const { createRun } = await import("./run-store");
    const activeRun = createRun(workDir, "Active run");
    updateStatus(workDir, activeRun.identity.id, "synthesizing");

    const proposal = createProposal(workDir, {
      question: "Should stay queued?",
      trigger: "A valid trigger",
    });
    // Use a brain that would fail readiness — to prove we didn't run it
    let generateCalls = 0;
    const brain = {
      model: "tongyi-deepresearch:30b",
      generate: async (_prompt: string) => {
        generateCalls++;
        throw new Error("Should not be called");
      },
    };

    const result = await approveAndActivateRun(
      workDir,
      proposal.identity.id,
      resolvedModel,
      brain,
    );

    expect(result.run.status).toBe("queued");
    expect(generateCalls).toBe(0);
  });

  it("no activation result when queued", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const { createRun } = await import("./run-store");
    const activeRun = createRun(workDir, "Active run");
    updateStatus(workDir, activeRun.identity.id, "running");

    const proposal = createProposal(workDir, {
      question: "Queued — no activation",
      trigger: "A valid trigger",
    });
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await approveAndActivateRun(
      workDir,
      proposal.identity.id,
      resolvedModel,
      brain,
    );

    expect(result.activationResult).toBeNull();
  });
});

// ── Phase 5: Readiness-failed transition ────────────────────────────────

describe("approveAndActivateRun (readiness-failed)", () => {
  it("transitions run to readiness_failed when readiness fails", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Readiness will fail",
      trigger: "A valid trigger",
    });
    const brain = {
      model: "tongyi-deepresearch:30b",
      generate: async (_prompt: string) => "gibberish not json at all",
    };

    await expect(
      approveAndActivateRun(
        workDir,
        proposal.identity.id,
        resolvedModel,
        brain,
      ),
    ).rejects.toThrow();

    // The run should be left in readiness_failed
    const { getRun } = await import("./run-store");
    const runsResult = await import("./run-store");
    const allRuns = runsResult.listRuns(workDir);
    const failedRun = getRun(workDir, allRuns[0].id);
    expect(failedRun).not.toBeNull();
    expect(failedRun!.status).toBe("readiness_failed");
  });
});

// ── Phase 6: Queued runs don't consume budget ───────────────────────────

describe("approveAndActivateRun (queued runs — no budget)", () => {
  it("queued run does not have a budget.json artifact", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    // Create an active run first
    const { createRun } = await import("./run-store");
    const activeRun = createRun(workDir, "Active run");
    updateStatus(workDir, activeRun.identity.id, "running");

    const proposal = createProposal(workDir, {
      question: "Queued — no budget consumed",
      trigger: "A valid trigger",
      budget: { maxSearches: 5 },
    });
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await approveAndActivateRun(
      workDir,
      proposal.identity.id,
      resolvedModel,
      brain,
    );

    // Verify no budget.json exists
    const budgetPath = join(
      workDir,
      ".pi",
      "research",
      "runs",
      result.run.identity.id,
      "budget.json",
    );
    expect(existsSync(budgetPath)).toBe(false);
  });

  it("activated run also does not yet have budget.json (budget is run-time concern)", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposal = createProposal(workDir, {
      question: "Activated — budget not yet created",
      trigger: "A valid trigger",
      budget: { maxSearches: 5 },
    });
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await approveAndActivateRun(
      workDir,
      proposal.identity.id,
      resolvedModel,
      brain,
    );

    // Activated run starts without budget.json (budget initialization
    // happens later when the research loop actually starts)
    const budgetPath = join(
      workDir,
      ".pi",
      "research",
      "runs",
      result.run.identity.id,
      "budget.json",
    );
    expect(existsSync(budgetPath)).toBe(false);
  });
});
