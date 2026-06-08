/**
 * Brief Pipeline — orchestration layer for citation-validated Research Briefs.
 *
 * Owns the citation repair/retry loop:
 * 1. Render the brief from structured input
 * 2. Extract and validate all citation references against Source Notes
 * 3. If invalid and budget allows, ask the Research Brain to repair
 * 4. If repair fails or budget exhausted, return failed status
 *
 * The pipeline never emits a brief with invalid citations.
 * Callers (run-loop) own whether brief.md is written to disk.
 */

import { renderBrief, type BriefInput, type RenderedBrief } from "./brief-renderer";
import {
  extractCitations,
  validateCitations,
  type CitationValidationResult,
} from "./citation-validator";
import type { SourceNoteData } from "../source-notes/types";
import type { BudgetUsage } from "../budgets/budget";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BriefPipelineOptions {
  /** Citation validation function (injected for testability). */
  validateCitations: (
    citations: number[],
    sourceNotes: SourceNoteData[],
  ) => CitationValidationResult;
  /** Citation extraction function (injected for testability). */
  extractCitations: (markdown: string) => number[];
  /** Existing Source Notes to validate citations against. */
  sourceNotes: SourceNoteData[];
  /** Research Brain for re-drafting when citations are invalid. */
  brain: { generate: (prompt: string) => Promise<string> };
  /** Track budget usage (model calls for repair). */
  trackBudget: (usage: Partial<BudgetUsage>) => void;
  /** Whether budget allows another repair attempt. */
  hasBudgetForRetry: () => boolean;
  /** Called when synthesis definitively fails (no valid brief produced). */
  onFailedSynthesis?: (reason: string, previousBriefAvailable: boolean) => void;
  /** Maximum number of re-draft repair attempts. */
  maxRepairAttempts?: number;
  /** Whether a prior valid brief exists from a previous synthesis attempt. */
  previousBriefAvailable?: boolean;
}

export interface PipelineResult {
  /** The validated brief, or null if synthesis failed. */
  brief: RenderedBrief | null;
  /** Whether synthesis definitively failed. */
  failed: boolean;
  /** Whether a prior valid brief exists (for caller to decide write/not). */
  previousBriefAvailable: boolean;
}

type TriggerSource = "human" | "agent" | "task";

interface DraftSection {
  heading: string;
  content: string;
}

interface DraftValidationResult {
  valid: boolean;
  invalidCitations: number[];
  unsupportedSections: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;
const NONE_IDENTIFIED = "None identified.";
const NO_SOURCED_EVIDENCE = "No sourced evidence identified.";
const NO_SOURCE_CONCLUSION = "No source-grounded conclusion available.";
const NO_SOURCE_INTERPRETATION =
  "A source-grounded interpretation is not possible without Source Notes.";
const NO_SOURCE_EVIDENCE = "No Source Notes were gathered.";

// ── Pipeline ───────────────────────────────────────────────────────────────

/**
 * Build a citation-validated Research Brief.
 *
 * Steps:
 * 1. Render the brief from structured input
 * 2. Extract citations from rendered markdown
 * 3. Validate citations against Source Notes
 * 4. If valid → return immediately
 * 5. If invalid and budget allows → ask Brain to repair, re-validate
 * 6. If repair fails or budget exhausted → return failed
 *
 * Never returns a brief with invalid citations.
 */
export async function buildValidatedBrief(
  input: BriefInput,
  options: BriefPipelineOptions,
): Promise<PipelineResult> {
  const {
    validateCitations,
    extractCitations,
    sourceNotes,
    brain,
    trackBudget,
    hasBudgetForRetry,
    onFailedSynthesis,
    previousBriefAvailable = false,
    maxRepairAttempts = DEFAULT_MAX_REPAIR_ATTEMPTS,
  } = options;

  const rendered = renderBrief(input);
  trackBudget({ modelCalls: 0 });

  const extractedFromRendered = extractCitations(rendered.markdown);
  let validation = validateCitations(extractedFromRendered, sourceNotes);

  if (validation.valid) {
    return {
      brief: rendered,
      failed: false,
      previousBriefAvailable,
    };
  }

  let repairAttempts = 0;
  let currentBrief = rendered;

  while (!validation.valid && repairAttempts < maxRepairAttempts) {
    if (!hasBudgetForRetry()) {
      const reason = `Citation repair budget exhausted after ${repairAttempts} attempt(s). Invalid citations: ${validation.invalidCitations.join(", ")}.`;
      onFailedSynthesis?.(reason, previousBriefAvailable);
      return {
        brief: null,
        failed: true,
        previousBriefAvailable,
      };
    }

    repairAttempts++;
    trackBudget({ modelCalls: 1 });

    const repairPrompt = buildRepairPrompt(
      input.question,
      currentBrief.markdown,
      validation.invalidCitations,
      sourceNotes,
    );

    try {
      const rawResponse = await brain.generate(repairPrompt);
      const repaired = parseRepairResponse(rawResponse);

      if (!repaired) {
        continue;
      }

      const repairedInput: BriefInput = {
        ...input,
        bottomLine: repaired.bottomLine ?? input.bottomLine,
        evidence: repaired.evidence ?? input.evidence,
        interpretation: repaired.interpretation ?? input.interpretation,
      };
      currentBrief = renderBrief(repairedInput);

      const reExtracted = extractCitations(currentBrief.markdown);
      validation = validateCitations(reExtracted, sourceNotes);
    } catch {
      continue;
    }
  }

  if (!validation.valid) {
    const reason = `Citation repair failed after ${repairAttempts} attempt(s). Invalid citations: ${validation.invalidCitations.join(", ")}.`;
    onFailedSynthesis?.(reason, previousBriefAvailable);
    return {
      brief: null,
      failed: true,
      previousBriefAvailable,
    };
  }

  return {
    brief: currentBrief,
    failed: false,
    previousBriefAvailable,
  };
}

// ── Repair prompt ──────────────────────────────────────────────────────────

function buildRepairPrompt(
  question: string,
  draftMarkdown: string,
  invalidCitations: number[],
  sourceNotes: SourceNoteData[],
): string {
  const sourceList = sourceNotes
    .map((sn) => `[${sn.citationNumber}] ${sn.title} — ${sn.source}`)
    .join("\n");

  return [
    `You are fixing citation references in a Research Brief draft.`,
    ``,
    `Research Question: ${question}`,
    ``,
    `Current draft has invalid citation references: [${invalidCitations.join(", ")}]`,
    `These citation numbers do not reference any existing Source Note.`,
    ``,
    `Available Source Notes:`,
    sourceList,
    ``,
    `Draft to fix:`,
    draftMarkdown,
    ``,
    `Respond with a JSON object containing the fixed brief. Use only citation numbers from the available Source Notes.`,
    `Format: { "bottomLine": "...", "evidence": [{"heading": "...", "content": "...", "citationRefs": [...]}], "interpretation": "..." }`,
    ``,
    `Your response must be valid JSON only, no surrounding text.`,
    `Only use citation numbers that exist in the available Source Notes.`,
  ].join("\n");
}

// ── Parse repair response ──────────────────────────────────────────────────

/**
 * Validate and optionally repair a raw markdown brief draft.
 *
 * Run-loop-facing seam: takes the Brain's raw markdown draft, normalizes it to
 * canonical Research Brief structure, validates citations and source-grounding,
 * and if needed attempts repair within budget.
 * Returns null if the draft cannot be repaired into a trustworthy brief.
 * Callers (run-loop) own whether brief.md is written to disk.
 */
export async function validateAndRepairBrief(
  draftMarkdown: string,
  sourceNotes: SourceNoteData[],
  brain: { generate: (prompt: string) => Promise<string> },
  hasBudgetForRetry: () => boolean,
  trackBudget: (usage: Partial<BudgetUsage>) => void,
  onFailedSynthesis?: (reason: string, previousBriefAvailable: boolean) => void,
  previousBriefAvailable: boolean = false,
  question: string = "",
  triggerSource: TriggerSource = "human",
  maxRepairAttempts: number = DEFAULT_MAX_REPAIR_ATTEMPTS,
): Promise<string | null> {
  let currentDraft = normalizeBriefDraft(
    draftMarkdown,
    sourceNotes,
    question,
    triggerSource,
  );
  let validation = validateNormalizedDraft(currentDraft, sourceNotes);

  if (validation.valid) {
    return currentDraft;
  }

  let repairAttempts = 0;

  while (!validation.valid && repairAttempts < maxRepairAttempts) {
    if (!hasBudgetForRetry()) {
      const reason = formatValidationFailure(
        validation,
        repairAttempts,
        "budget_exhausted",
      );
      onFailedSynthesis?.(reason, previousBriefAvailable);
      return null;
    }

    repairAttempts++;
    trackBudget({ retryAttempts: 1, modelCalls: 1 });

    const repairPrompt = buildFullMarkdownRepairPrompt(
      question,
      currentDraft,
      validation.invalidCitations,
      validation.unsupportedSections,
      sourceNotes,
      triggerSource,
    );

    try {
      const rawResponse = await brain.generate(repairPrompt);
      const repairedDraft = extractFixedMarkdown(rawResponse);

      if (!repairedDraft || repairedDraft.length < 10) continue;

      currentDraft = normalizeBriefDraft(
        repairedDraft,
        sourceNotes,
        question,
        triggerSource,
      );
      validation = validateNormalizedDraft(currentDraft, sourceNotes);
    } catch {
      continue;
    }
  }

  if (!validation.valid) {
    const reason = formatValidationFailure(
      validation,
      repairAttempts,
      "failed",
    );
    onFailedSynthesis?.(reason, previousBriefAvailable);
    return null;
  }

  return currentDraft;
}

/** Parse a brief-level repair response (JSON with bottomLine, evidence, interpretation). */
function parseRepairResponse(raw: string): { bottomLine?: string; evidence?: Array<{ heading: string; content: string; citationRefs: number[] }>; interpretation?: string } | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as any;
  } catch {
    return null;
  }
}

function normalizeBriefDraft(
  draftMarkdown: string,
  sourceNotes: SourceNoteData[],
  question: string,
  triggerSource: TriggerSource,
): string {
  const sections = parseSections(draftMarkdown);
  const confidenceSection = getSection(sections, "Confidence")?.content ?? "";
  const evidenceSections = getEvidenceSections(sections);
  const tradeoffs = parseListSection(getSection(sections, "Tradeoffs")?.content);
  const caveats = parseListSection(getSection(sections, "Caveats")?.content);
  const gaps = parseListSection(getSection(sections, "Gaps")?.content);
  const continuation = collapseContent(
    getSection(sections, "Continuation Recommendation")?.content,
  );
  const rawTaskImplications = collapseContent(
    getSection(sections, "Implications for Current Task")?.content,
  );

  const input: BriefInput = {
    question,
    bottomLine: buildBottomLine(
      collapseContent(getSection(sections, "Bottom Line")?.content),
      sourceNotes,
    ),
    confidence: parseConfidenceLevel(confidenceSection),
    confidenceRationale: parseConfidenceRationale(confidenceSection),
    evidence: buildEvidenceSections(evidenceSections, sourceNotes),
    interpretation: buildInterpretation(
      collapseContent(getSection(sections, "Interpretation")?.content),
      sourceNotes,
    ),
    interpretationCitationRefs: extractCitations(
      buildInterpretation(
        collapseContent(getSection(sections, "Interpretation")?.content),
        sourceNotes,
      ),
    ),
    tradeoffs: tradeoffs.length > 0 ? tradeoffs : [NONE_IDENTIFIED],
    caveats: caveats.length > 0 ? caveats : [NONE_IDENTIFIED],
    sourceNotes: sourceNotes.map((note) => ({
      citationNumber: note.citationNumber,
      source: note.source,
      title: note.title,
      snippets: note.snippets,
    })),
    gaps: gaps.length > 0 ? gaps : [NONE_IDENTIFIED],
    continuationRecommendation: continuation,
    triggerType: triggerSource,
    taskImplications:
      triggerSource === "agent" || triggerSource === "task"
        ? rawTaskImplications
        : undefined,
  };

  return renderBrief(input).markdown;
}

function validateNormalizedDraft(
  markdown: string,
  sourceNotes: SourceNoteData[],
): DraftValidationResult {
  const allCitations = extractCitations(markdown);
  const citationValidation = validateCitations(allCitations, sourceNotes);
  const unsupportedSections = collectUnsupportedSections(markdown, sourceNotes);

  return {
    valid: citationValidation.valid && unsupportedSections.length === 0,
    invalidCitations: citationValidation.invalidCitations,
    unsupportedSections,
  };
}

function collectUnsupportedSections(
  markdown: string,
  sourceNotes: SourceNoteData[],
): string[] {
  if (sourceNotes.length === 0) return [];

  const sections = parseSections(markdown);
  const unsupported: string[] = [];

  const bottomLine = collapseContent(getSection(sections, "Bottom Line")?.content);
  if (requiresSupport(bottomLine) && extractCitations(bottomLine).length === 0) {
    unsupported.push("Bottom Line");
  }

  for (const section of getEvidenceSections(sections)) {
    const content = collapseContent(section.content);
    if (requiresSupport(content) && extractCitations(content).length === 0) {
      unsupported.push(`Evidence: ${section.heading}`);
    }
  }

  const interpretation = collapseContent(getSection(sections, "Interpretation")?.content);
  if (requiresSupport(interpretation) && extractCitations(interpretation).length === 0) {
    unsupported.push("Interpretation");
  }

  const implications = collapseContent(
    getSection(sections, "Implications for Current Task")?.content,
  );
  if (requiresSupport(implications) && extractCitations(implications).length === 0) {
    unsupported.push("Implications for Current Task");
  }

  return unsupported;
}

function parseSections(markdown: string): DraftSection[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const sections: DraftSection[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const pushCurrent = () => {
    if (!currentHeading) return;
    sections.push({
      heading: currentHeading,
      content: currentLines.join("\n").trim(),
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      pushCurrent();
      currentHeading = headingMatch[1].trim();
      currentLines = [];
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  pushCurrent();
  return sections;
}

function getSection(
  sections: DraftSection[],
  heading: string,
): DraftSection | undefined {
  return sections.find((section) => section.heading === heading);
}

function getEvidenceSections(sections: DraftSection[]): DraftSection[] {
  return sections.filter((section) => section.heading === "Evidence" || section.heading.startsWith("Evidence:"));
}

function parseListSection(content?: string): string[] {
  if (!content) return [];
  const bullets = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);

  if (bullets.length > 0) return bullets;

  const collapsed = collapseContent(content);
  return collapsed ? [collapsed] : [];
}

function collapseContent(content?: string): string {
  return (content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n")
    .trim();
}

function buildBottomLine(content: string, sourceNotes: SourceNoteData[]): string {
  if (sourceNotes.length === 0) {
    return looksLikeNoSourceClaim(content)
      ? content
      : NO_SOURCE_CONCLUSION;
  }
  return content || NO_SOURCE_CONCLUSION;
}

function buildInterpretation(content: string, sourceNotes: SourceNoteData[]): string {
  if (sourceNotes.length === 0) {
    return looksLikeNoSourceClaim(content)
      ? content
      : NO_SOURCE_INTERPRETATION;
  }
  return content || NO_SOURCE_INTERPRETATION;
}

function buildEvidenceSections(
  sections: DraftSection[],
  sourceNotes: SourceNoteData[],
): BriefInput["evidence"] {
  if (sourceNotes.length === 0) {
    return [
      {
        heading: "Current Findings",
        content: NO_SOURCE_EVIDENCE,
        citationRefs: [],
      },
    ];
  }

  if (sections.length === 0) {
    return [
      {
        heading: "Current Findings",
        content: NO_SOURCED_EVIDENCE,
        citationRefs: [],
      },
    ];
  }

  return sections.map((section) => {
    const heading = section.heading.startsWith("Evidence:")
      ? section.heading.slice("Evidence:".length).trim() || "Current Findings"
      : "Current Findings";
    const content = collapseContent(section.content) || NO_SOURCED_EVIDENCE;
    return {
      heading,
      content,
      citationRefs: extractCitations(content),
    };
  });
}

function parseConfidenceLevel(content: string): BriefInput["confidence"] {
  const normalized = content.toLowerCase();
  if (normalized.includes("**level**: high") || normalized.startsWith("high")) {
    return "high";
  }
  if (normalized.includes("**level**: low") || normalized.startsWith("low")) {
    return "low";
  }
  return "medium";
}

function parseConfidenceRationale(content: string): string {
  const rationaleMatch = content.match(/\*\*Rationale\*\*:\s*([\s\S]+)/i);
  if (rationaleMatch) {
    return collapseContent(rationaleMatch[1]);
  }

  const stripped = collapseContent(content.replace(/\*\*Level\*\*:\s*(high|medium|low)/ig, ""));
  return stripped || "Confidence rationale not provided.";
}

function requiresSupport(content: string): boolean {
  if (!content) return false;
  const normalized = content.trim().toLowerCase();
  return ![
    NONE_IDENTIFIED.toLowerCase(),
    NO_SOURCED_EVIDENCE.toLowerCase(),
    NO_SOURCE_CONCLUSION.toLowerCase(),
    NO_SOURCE_INTERPRETATION.toLowerCase(),
    NO_SOURCE_EVIDENCE.toLowerCase(),
    "confidence rationale not provided.",
  ].includes(normalized);
}

function looksLikeNoSourceClaim(content: string): boolean {
  if (!content) return false;
  return /(no source|no sources|no evidence|nothing found|insufficient evidence|not possible)/i.test(content);
}

function formatValidationFailure(
  validation: DraftValidationResult,
  repairAttempts: number,
  mode: "budget_exhausted" | "failed",
): string {
  const prefix = mode === "budget_exhausted"
    ? `Citation/grounding repair budget exhausted after ${repairAttempts} attempt(s).`
    : `Citation/grounding repair failed after ${repairAttempts} attempt(s).`;

  const parts = [prefix];

  if (validation.invalidCitations.length > 0) {
    parts.push(`Invalid citations: ${validation.invalidCitations.join(", ")}.`);
  }

  if (validation.unsupportedSections.length > 0) {
    parts.push(
      `Unsupported factual sections without Source Note citations: ${validation.unsupportedSections.join(", ")}.`,
    );
  }

  return parts.join(" ");
}

/**
 * Build a prompt asking the Brain to fix invalid citations in the draft
 * and return the COMPLETE fixed markdown brief (preserving all sections).
 */
function buildFullMarkdownRepairPrompt(
  question: string,
  draftMarkdown: string,
  invalidCitations: number[],
  unsupportedSections: string[],
  sourceNotes: SourceNoteData[],
  triggerSource: TriggerSource,
): string {
  const sourceList = sourceNotes
    .map((sn) => `[${sn.citationNumber}] ${sn.title} — ${sn.source}`)
    .join("\n");

  const unsupportedLine = unsupportedSections.length > 0
    ? `Unsupported factual sections without valid Source Note citations: ${unsupportedSections.join(", ")}.`
    : "";
  const triggerLine = triggerSource === "human"
    ? `Remove any "Implications for Current Task" section.`
    : `You may include "Implications for Current Task" only when it is source-grounded.`;

  return [
    `You are fixing citation references and grounding problems in a Research Brief draft.`,
    ``,
    question ? `Research Question: ${question}` : "",
    invalidCitations.length > 0
      ? `Invalid citation references in the draft: [${invalidCitations.join(", ")}].`
      : "",
    unsupportedLine,
    `These citation numbers must reference an existing Source Note, and factual claims must stay source-grounded.`,
    ``,
    `Available Source Notes (use only these citation numbers):`,
    sourceList,
    ``,
    `Draft to fix:`,
    ``,
    draftMarkdown,
    ``,
    `Return the COMPLETE fixed brief markdown, preserving all required sections.`,
    `If a factual claim cannot be supported by the available Source Notes, rewrite it conservatively so it does not make an unsupported claim.`,
    triggerLine,
    `Wrap your response as a JSON object with a single "brief" field containing the full markdown string.`,
    `Format: { "brief": "# Research Brief\\n\\n**Question**: ..." }`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Extract the fixed markdown from the Brain's JSON response.
 * Handles both { brief: "..." } wrapping and raw markdown.
 */
function extractFixedMarkdown(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.brief === "string") {
      return parsed.brief;
    }
    return null;
  } catch {
    if (raw.trim().length > 10) {
      return raw.trim();
    }
    return null;
  }
}
