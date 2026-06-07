import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { getStorePath } from "../workspace/store";
import type { ProposalStatus, ProposalSummary, RunIdentity } from "../domain/types";
import type { BudgetLimits } from "../budgets/budget";
import { generateIdentity } from "../workspace/identity";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProposalInput {
  /** The Research Question. */
  question: string;
  /** Short pre-run explanation. */
  summary?: string;
  /** Purpose of the research (e.g., "technology comparison"). */
  purpose?: string;
  /** Intended source categories. */
  evidenceMix?: string[];
  /** Approved budget limits. */
  budget?: Partial<BudgetLimits>;
  /** Blocking or background mode. */
  mode?: "blocking" | "background";
  /** The decision-relevant trigger. */
  trigger?: string;
  /** Optional Research Brain model override. */
  modelOverride?: string;
  /** Who triggered the proposal. */
  triggerSource?: "human" | "agent";
}

export interface ProposalMeta {
  /** Proposal identity. */
  identity: RunIdentity;
  /** Current status. */
  status: ProposalStatus;
  /** Research Question. */
  question: string;
  /** Short pre-run explanation. */
  summary?: string;
  /** Purpose of the research. */
  purpose?: string;
  /** Intended source categories. */
  evidenceMix?: string[];
  /** Approved budget limits. */
  budget?: Partial<BudgetLimits>;
  /** Blocking or background mode. */
  mode?: "blocking" | "background";
  /** The decision-relevant trigger. */
  trigger?: string;
  /** Optional Research Brain model override. */
  modelOverride?: string;
  /** Who triggered the proposal. */
  triggerSource: "human" | "agent";
  /** When the proposal was created (ISO 8601). */
  createdAt: string;
  /** When the proposal was last updated (ISO 8601). */
  updatedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function proposalDirPath(cwd: string, proposalId: string): string {
  return join(getStorePath(cwd), "proposals", proposalId);
}

function statusPath(cwd: string, proposalId: string): string {
  return join(proposalDirPath(cwd, proposalId), "status.json");
}

function mdPath(cwd: string, proposalId: string): string {
  return join(proposalDirPath(cwd, proposalId), "proposal.md");
}

function proposalToMarkdown(meta: ProposalMeta): string {
  const lines: string[] = [
    `# Research Proposal`,
    ``,
    `**Status**: ${meta.status}`,
    `**Trigger**: ${meta.triggerSource}`,
    ``,
    `## Research Question`,
    ``,
    meta.question,
    ``,
  ];

  if (meta.summary) {
    lines.push(`## Proposal Summary`, ``, meta.summary, ``);
  }

  if (meta.purpose) {
    lines.push(`## Purpose`, ``, meta.purpose, ``);
  }

  if (meta.trigger) {
    lines.push(`## Research Trigger`, ``, meta.trigger, ``);
  }

  if (meta.evidenceMix && meta.evidenceMix.length > 0) {
    lines.push(
      `## Evidence Mix`,
      ``,
      ...meta.evidenceMix.map((e) => `- ${e}`),
      ``,
    );
  }

  if (meta.mode) {
    lines.push(`## Mode`, ``, meta.mode, ``);
  }

  if (meta.modelOverride) {
    lines.push(`## Model Override`, ``, `\`${meta.modelOverride}\``, ``);
  }

  if (meta.budget) {
    lines.push(`## Budget`, ``);
    for (const [key, value] of Object.entries(meta.budget)) {
      if (value !== undefined) {
        lines.push(`- ${key}: ${value}`);
      }
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a file-backed Research Proposal in the Workspace Research Store.
 * Writes proposal.md (source of truth) and status.json (parsed cache).
 */
export function createProposal(
  cwd: string,
  input: ProposalInput,
): ProposalMeta {
  const identity = generateIdentity(input.question);
  const now = new Date().toISOString();

  const meta: ProposalMeta = {
    identity,
    status: "draft",
    question: input.question,
    summary: input.summary,
    purpose: input.purpose,
    evidenceMix: input.evidenceMix,
    budget: input.budget,
    mode: input.mode,
    trigger: input.trigger,
    modelOverride: input.modelOverride,
    triggerSource: input.triggerSource ?? "human",
    createdAt: now,
    updatedAt: now,
  };

  const dir = proposalDirPath(cwd, identity.id);
  mkdirSync(dir, { recursive: true });

  writeFileSync(mdPath(cwd, identity.id), proposalToMarkdown(meta));
  writeFileSync(statusPath(cwd, identity.id), JSON.stringify(meta, null, 2));

  return meta;
}

/**
 * Read a proposal's metadata from its status.json.
 * Returns null if the proposal does not exist.
 */
export function getProposal(
  cwd: string,
  proposalId: string,
): ProposalMeta | null {
  const sp = statusPath(cwd, proposalId);
  if (!existsSync(sp)) return null;

  try {
    const raw = readFileSync(sp, "utf-8");
    return JSON.parse(raw) as ProposalMeta;
  } catch {
    return null;
  }
}

/**
 * List all proposals in the workspace.
 */
export function listProposals(
  cwd: string,
): ProposalSummary[] {
  const proposalsDir = join(getStorePath(cwd), "proposals");
  if (!existsSync(proposalsDir)) return [];

  const entries = readdirSync(proposalsDir, { withFileTypes: true });
  const proposals: ProposalSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = getProposal(cwd, entry.name);
    if (meta) {
      proposals.push({
        id: meta.identity.id,
        status: meta.status,
        question: meta.question,
      });
    }
  }

  return proposals.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Approve a proposal. Updates status to "approved" and persists.
 * Throws if the proposal is not found.
 */
export function approveProposal(
  cwd: string,
  proposalId: string,
): ProposalMeta {
  const meta = getProposal(cwd, proposalId);
  if (!meta) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }

  meta.status = "approved";
  meta.updatedAt = new Date().toISOString();

  writeFileSync(mdPath(cwd, proposalId), proposalToMarkdown(meta));
  writeFileSync(statusPath(cwd, proposalId), JSON.stringify(meta, null, 2));

  return meta;
}

/**
 * Deny a proposal. Updates status to "denied" and persists.
 * Throws if the proposal is not found.
 */
export function denyProposal(cwd: string, proposalId: string): ProposalMeta {
  const meta = getProposal(cwd, proposalId);
  if (!meta) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }

  meta.status = "denied";
  meta.updatedAt = new Date().toISOString();

  writeFileSync(mdPath(cwd, proposalId), proposalToMarkdown(meta));
  writeFileSync(statusPath(cwd, proposalId), JSON.stringify(meta, null, 2));

  return meta;
}
