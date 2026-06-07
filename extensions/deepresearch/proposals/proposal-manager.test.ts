import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore } from "../workspace/store";
import {
  createProposal,
  getProposal,
  listProposals,
  approveProposal,
  denyProposal,
  updateProposal,
  parseProposalMd,
  validateProposal,
} from "./proposal-manager";
import type { ProposalMeta } from "./proposal-manager";
import { getStatus } from "../lifecycle/status";

let workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-proposal-"));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe("ProposalManager", () => {
  it("creates a proposal directory under the workspace store", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Is Bun faster than Node.js for CLI tools?",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    expect(existsSync(proposalPath)).toBe(true);
  });

  it("writes proposal.md as the source of truth", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Is Rust good for web servers?",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const mdPath = join(proposalPath, "proposal.md");
    expect(existsSync(mdPath)).toBe(true);

    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("Is Rust good for web servers?");
  });

  it("creates proposal with draft status", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Test question?",
    });

    expect(meta.status).toBe("draft");
  });

  it("includes all editable fields in proposal.md", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    createProposal(workDir, {
      question: "Test question?",
      summary: "Investigate test frameworks",
      purpose: "Choose a test framework",
      evidenceMix: ["documentation", "benchmarks"],
      budget: { maxSearches: 5, maxSourceVisits: 3 },
      mode: "blocking",
      trigger: "Technology comparison needed",
      modelOverride: "custom-model:latest",
    });

    const proposals = listProposals(workDir);
    const meta = getProposal(
      workDir,
      proposals[0].id,
    );

    expect(meta).not.toBeNull();
    expect(meta!.question).toBe("Test question?");
    expect(meta!.summary).toBe("Investigate test frameworks");
    expect(meta!.purpose).toBe("Choose a test framework");
    expect(meta!.evidenceMix).toEqual(["documentation", "benchmarks"]);
    expect(meta!.mode).toBe("blocking");
    expect(meta!.trigger).toBe("Technology comparison needed");
    expect(meta!.modelOverride).toBe("custom-model:latest");
  });

  it("budget is included in proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    createProposal(workDir, {
      question: "Budget test?",
      budget: {
        maxSearches: 10,
        maxSourceVisits: 5,
        maxModelCalls: 20,
      },
    });

    const proposals = listProposals(workDir);
    const meta = getProposal(workDir, proposals[0].id);
    expect(meta!.budget).toBeDefined();
    expect(meta!.budget!.maxSearches).toBe(10);
    expect(meta!.budget!.maxSourceVisits).toBe(5);
    expect(meta!.budget!.maxModelCalls).toBe(20);
  });

  it("getProposal returns null for unknown ID", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const result = getProposal(workDir, "nonexistent");
    expect(result).toBeNull();
  });

  it("listProposals returns all proposals", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    createProposal(workDir, { question: "First proposal" });
    createProposal(workDir, { question: "Second proposal" });

    const proposals = listProposals(workDir);
    expect(proposals.length).toBe(2);
  });

  it("listProposals returns empty array for fresh workspace", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposals = listProposals(workDir);
    expect(proposals).toEqual([]);
  });

  it("approveProposal transitions status to approved", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Approve me",
      trigger: "A decision context",
    });

    const approved = approveProposal(workDir, meta.identity.id);
    expect(approved.status).toBe("approved");
  });

  it("approveProposal persists approval to disk", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Approve me",
      trigger: "A decision context",
    });

    approveProposal(workDir, meta.identity.id);
    const reloaded = getProposal(workDir, meta.identity.id);
    expect(reloaded!.status).toBe("approved");
  });

  it("approveProposal throws for unknown proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    expect(() => approveProposal(workDir, "nonexistent")).toThrow(
      "Proposal not found",
    );
  });
});

// ── Validation-gated approval ───────────────────────────────────────────────

describe("approveProposal (validation-gated)", () => {
  it("approves a valid proposal by re-reading proposal.md", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Valid research question?",
      trigger: "A decision-relevant external trigger",
    });

    const approved = approveProposal(workDir, meta.identity.id);
    expect(approved.status).toBe("approved");
  });

  it("blocks approval when proposal.md is missing required fields after a hand-edit", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Will be corrupted",
      trigger: "A decision trigger",
    });

    // Simulate hand-edit: write broken proposal.md
    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const brokenMd = `# Research Proposal

**Status**: draft
**Trigger**: human

## Research Question

`;
    writeFileSync(join(proposalPath, "proposal.md"), brokenMd);

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "cannot be approved",
    );
  });

  it("blocks approval when parsed question is whitespace-only", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Will be edited",
      trigger: "A decision trigger",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const brokenMd = `# Research Proposal

**Status**: draft
**Trigger**: human

## Research Question

   

## Research Trigger

Some trigger
`;
    writeFileSync(join(proposalPath, "proposal.md"), brokenMd);

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "cannot be approved",
    );
  });

  it("blocks approval when trigger is missing from proposal.md", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Question only, no trigger",
      trigger: "Original trigger",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    // Write md without Research Trigger section
    const truncatedMd = `# Research Proposal

**Status**: draft
**Trigger**: human

## Research Question

Question only, no trigger
`;
    writeFileSync(join(proposalPath, "proposal.md"), truncatedMd);

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "cannot be approved",
    );
  });

  it("includes actionable error messages in the rejection", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Will be emptied",
      trigger: "Will be emptied",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const brokenMd = `# Research Proposal

**Status**: draft
**Trigger**: human

## Research Question


## Research Trigger


`;
    writeFileSync(join(proposalPath, "proposal.md"), brokenMd);

    let errorMessage = "";
    try {
      approveProposal(workDir, meta.identity.id);
    } catch (err: any) {
      errorMessage = err.message;
    }

    expect(errorMessage).toContain("Research Question is required");
    expect(errorMessage).toContain("Research Trigger is required");
  });

  it("preserves proposal in draft status after failed approval", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Will fail",
      trigger: "A trigger",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    writeFileSync(join(proposalPath, "proposal.md"), "");

    try {
      approveProposal(workDir, meta.identity.id);
    } catch {}

    const reloaded = getProposal(workDir, meta.identity.id);
    expect(reloaded!.status).toBe("draft");
  });

  it("reports actionable error when proposal.md is missing", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Will have md deleted",
      trigger: "A trigger",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    rmSync(join(proposalPath, "proposal.md"));

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "proposal.md not found",
    );
  });

  it("blocks approval of already-approved proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Approve once",
      trigger: "A trigger",
    });
    approveProposal(workDir, meta.identity.id);

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "cannot be approved",
    );
  });

  it("blocks approval of already-denied proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Denied, then approve",
      trigger: "A trigger",
    });
    denyProposal(workDir, meta.identity.id);

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "cannot be approved",
    );
  });

  it("denyProposal transitions status to denied", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Deny me",
    });

    const denied = denyProposal(workDir, meta.identity.id);
    expect(denied.status).toBe("denied");
  });

  it("denyProposal throws for unknown proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    expect(() => denyProposal(workDir, "nonexistent")).toThrow(
      "Proposal not found",
    );
  });

  it("agent-triggered proposals are marked as agent-triggered", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Agent requested",
      triggerSource: "agent",
    });

    expect(meta.triggerSource).toBe("agent");
  });

  it("human-triggered proposals default trigger source to human", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Human requested",
    });

    expect(meta.triggerSource).toBe("human");
  });

  it("proposal identity uses date-slug-shortId format", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Identity test",
    });

    expect(meta.identity.id).toMatch(
      /^\d{4}-\d{2}-\d{2}-identity-test-[0-9a-f]{8}$/,
    );
  });
});

// ── updateProposal ──────────────────────────────────────────────────────────

describe("updateProposal", () => {
  it("updates proposal.md and status.json with new field values", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Original question?",
      summary: "Original summary",
      mode: "blocking",
    });

    const updated = updateProposal(workDir, meta.identity.id, {
      question: "Updated question?",
      purpose: "Updated purpose",
      mode: "background",
    });

    expect(updated.question).toBe("Updated question?");
    expect(updated.purpose).toBe("Updated purpose");
    expect(updated.mode).toBe("background");
    // Unchanged fields preserved
    expect(updated.summary).toBe("Original summary");

    // Verify on-disk persistence
    const reloaded = getProposal(workDir, meta.identity.id);
    expect(reloaded!.question).toBe("Updated question?");
    expect(reloaded!.mode).toBe("background");
  });

  it("updates the proposal.md file content", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Original question?",
      mode: "blocking",
    });

    updateProposal(workDir, meta.identity.id, {
      question: "Edited question?",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const mdContent = readFileSync(join(proposalPath, "proposal.md"), "utf-8");
    expect(mdContent).toContain("Edited question?");
    expect(mdContent).not.toContain("Original question?");
  });

  it("throws for non-existent proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    expect(() =>
      updateProposal(workDir, "nonexistent", { question: "New?" }),
    ).toThrow("Proposal not found");
  });

  it("throws for already-approved proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Approve first",
      trigger: "A decision trigger",
    });
    approveProposal(workDir, meta.identity.id);

    expect(() =>
      updateProposal(workDir, meta.identity.id, { question: "Changed?" }),
    ).toThrow("Cannot edit");
  });

  it("throws for already-denied proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Deny first",
    });
    denyProposal(workDir, meta.identity.id);

    expect(() =>
      updateProposal(workDir, meta.identity.id, { question: "Changed?" }),
    ).toThrow("Cannot edit");
  });
});

// ── parseProposalMd ─────────────────────────────────────────────────────────

describe("parseProposalMd", () => {
  it("parses all fields from a complete proposal.md", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Is TypeScript good for CLI tools?",
      summary: "We need to evaluate TypeScript",
      purpose: "Technology comparison",
      trigger: "Choosing a tech stack for the new CLI",
      evidenceMix: ["documentation", "benchmarks"],
      mode: "blocking",
      modelOverride: "custom-model:latest",
      budget: { maxSearches: 5, maxSourceVisits: 3 },
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const mdContent = readFileSync(join(proposalPath, "proposal.md"), "utf-8");
    const parsed = parseProposalMd(mdContent);

    expect(parsed.question).toBe("Is TypeScript good for CLI tools?");
    expect(parsed.summary).toBe("We need to evaluate TypeScript");
    expect(parsed.purpose).toBe("Technology comparison");
    expect(parsed.trigger).toBe("Choosing a tech stack for the new CLI");
    expect(parsed.evidenceMix).toEqual(["documentation", "benchmarks"]);
    expect(parsed.mode).toBe("blocking");
    expect(parsed.modelOverride).toBe("custom-model:latest");
    expect(parsed.budget).toEqual({ maxSearches: 5, maxSourceVisits: 3 });
  });

  it("parses minimal proposal.md with just a question", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Minimal proposal?",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const mdContent = readFileSync(join(proposalPath, "proposal.md"), "utf-8");
    const parsed = parseProposalMd(mdContent);

    expect(parsed.question).toBe("Minimal proposal?");
    expect(parsed.summary).toBeUndefined();
    expect(parsed.purpose).toBeUndefined();
  });

  it("parses budget fields as numbers", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Budget test?",
      budget: {
        maxSearches: 10,
        maxSourceVisits: 5,
        maxModelCalls: 20,
      },
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const mdContent = readFileSync(join(proposalPath, "proposal.md"), "utf-8");
    const parsed = parseProposalMd(mdContent);

    expect(parsed.budget).toEqual({
      maxSearches: 10,
      maxSourceVisits: 5,
      maxModelCalls: 20,
    });
    expect(typeof parsed.budget!.maxSearches).toBe("number");
  });

  it("returns empty object for empty content", () => {
    const parsed = parseProposalMd("");
    expect(parsed.question).toBeUndefined();
  });

  it("handles missing sections gracefully", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Only question, no trigger",
      mode: "blocking",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const mdContent = readFileSync(join(proposalPath, "proposal.md"), "utf-8");
    const parsed = parseProposalMd(mdContent);

    expect(parsed.question).toBe("Only question, no trigger");
    expect(parsed.mode).toBe("blocking");
    expect(parsed.trigger).toBeUndefined();
  });

  it("roundtrips all fields through serialize → parse", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Roundtrip test?",
      summary: "A summary for roundtrip testing",
      purpose: "Verify serialization fidelity",
      trigger: "Roundtrip correctness guarantee",
      evidenceMix: ["docs", "benchmarks", "source code"],
      mode: "background",
      modelOverride: "roundtrip-model:v1",
      budget: { maxSearches: 7, maxSourceVisits: 4, maxModelCalls: 12 },
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const mdContent = readFileSync(join(proposalPath, "proposal.md"), "utf-8");
    const parsed = parseProposalMd(mdContent);

    expect(parsed.question).toBe("Roundtrip test?");
    expect(parsed.summary).toBe("A summary for roundtrip testing");
    expect(parsed.purpose).toBe("Verify serialization fidelity");
    expect(parsed.trigger).toBe("Roundtrip correctness guarantee");
    expect(parsed.evidenceMix).toEqual(["docs", "benchmarks", "source code"]);
    expect(parsed.mode).toBe("background");
    expect(parsed.modelOverride).toBe("roundtrip-model:v1");
    expect(parsed.budget).toEqual({
      maxSearches: 7,
      maxSourceVisits: 4,
      maxModelCalls: 12,
    });
  });
});

// ── validateProposal ────────────────────────────────────────────────────────

describe("validateProposal", () => {
  it("passes for a valid proposal with question and trigger", () => {
    const result = validateProposal({
      question: "Valid question?",
      trigger: "An external decision context",
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when question is missing", () => {
    const result = validateProposal({
      trigger: "An external decision context",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Research Question is required"]);
  });

  it("fails when question is empty string", () => {
    const result = validateProposal({
      question: "  ",
      trigger: "An external decision context",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Research Question is required");
  });

  it("fails when trigger is missing", () => {
    const result = validateProposal({
      question: "Valid question?",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Research Trigger is required"]);
  });

  it("fails when both question and trigger are missing", () => {
    const result = validateProposal({});

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Research Question is required");
    expect(result.errors).toContain("Research Trigger is required");
  });

  it("reports non-numeric budget fields as errors", () => {
    const result = validateProposal({
      question: "Valid question?",
      trigger: "An external decision context",
      budget: { maxSearches: "not-a-number" as any, maxSourceVisits: 3 },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Budget field "maxSearches" must be a number',
    );
  });

  it("reports negative budget values as errors", () => {
    const result = validateProposal({
      question: "Valid question?",
      trigger: "An external decision context",
      budget: { maxSearches: -1 },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Budget field "maxSearches" must be a positive number',
    );
  });

  it("reports NaN budget values as errors from unparseable prose", () => {
    const result = validateProposal({
      question: "Valid question?",
      trigger: "An external decision context",
      budget: { maxSearches: NaN },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Budget field "maxSearches" must be a number',
    );
  });

  it("reports invalid mode as an error", () => {
    const result = validateProposal({
      question: "Valid question?",
      trigger: "An external decision context",
      mode: "invalid-mode" as any,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Mode must be "blocking" or "background", got "invalid-mode"',
    );
  });

  it("accepts valid mode values", () => {
    expect(
      validateProposal({
        question: "Q?",
        trigger: "T",
        mode: "blocking",
      }).valid,
    ).toBe(true);
    expect(
      validateProposal({
        question: "Q?",
        trigger: "T",
        mode: "background",
      }).valid,
    ).toBe(true);
  });
});

// ── Acceptance criteria flows ──────────────────────────────────────────────

describe("edit-then-approve flow", () => {
  it("update fields, then approve merges edits into approved proposal", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Initial question?",
      trigger: "Initial trigger",
      summary: "Initial summary",
      mode: "blocking",
    });

    updateProposal(workDir, meta.identity.id, {
      question: "Refined question?",
      purpose: "Added purpose",
      mode: "background",
    });

    const approved = approveProposal(workDir, meta.identity.id);

    expect(approved.status).toBe("approved");
    expect(approved.question).toBe("Refined question?");
    expect(approved.purpose).toBe("Added purpose");
    expect(approved.mode).toBe("background");
    expect(approved.summary).toBe("Initial summary");
    expect(approved.trigger).toBe("Initial trigger");
  });

  it("hand-edited proposal.md is authoritative on approval", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Original question?",
      trigger: "Original trigger",
      mode: "blocking",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const handEdited = `# Research Proposal
**Status**: draft
**Trigger**: human

## Research Question

Hand-edited question?

## Research Trigger

Hand-edited trigger
`;
    writeFileSync(join(proposalPath, "proposal.md"), handEdited);

    const approved = approveProposal(workDir, meta.identity.id);

    expect(approved.status).toBe("approved");
    expect(approved.question).toBe("Hand-edited question?");
    expect(approved.trigger).toBe("Hand-edited trigger");
  });
});

describe("invalid edit flow", () => {
  it("corrupt budget values in proposal.md block approval", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Budget corruption test?",
      trigger: "A trigger",
      budget: { maxSearches: 5 },
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const corrupted = `# Research Proposal
**Status**: draft
**Trigger**: human

## Research Question

Budget corruption test?

## Research Trigger

A trigger

## Budget

- maxSearches: forty-two
`;
    writeFileSync(join(proposalPath, "proposal.md"), corrupted);

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "cannot be approved",
    );
  });

  it("removing question section blocks approval", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Will be removed",
      trigger: "A trigger",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    const noQuestion = `# Research Proposal
**Status**: draft
**Trigger**: human

## Research Trigger

A trigger
`;
    writeFileSync(join(proposalPath, "proposal.md"), noQuestion);

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "cannot be approved",
    );
  });

  it("invalid mode hand-edit in proposal.md blocks approval", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Mode corruption test?",
      trigger: "A trigger",
      mode: "blocking",
    });

    const proposalPath = join(
      workDir,
      ".pi",
      "research",
      "proposals",
      meta.identity.id,
    );
    // Hand-edit mode to invalid value
    const corrupted = `# Research Proposal
**Status**: draft
**Trigger**: human

## Research Question

Mode corruption test?

## Research Trigger

A trigger

## Mode

invalid-value
`;
    writeFileSync(join(proposalPath, "proposal.md"), corrupted);

    expect(() => approveProposal(workDir, meta.identity.id)).toThrow(
      "cannot be approved",
    );
  });
});

describe("deny flow", () => {
  it("denied proposal stays denied and does not become a run", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Will be denied",
      trigger: "A trigger",
    });

    denyProposal(workDir, meta.identity.id);

    const reloaded = getProposal(workDir, meta.identity.id);
    expect(reloaded!.status).toBe("denied");

    const proposals = listProposals(workDir);
    const deniedProposal = proposals.find(
      (p) => p.id === meta.identity.id,
    );
    expect(deniedProposal).toBeDefined();
    expect(deniedProposal!.status).toBe("denied");

    // No runs should exist — denied proposals don't create runs
    const status = getStatus(workDir);
    expect(status.runs.length).toBe(0);
  });

  it("denied proposal appears in proposal list with denied status", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Denied, then check status",
      trigger: "A trigger",
    });

    denyProposal(workDir, meta.identity.id);

    const proposals = listProposals(workDir);
    expect(proposals.length).toBe(1);
    expect(proposals[0].status).toBe("denied");
  });
});

describe("proposal generation does not consume budget", () => {
  it("createProposal does not create budget artifacts in workspace", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    createProposal(workDir, {
      question: "Budget non-consumption test?",
      trigger: "A trigger",
      budget: { maxSearches: 5, maxSourceVisits: 3 },
    });

    const status = getStatus(workDir);
    // No runs should exist (budget tracking happens at run level)
    expect(status.runs.length).toBe(0);
    // No active run
    expect(status.activeRun).toBeNull();
  });
});

describe("budget key validation", () => {
  it("rejects unknown budget keys", () => {
    const result = validateProposal({
      question: "Valid question?",
      trigger: "External trigger",
      budget: { maxSearch: 5, maxSearches: 10 } as any,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Unknown budget field "maxSearch"',
    );
  });

  it("accepts all known budget keys", () => {
    const result = validateProposal({
      question: "Valid question?",
      trigger: "External trigger",
      budget: {
        maxSearches: 5,
        maxFetchAttempts: 3,
        maxSourceVisits: 4,
        maxSynthesisRounds: 2,
        maxModelCalls: 10,
        maxRetryAttempts: 3,
        maxElapsedSeconds: 300,
      },
    });

    expect(result.valid).toBe(true);
  });
});
