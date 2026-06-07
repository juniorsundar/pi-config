import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore } from "../workspace/store";
import {
  createProposal,
  getProposal,
  listProposals,
  approveProposal,
  denyProposal,
} from "./proposal-manager";
import type { ProposalMeta } from "./proposal-manager";

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
    });

    const approved = approveProposal(workDir, meta.identity.id);
    expect(approved.status).toBe("approved");
  });

  it("approveProposal persists approval to disk", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createProposal(workDir, {
      question: "Approve me",
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
