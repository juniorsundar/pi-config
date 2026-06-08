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
  triggerSource?: "human" | "agent" | "task";
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
  triggerSource: "human" | "agent" | "task";
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
    `**Trigger Source**: ${meta.triggerSource}`,
    ``,
    `## Research Question`,
    ``,
    meta.question,
    ``,
    `## Proposal Summary`,
    ``,
    meta.summary ?? "",
    ``,
    `## Purpose`,
    ``,
    meta.purpose ?? "",
    ``,
    `## Research Trigger`,
    ``,
    meta.trigger ?? "",
    ``,
    `## Evidence Mix`,
    ``,
  ];

  if (meta.evidenceMix && meta.evidenceMix.length > 0) {
    for (const item of meta.evidenceMix) {
      lines.push(`- ${item}`);
    }
  }
  lines.push(``);

  lines.push(`## Mode`, ``, meta.mode ?? "", ``);

  lines.push(`## Model Override`);
  if (meta.modelOverride) {
    lines.push(``, `\`${meta.modelOverride}\``, ``);
  } else {
    lines.push(``, ``, ``);
  }

  lines.push(`## Budget`, ``);
  if (meta.budget) {
    for (const [key, value] of Object.entries(meta.budget)) {
      if (value !== undefined) {
        lines.push(`- ${key}: ${value}`);
      }
    }
  }
  lines.push(``);

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
 * Approve a proposal. Re-reads proposal.md, validates required fields,
 * and merges parsed fields before transitioning to "approved".
 * Throws with actionable errors if validation fails.
 */
export function approveProposal(
  cwd: string,
  proposalId: string,
): ProposalMeta {
  const meta = getProposal(cwd, proposalId);
  if (!meta) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }

  if (meta.status !== "draft") {
    throw new Error(
      `Proposal "${proposalId}" cannot be approved: ` +
        `status is "${meta.status}" (only draft proposals can be approved)`,
    );
  }

  // Re-read proposal.md (the human-editable source of truth)
  let mdContent: string;
  try {
    mdContent = readFileSync(mdPath(cwd, proposalId), "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(
        `Proposal "${proposalId}" cannot be approved: proposal.md not found`,
      );
    }
    throw err;
  }
  const parsed = parseProposalMd(mdContent);

  // Validate the parsed proposal
  const validation = validateProposal(parsed);
  if (!validation.valid) {
    throw new Error(
      `Proposal "${proposalId}" cannot be approved:\n` +
        validation.errors.map((e: string) => `  - ${e}`).join("\n"),
    );
  }

  // Apply parsed fields back to meta (proposal.md is authoritative)
  if (parsed.question !== undefined) meta.question = parsed.question;
  if (parsed.summary !== undefined) meta.summary = parsed.summary;
  if (parsed.purpose !== undefined) meta.purpose = parsed.purpose;
  if (parsed.trigger !== undefined) meta.trigger = parsed.trigger;
  if (parsed.evidenceMix !== undefined) meta.evidenceMix = parsed.evidenceMix;
  if (parsed.budget !== undefined) meta.budget = parsed.budget;
  if (parsed.mode !== undefined) meta.mode = parsed.mode;
  if (parsed.modelOverride !== undefined) meta.modelOverride = parsed.modelOverride;

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

/**
 * Update a draft proposal with new field values.
 * Applies partial edits to both proposal.md and status.json.
 * Throws if the proposal is not found or is not in draft status.
 */
export function updateProposal(
  cwd: string,
  proposalId: string,
  edits: Partial<ProposalInput>,
): ProposalMeta {
  const meta = getProposal(cwd, proposalId);
  if (!meta) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }

  if (meta.status !== "draft") {
    throw new Error(
      `Cannot edit proposal in "${meta.status}" status. Only draft proposals can be edited.`,
    );
  }

  // Apply edits to the metadata
  if (edits.question !== undefined) meta.question = edits.question;
  if (edits.summary !== undefined) meta.summary = edits.summary;
  if (edits.purpose !== undefined) meta.purpose = edits.purpose;
  if (edits.evidenceMix !== undefined) meta.evidenceMix = edits.evidenceMix;
  if (edits.budget !== undefined) meta.budget = edits.budget;
  if (edits.mode !== undefined) meta.mode = edits.mode;
  if (edits.trigger !== undefined) meta.trigger = edits.trigger;
  if (edits.modelOverride !== undefined) meta.modelOverride = edits.modelOverride;
  meta.updatedAt = new Date().toISOString();

  // Persist both artifacts
  writeFileSync(mdPath(cwd, proposalId), proposalToMarkdown(meta));
  writeFileSync(statusPath(cwd, proposalId), JSON.stringify(meta, null, 2));

  return meta;
}

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a proposal.md file back into structured fields.
 * Returns a Partial<ProposalInput> — any field not found is omitted.
 * Uses line-by-line section extraction for robustness.
 */
export function parseProposalMd(
  content: string,
): Partial<ProposalInput> {
  const result: Partial<ProposalInput> = {};

  // Extract a section by ## header name. Returns the body text (trimmed)
  // or undefined if the section is missing or empty.
  function extractSection(header: string): string | undefined {
    const lines = content.split("\n");
    let inSection = false;
    const body: string[] = [];

    for (const line of lines) {
      if (line.trim() === `## ${header}`) {
        inSection = true;
        continue;
      }
      if (inSection) {
        if (line.startsWith("## ")) break;
        body.push(line);
      }
    }

    // Trim leading and trailing blank lines
    while (body.length > 0 && body[0].trim() === "") body.shift();
    while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();

    const text = body.join("\n").trim();
    return text.length > 0 ? text : undefined;
  }

  // Research Question
  const question = extractSection("Research Question");
  if (question !== undefined) result.question = question;

  // Proposal Summary
  const summary = extractSection("Proposal Summary");
  if (summary !== undefined) result.summary = summary;

  // Purpose
  const purpose = extractSection("Purpose");
  if (purpose !== undefined) result.purpose = purpose;

  // Research Trigger
  const trigger = extractSection("Research Trigger");
  if (trigger !== undefined) result.trigger = trigger;

  // Evidence Mix (list items)
  const evidenceRaw = extractSection("Evidence Mix");
  if (evidenceRaw !== undefined) {
    const items = evidenceRaw
      .split("\n")
      .map((line) => line.replace(/^-\s+/, "").trim())
      .filter((item) => item.length > 0);
    if (items.length > 0) {
      result.evidenceMix = items;
    }
  }

  // Mode
  const modeRaw = extractSection("Mode");
  if (modeRaw !== undefined) {
    result.mode = modeRaw as ProposalInput["mode"];
  }

  // Model Override
  const modelRaw = extractSection("Model Override");
  if (modelRaw !== undefined) {
    result.modelOverride = modelRaw.replace(/^`|`$/g, "").trim();
  }

  // Budget (key: value pairs)
  const budgetRaw = extractSection("Budget");
  if (budgetRaw !== undefined) {
    const budget: Record<string, number> = {};
    const budgetLines = budgetRaw
      .split("\n")
      .map((line) => line.replace(/^-\s+/, "").trim())
      .filter((line) => line.length > 0);

    for (const line of budgetLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = parseFloat(line.slice(colonIdx + 1).trim());
      budget[key] = value;
    }

    if (Object.keys(budget).length > 0) {
      result.budget = budget as Partial<ProposalInput>["budget"];
    }
  }

  return result;
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Result of validating a parsed proposal. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a parsed proposal input before approval.
 * Requires question and trigger. Checks budget fields are valid numbers.
 */
export function validateProposal(
  input: Partial<ProposalInput>,
): ValidationResult {
  const errors: string[] = [];

  // Required fields
  if (!input.question || input.question.trim().length === 0) {
    errors.push("Research Question is required");
  }

  if (!input.trigger || input.trigger.trim().length === 0) {
    errors.push("Research Trigger is required");
  }

  // Budget validation
  if (input.budget) {
    const validBudgetKeys: ReadonlySet<string> = new Set([
      "maxSearches",
      "maxFetchAttempts",
      "maxSourceVisits",
      "maxSynthesisRounds",
      "maxModelCalls",
      "maxRetryAttempts",
      "maxElapsedSeconds",
    ]);

    for (const [key, value] of Object.entries(input.budget)) {
      if (!validBudgetKeys.has(key)) {
        errors.push(`Unknown budget field "${key}"`);
      } else if (typeof value !== "number" || isNaN(value)) {
        errors.push(`Budget field "${key}" must be a number`);
      } else if (value < 0) {
        errors.push(`Budget field "${key}" must be a positive number`);
      }
    }
  }

  // Mode validation
  if (
    input.mode !== undefined &&
    input.mode !== "blocking" &&
    input.mode !== "background"
  ) {
    errors.push(
      `Mode must be "blocking" or "background", got "${input.mode}"`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
