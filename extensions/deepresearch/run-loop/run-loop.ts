/**
 * Research Run loop — the Research Orchestrator's main loop.
 *
 * Coordinates the Research Brain (intent proposal) with the Research
 * Orchestrator (side-effect execution). Each round:
 * 1. Ask the Brain for the next structured intent via generate()
 * 2. Parse and validate the intent
 * 3. Execute the corresponding side effect
 * 4. Append to the Claim/Evidence Ledger
 * 5. Track budget usage against approved limits
 * 6. Refresh the Run Summary for the next round
 * 7. Repeat until synthesize_brief, stop_early, or budget exhaustion
 */

import { join } from "path";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  readdirSync,
} from "fs";
import { getRun, updateStatus } from "../lifecycle/run-store";
import { getStorePath } from "../workspace/store";
import type { Budget } from "../budgets/budget";
import { trackUsage, isExhausted, remainingBudget } from "../budgets/budget";
import type { ResearchBrain } from "../brain/harness/types";
import { VALID_INTENTS } from "../brain/harness/types";
import type { RunStatus } from "../domain/types";
import type {
  RunLoopOptions,
  ResearchRunMeta,
  LedgerEntry,
  SourceNoteData,
  ParsedIntent,
} from "./types";
import { renderProgressDigest, type ProgressDigestInput } from "../rendering/progress-digest";
import { renderRun } from "../rendering/human-view-facade";
import { extractFromWebSource, chunkContent, mergeChunkExtractions, DEFAULT_CHUNK_THRESHOLD } from "../source-notes/extractor";
import { writeRawContentToDiagnostics } from "../source-notes/diagnostics";
import { EvidenceMix } from "../domain/evidence-mix";
import { CandidateFilter, type AnnotatedCandidate } from "../domain/candidate-filter";
import {
  NegativeEvidence,
  coverageToPromptSection,
  justifiesEarlyStop,
} from "../domain/negative-evidence";
import { validateAndRepairBrief } from "../rendering/brief-pipeline";
import {
  readAndClearSteeringSignal,
  processSteeringSignal,
  steeringEntryToLedger,
  type SteeringSignal,
} from "../steering/steering";

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_ROUNDS = 50;

// ── Path helpers ───────────────────────────────────────────────────────────

function runDir(cwd: string, runId: string): string {
  return join(getStorePath(cwd), "runs", runId);
}

function ledgerPath(cwd: string, runId: string): string {
  return join(runDir(cwd, runId), "ledger.jsonl");
}

function summaryPath(cwd: string, runId: string): string {
  return join(runDir(cwd, runId), "run-summary.md");
}

function digestPath(cwd: string, runId: string): string {
  return join(runDir(cwd, runId), "progress-digest.md");
}

function briefFilePath(cwd: string, runId: string): string {
  return join(runDir(cwd, runId), "brief.md");
}

function sourceNotesDir(cwd: string, runId: string): string {
  return join(runDir(cwd, runId), "source-notes");
}

/**
 * Parse a SourceNoteData from a source note markdown file.
 * The format is written by writeSourceNote().
 */
function parseSourceNoteFromFile(filePath: string): SourceNoteData | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Extract title from # Source Note <num>
    const titleMatch = lines[0]?.match(/^# Source Note (\d+)/);
    if (!titleMatch) return null;
    const citationNumber = parseInt(titleMatch[1], 10);

    // Extract metadata fields
    const source = extractField(lines, "**Source**");
    const finalUrl = extractField(lines, "**Final URL**");
    const title = extractField(lines, "**Title**") ?? "";
    const retrievedAt = extractField(lines, "**Retrieved**") ?? "";
    const contentType = extractField(lines, "**Content Type**") ?? "";
    const contentHash = extractField(lines, "**Content Hash**");

    // Extract snippets
    const snippets: string[] = [];
    const snippetSection = lines.findIndex(l => l.trim() === "## Snippets");
    if (snippetSection >= 0) {
      for (let i = snippetSection + 1; i < lines.length; i++) {
        const snippetMatch = lines[i].match(/^- \[\d+:\d+\] (.+)/);
        if (snippetMatch) {
          snippets.push(snippetMatch[1]);
        }
      }
    }

    const allNotesText: string[] = [];
    for (const line of lines) {
      if (line.startsWith("**Note**: ")) {
        allNotesText.push(line.slice("**Note**: ".length));
      }
    }
    const truncated = allNotesText.some(n => n.includes("truncated"));
    const partialExtraction = allNotesText.some(n => n.includes("partial extraction"));

    return {
      source: source ?? "",
      finalUrl: finalUrl ?? undefined,
      title,
      sourceType: "web",
      retrievedAt,
      citationNumber,
      snippets,
      contentType,
      truncated,
      contentHash: contentHash ?? undefined,
      partialExtraction,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a field value from lines like "**Field**: value".
 * Skips lines that also contain other markers (truncation, partial extraction).
 */
function extractField(lines: string[], field: string, skipIndex: number = 0): string | undefined {
  let count = 0;
  for (const line of lines) {
    if (line.startsWith(field + ": ")) {
      if (count === skipIndex) {
        return line.slice(field.length + 2);
      }
      count++;
    }
  }
  return undefined;
}

// ── Ledger ─────────────────────────────────────────────────────────────────

function appendLedger(cwd: string, runId: string, entry: LedgerEntry): void {
  appendFileSync(ledgerPath(cwd, runId), JSON.stringify(entry) + "\n");
}

function readLedger(cwd: string, runId: string): LedgerEntry[] {
  const path = ledgerPath(cwd, runId);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEntry);
}

// ── Source Notes ───────────────────────────────────────────────────────────

function writeSourceNote(cwd: string, runId: string, note: SourceNoteData): void {
  const dir = sourceNotesDir(cwd, runId);
  const pad = String(note.citationNumber).padStart(3, "0");
  const filePath = join(dir, `note-${pad}.md`);

  const lines = [
    `# Source Note ${note.citationNumber}`,
    "",
    `**Source**: ${note.source}`,
    note.finalUrl ? `**Final URL**: ${note.finalUrl}` : null,
    `**Title**: ${note.title}`,
    `**Type**: ${note.sourceType}`,
    `**Retrieved**: ${note.retrievedAt}`,
    `**Content Type**: ${note.contentType}`,
    note.truncated ? `**Note**: Content was truncated.` : null,
    note.contentHash ? `**Content Hash**: ${note.contentHash}` : null,
    note.partialExtraction ? `**Note**: Some chunks failed extraction.` : null,
    "",
    `## Snippets`,
    "",
  ].filter((l): l is string => l !== null);

  for (let i = 0; i < note.snippets.length; i++) {
    const snip = note.snippets[i];
    lines.push(`- [${note.citationNumber}:${i + 1}] ${typeof snip === "string" ? snip : JSON.stringify(snip)}`);
  }

  lines.push("");

  writeFileSync(filePath, lines.join("\n"));
}

// ── Run Summary ────────────────────────────────────────────────────────────

function refreshSummary(
  cwd: string,
  runId: string,
  question: string,
  budget: Budget,
  rounds: number,
): void {
  const ledger = readLedger(cwd, runId);
  const notesDir = sourceNotesDir(cwd, runId);
  const noteFiles = existsSync(notesDir)
    ? readdirSync(notesDir).filter((f) => f.endsWith(".md"))
    : [];

  const remaining = remainingBudget(budget);

  const lines: string[] = [
    `# Run Summary`,
    "",
    `**Question**: ${question}`,
    `**Rounds Completed**: ${rounds}`,
    `**Source Notes**: ${noteFiles.length}`,
    `**Ledger Entries**: ${ledger.length}`,
    "",
    `## Budget Remaining`,
    "",
    `| Category | Remaining |`,
    `|----------|-----------|`,
    `| Searches | ${remaining.searches} |`,
    `| Fetch Attempts | ${remaining.fetchAttempts} |`,
    `| Source Visits | ${remaining.sourceVisits} |`,
    `| Synthesis Rounds | ${remaining.synthesisRounds} |`,
    `| Model Calls | ${remaining.modelCalls} |`,
    "",
    `## Recent Ledger Entries`,
    "",
  ];

  for (const entry of ledger.slice(-5)) {
    lines.push(`- **Round ${entry.round} [${entry.intent}]**: ${entry.content.slice(0, 120)}`);
  }

  lines.push("");

  writeFileSync(summaryPath(cwd, runId), lines.join("\n"));
}

// ── Progress Digest ──────────────────────────────────────────────────────────

function deriveGaps(evidenceMix: EvidenceMix | null, negativeEvidence: NegativeEvidence): string[] {
  const gaps: string[] = [];
  if (evidenceMix) {
    for (const cat of evidenceMix.categories) {
      if (cat.status === "not-searched") {
        gaps.push(`${cat.category}: Not yet explored`);
      } else if (cat.status === "missing") {
        gaps.push(`${cat.category}: No relevant sources found`);
      } else if (cat.status === "weak") {
        gaps.push(`${cat.category}: Only weak evidence`);
      }
    }
  }
  for (const entry of negativeEvidence.entries) {
    if (entry.type === "failed_search" && !gaps.some((g) => g.includes("Search returned no results"))) {
      gaps.push("Search returned no results");
    }
    if (entry.type === "fetch_failed" && !gaps.some((g) => g.includes("Failed to fetch"))) {
      gaps.push("Failed to fetch a source");
    }
    if (entry.type === "contradiction") {
      gaps.push(`Contradictory evidence: ${entry.detail}`);
    }
    if (entry.type === "missing_category") {
      gaps.push(entry.category ? `${entry.category}: ${entry.detail}` : entry.detail);
    }
    if (entry.type === "dropped_source") {
      gaps.push(entry.detail);
    }
  }
  // Deduplicate by normalizing: collect unique entries by key
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const gap of gaps) {
    // Use the first 80 chars as key to collapse near-duplicates
    const key = gap.slice(0, 80).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(gap);
    }
  }
  return deduped;
}

function nextStepFromIntent(intent: string): string {
  switch (intent) {
    case "search":           return "Gathering sources from search results";
    case "select_sources":   return "Fetching and extracting selected sources";
    case "update_findings":  return "Analyzing source findings";
    case "synthesize_brief": return "Drafting Research Brief";
    case "stop_early":       return "Finalizing research";
    case "parse_error":      return "Retrying — model response unclear";
    case "budget_approved":  return "Starting research";
    case "budget_revision":  return "Continuing research with revised budget";
    case "early_stop_rejected": return "Continuing investigation";
    case "source_note_created": return "Analyzing source findings";
    case "source_note_creation_skipped": return "Analyzing source findings";
    case "fetch_failed":     return "Retrying fetch";
    case "synthesis_failed": return "Retrying synthesis";
    default:                  return "Proceeding with research";
  }
}

function deriveCurrentSignal(evidenceMix: EvidenceMix | null): string | undefined {
  if (!evidenceMix) return undefined;
  const snap = evidenceMix.snapshot();
  if (snap.overall === "strong") return "Good evidence across all categories";
  if (snap.overall === "partial") return `Partial evidence: ${snap.found} categories covered, ${snap.notSearched + snap.missing} pending`;
  return "Minimal evidence so far";
}

function refreshProgressDigest(
  cwd: string,
  runId: string,
  question: string,
  status: RunStatus,
  budget: Budget,
  roundCount: number,
  sourceNoteCount: number,
  evidenceMix: EvidenceMix | null,
  negativeEvidence: NegativeEvidence,
  briefPathResult: string,
  elapsedSeconds: number,
): void {
  const ledger = readLedger(cwd, runId);
  // Derive next step from the last non-round-0 intent in the ledger
  const lastLedgerEntry = ledger.length > 1
    ? [...ledger].reverse().find((e) => e.round > 0 && e.intent !== "stop_early")
    : undefined;
  const lastIntent = lastLedgerEntry?.intent ?? (ledger.length > 0 ? ledger[0].intent : "budget_approved");

  const input: ProgressDigestInput = {
    runId,
    status,
    question,
    roundCount,
    budget: {
      usage: budget.usage,
      limits: budget.limits,
    },
    evidenceMix: evidenceMix?.snapshot() ?? null,
    negativeEvidenceCount: negativeEvidence.count,
    gaps: deriveGaps(evidenceMix, negativeEvidence),
    nextStep: nextStepFromIntent(lastIntent),
    sourceNoteCount,
    ledgerEntryCount: ledger.length,
    hasBrief: briefPathResult.length > 0,
    elapsedSeconds,
    currentSignal: deriveCurrentSignal(evidenceMix),
  };

  writeFileSync(digestPath(cwd, runId), renderProgressDigest(input));
}

// ── Prompt construction ────────────────────────────────────────────────────

function buildPrompt(
  question: string,
  currentSummary: string,
  budget: Budget,
  coverageSection?: string,
  candidates?: AnnotatedCandidate[],
): string {
  const remaining = remainingBudget(budget);

  const lines: string[] = [
    `You are a Research Brain conducting a bounded research investigation.`,
    ``,
    `Research Question: ${question}`,
    ``,
    `Current Run Summary:`,
    currentSummary || `No work done yet — begin new research.`,
  ];

  // Include evidence coverage state
  if (coverageSection) {
    lines.push(``, coverageSection);
  }

  // Include filtered (annotated, ranked) candidates for source selection
  if (candidates && candidates.length > 0) {
    lines.push(``, `## Filtered Candidates (annotated & ranked)`, ``);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      lines.push(
        `  ${i + 1}. [Score ${c.signalScore}] ${c.title}`,
        `     URL: ${c.canonicalUrl}`,
        `     ${c.isPrimary ? "Primary source" : "Secondary source"} — ${c.signalReason}`,
        `     Snippet: ${c.snippet.slice(0, 100)}`,
      );
    }
  }

  lines.push(
    ``,
    `Budget remaining:`,
    `  - Searches: ${remaining.searches}`,
    `  - Fetch attempts: ${remaining.fetchAttempts}`,
    `  - Source visits: ${remaining.sourceVisits}`,
    `  - Synthesis rounds: ${remaining.synthesisRounds}`,
    `  - Model calls: ${remaining.modelCalls}`,
    ``,
    `Valid intents: ${VALID_INTENTS.join(", ")}`,
    ``,
    `Respond with a JSON object containing your chosen intent and any parameters.`,
    `For "search", include a "query" field.`,
    `For "select_sources", include a "selectedUrls" array and "reasoningPerUrl".`,
    `For "update_findings", include "snippets" array and "reasoning".`,
    `For "synthesize_brief", include "briefDraft", "confidence", and "gaps".`,
    `For "stop_early", include "reasoning".`,
    ``,
    `Your response must be valid JSON only, no surrounding text.`,
  );

  return lines.join("\n");
}

// ── Intent parsing ────────────────────────────────────────────────────────

/**
 * Strip <think> and <thinking> blocks from model output.
 * Qwen-based models (including Tongyi DeepResearch) emit thinking tags
 * even when instructed to return only JSON.
 */
function stripThinkingBlocks(text: string): string {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .trim();
}

/**
 * Extract meaningful text snippets from fetched HTML content.
 * Strips HTML tags, normalizes whitespace, and returns the first few
 * non-empty text segments as evidence snippets.
 */
function extractSnippetsFromContent(content: string, maxSnippets: number = 3): string[] {
  // Strip style/script blocks and HTML tags
  const cleaned = content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) return [];

  // Split into natural segments by double-newline
  const segments = cleaned
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 30);

  if (segments.length === 0) {
    // Fallback: take chunks when no paragraph breaks exist
    const chunked: string[] = [];
    for (let i = 0; i < Math.min(maxSnippets, Math.ceil(cleaned.length / 300)); i++) {
      const chunk = cleaned.slice(i * 300, (i + 1) * 300).trim();
      if (chunk.length > 40) chunked.push(chunk);
    }
    return chunked;
  }

  return segments.slice(0, maxSnippets).map(s => s.slice(0, 600));
}

/**
 * Parse a structured intent from the Brain's raw response.
 *
 * The Brain may wrap its JSON in thinking blocks or markdown fences.
 * This function strips those and tries multiple extraction strategies,
 * mirroring the recovery logic in brain/harness/probes.ts.
 */
function parseIntent(raw: string): ParsedIntent | null {
  // 1. Try direct JSON parse on the raw text
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.intent === "string") return parsed as ParsedIntent;
  } catch {
    // fall through
  }

  // 2. Strip thinking blocks and try again
  const cleaned = stripThinkingBlocks(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.intent === "string") return parsed as ParsedIntent;
  } catch {
    // fall through
  }

  // 3. Try extracting JSON from fenced code blocks (```json ... ```)
  const fencedBlocks = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fencedBlocks.length - 1; i >= 0; i--) {
    const candidate = fencedBlocks[i][1]?.trim();
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.intent === "string") return parsed as ParsedIntent;
    } catch {
      // keep looking
    }
  }

  // 4. Try extracting content after the last fence close
  const afterFence = cleaned.match(/```[\s\S]*?```\s*([\s\S]*)$/);
  if (afterFence?.[1] && afterFence[1].trim().length > 0) {
    try {
      const parsed = JSON.parse(afterFence[1].trim());
      if (typeof parsed.intent === "string") return parsed as ParsedIntent;
    } catch {
      // fall through
    }
  }

  // 5. Last resort: try to find the first JSON object in the text.
  //    Handles cases where the model outputs unclosed <think> tags that
  //    contain or precede a valid JSON intent (e.g. Qwen-based models).
  const objectMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (objectMatch?.[1]) {
    try {
      const parsed = JSON.parse(objectMatch[1]);
      if (typeof parsed.intent === "string") return parsed as ParsedIntent;
    } catch {
      // fall through
    }
  }

  return null;
}

// ── Best-effort brief helpers ────────────────────────────────────────────

/**
 * Generate a Continuation Recommendation from evidence mix and negative evidence.
 */
function generateContinuationRecommendation(
  question: string,
  evidenceMix: EvidenceMix | null,
  negativeEvidence: NegativeEvidence,
): ContinuationRecommendation {
  const gaps: string[] = [];

  // Gather remaining gaps from evidence mix categories that weren't found
  if (evidenceMix) {
    for (const cat of evidenceMix.categories) {
      if (cat.status === "not-searched") {
        gaps.push(`${cat.category}: Not explored before budget exhaustion.`);
      } else if (cat.status === "missing") {
        gaps.push(`${cat.category}: Searched but no relevant sources found.`);
      } else if (cat.status === "weak") {
        gaps.push(`${cat.category}: Only weak evidence gathered.`);
      }
    }
  }

  // Gather gaps from negative evidence (failed searches)
  for (const entry of negativeEvidence.entries) {
    if (entry.type === "failed_search") {
      gaps.push(`Search gap: ${entry.detail}`);
    }
    if (entry.type === "fetch_failed") {
      gaps.push(`Fetch gap: ${entry.detail}`);
    }
    if (entry.type === "missing_category" && entry.category) {
      const alreadyAdded = gaps.some((g) => g.includes(entry.category!));
      if (!alreadyAdded) {
        gaps.push(`${entry.category}: ${entry.detail}`);
      }
    }
    if (entry.type === "dropped_source") {
      gaps.push(`Source dropped: ${entry.detail}`);
    }
  }

  const proposedBudget =
    gaps.length > 0
      ? `Additional searches, fetch attempts, and model calls to address the ${gaps.length} remaining gap(s).`
      : `Additional budget allocation to continue investigation.`;

  return {
    remainingGaps: gaps,
    proposedBudget,
  };
}

/**
 * Generate a best-effort Research Brief when budget is exhausted or time is exceeded.
 * Includes Caveats, Gaps, Confidence Rationale, Continuation Recommendation, Evidence Coverage.
 */
function generateBudgetExhaustedBrief(
  question: string,
  isTimeExhausted: boolean,
  elapsedSec: number,
  budget: Budget,
  evidenceMix: EvidenceMix | null,
  negativeEvidence: NegativeEvidence,
): string {
  const title = isTimeExhausted ? "Time Exhausted" : "Budget Exhausted";
  const reasonLine = isTimeExhausted
    ? `Elapsed time (${elapsedSec.toFixed(0)}s) exceeded the budget limit (${budget.limits.maxElapsedSeconds}s).`
    : `Research Budget was exhausted before the Research Brief could be completed.`;

  // Build confidence rationale based on what was gathered vs what was missing
  const evidenceMixSnap = evidenceMix?.snapshot();
  const totalCategories = evidenceMixSnap ? evidenceMixSnap.categories.length : 0;
  const foundCategories = evidenceMixSnap ? evidenceMixSnap.found : 0;
  const weakCategories = evidenceMixSnap ? evidenceMixSnap.weak : 0;
  const missingOrNotSearched = evidenceMixSnap
    ? evidenceMixSnap.missing + evidenceMixSnap.notSearched
    : 0;

  let confidence: string;
  let confidenceRationale: string;
  if (totalCategories === 0) {
    confidence = "Unknown";
    confidenceRationale = `No evidence categories defined. ${reasonLine}`;
  } else if (foundCategories >= totalCategories * 0.75 && missingOrNotSearched === 0) {
    confidence = "Medium";
    confidenceRationale = `Found evidence for ${foundCategories}/${totalCategories} categories, but the brief was interrupted by ${title.toLowerCase()}. Some evidence may be incomplete.`;
  } else if (foundCategories > 0 || weakCategories > 0) {
    confidence = "Low";
    confidenceRationale = `Only partial evidence gathered (${foundCategories} found, ${weakCategories} weak of ${totalCategories} categories). The brief was interrupted by ${title.toLowerCase()}.`;
  } else {
    confidence = "Very Low";
    confidenceRationale = `No evidence categories were successfully populated before ${title.toLowerCase()}.`;
  }

  // Build caveats
  const caveats: string[] = [];
  if (isTimeExhausted) {
    caveats.push(`Research was interrupted by elapsed time limit (${budget.limits.maxElapsedSeconds}s).`);
  } else {
    caveats.push("Research Budget was exhausted before all intended work could complete.");
  }
  if (totalCategories > 0 && missingOrNotSearched > 0) {
    caveats.push(`${missingOrNotSearched} of ${totalCategories} evidence categories are missing or unexplored.`);
  }
  caveats.push(`Failed fetches: ${negativeEvidence.entries.filter(e => e.type === "fetch_failed").length} source(s) could not be accessed.`);

  // Generate Continuation Recommendation (also provides gaps)
  const continuation = generateContinuationRecommendation(question, evidenceMix, negativeEvidence);
  const gaps = [...continuation.remainingGaps];

  const lines: string[] = [
    `# Research Brief (${title})`,
    "",
    `**Question**: ${question}`,
    "",
    reasonLine,
    "",
    `**Confidence**: ${confidence}`,
    "",
    `**Confidence Rationale**: ${confidenceRationale}`,
    "",
    "## Caveats",
    "",
  ];

  for (const caveat of caveats) {
    lines.push(`- ${caveat}`);
  }

  if (gaps.length > 0) {
    lines.push("", "## Gaps", "");
    for (const gap of gaps) {
      lines.push(`- ${gap}`);
    }
  }

  if (continuation.remainingGaps.length > 0) {
    lines.push("", "## Continuation Recommendation", "");
    lines.push("The following gaps remain unresolved and may justify a continuation with additional budget:");
    lines.push("");
    for (const gap of continuation.remainingGaps) {
      lines.push(`- ${gap}`);
    }
    lines.push("", `**Proposed additional budget**: ${continuation.proposedBudget}`);
    lines.push("");
  }

  // Append Evidence Coverage section
  const coverageSection = evidenceMix
    ? coverageToPromptSection(evidenceMix, negativeEvidence)
    : undefined;
  if (coverageSection) {
    lines.push("---", "", coverageSection);
  }

  return lines.join("\n");
}

// ── Main loop ─────────────────────────────────────────────────────────────

/**
 * Execute a bounded Research Run from start to finish.
 *
 * The loop strictly follows the Brain-vs-Orchestrator boundary: the Brain
 * proposes structured intents and the Orchestrator executes all side-effecting
 * operations (search, fetch, artifact writes, budget accounting).
 *
 * Uses the new domain modules:
 * - EvidenceMix to track intended categories and their statuses
 * - CandidateFilter to deduplicate, annotate, and rank search results
 * - NegativeEvidence to record failures, contradictions, and drops
 *
 * @param cwd   - Workspace root directory
 * @param runId - Research Run identity
 * @param brain - Research Brain instance (intent proposer)
 * @param budget - Research Budget for tracking and enforcement
 * @param options - Injection seams for orchestrator side effects
 * @param minimumSourceNotes - Minimum Source Notes required before early stop is accepted (default 1)
 * @param evidenceCategories - Intended evidence categories (from proposal's evidenceMix). Empty = no EvidenceMix tracking.
 * @param skipInit - If true, skip initial artifact creation and budget_approved ledger event (used for continuations).
 * @returns Metadata about the completed run
 */
export async function executeResearchRun(
  cwd: string,
  runId: string,
  brain: ResearchBrain,
  budget: Budget,
  options: RunLoopOptions,
  minimumSourceNotes: number = 1,
  evidenceCategories: string[] = [],
  skipInit: boolean = false,
): Promise<ResearchRunMeta> {
  const run = getRun(cwd, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  // ── Initialize artifacts (skip for continuations) ───────────────────
  if (!skipInit) {
    const notesDir = sourceNotesDir(cwd, runId);
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(ledgerPath(cwd, runId), ""); // empty file to start
  }

  let roundCount = 0;
  let sourceNoteCount = 0;
  /** In-memory collection of Source Note data for citation validation. */
  let sourceNoteDataList: SourceNoteData[] = [];
  let briefPathResult = "";
  let currentSummary = "";
  let completed = false;
  /** URLs selected by the Brain in select_sources, pending fetch in update_findings. */
  let pendingUrls: string[] = [];

  /** Annotated candidates from the last search round, for Brain prompt. */
  let lastFilteredCandidates: AnnotatedCandidate[] = [];

  /** Local status mirror for progress digest (updated alongside updateStatus calls). */
  let currentRunStatus: RunStatus = "running";

  // ── Domain module initialization ──────────────────────────────────────
  const evidenceMix = evidenceCategories.length > 0
    ? new EvidenceMix(evidenceCategories)
    : null;
  const negativeEvidence = new NegativeEvidence();

  const startTimeMs = Date.now();

  // On resume (skipInit=true), initialize state from existing artifacts
  if (skipInit) {
    const notesDir = sourceNotesDir(cwd, runId);
    // Ensure notes directory exists — readiness_failed runs may never have had one
    if (!existsSync(notesDir)) {
      mkdirSync(notesDir, { recursive: true });
    }
    try {
      const noteFiles = readdirSync(notesDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
      sourceNoteCount = noteFiles.length;

      // Load existing source notes into memory for citation validation
      for (const noteFile of noteFiles) {
        const parsed = parseSourceNoteFromFile(join(notesDir, noteFile.name));
        if (parsed) {
          sourceNoteDataList.push(parsed);
        }
      }
    } catch {
      sourceNoteCount = 0;
    }

    // Load existing run summary for brain context continuity
    const summaryFilePath = summaryPath(cwd, runId);
    if (existsSync(summaryFilePath)) {
      try {
        currentSummary = readFileSync(summaryFilePath, "utf-8");
      } catch {
        currentSummary = "";
      }
    }
  }

  // Record budget approval as the first ledger entry (append-only audit trail)
  // For continuations, record budget_revision instead (preserving the original budget_approved)
  if (skipInit) {
    appendLedger(cwd, runId, {
      round: 0,
      intent: "budget_revision",
      timestamp: new Date().toISOString(),
      content: "Budget revised for continuation — additional allocation approved.",
      meta: {
        newLimits: { ...budget.limits },
      },
    });
  } else {
    appendLedger(cwd, runId, {
      round: 0,
      intent: "budget_approved",
      timestamp: new Date().toISOString(),
      content: "Budget approved with hard limits.",
      meta: {
        limits: { ...budget.limits },
      },
    });
  }

  while (!completed && roundCount < MAX_ROUNDS) {
    roundCount++;

    // ── Check for steering signals before budget exhaustion ───────────
    // Check before budget exhaustion so user intent (cancel/force_synthesis)
    // is respected even when budget coincides with exhaustion.
    const steeringSignal = readAndClearSteeringSignal(cwd, runId);
    if (steeringSignal) {
      const steeringResult = processSteeringSignal(
        steeringSignal,
        run,
        sourceNoteCount,
        budget,
        evidenceCategories,
      );

      // Append the steering entry to the ledger
      appendLedger(
        cwd,
        runId,
        steeringEntryToLedger(steeringResult.entry) as LedgerEntry,
      );

      if (steeringResult.action === "stop") {
        // Cancel: stop without brief, preserve artifacts
        updateStatus(cwd, runId, "cancelled", steeringResult.stopReason);
        currentRunStatus = "cancelled";
        // No brief.md — briefPathResult stays empty
        refreshSummary(cwd, runId, run.question, budget, roundCount);
        refreshProgressDigest(cwd, runId, run.question, "cancelled", budget, roundCount, sourceNoteCount, evidenceMix, negativeEvidence, "", (Date.now() - startTimeMs) / 1000);
        completed = true;
        break;
      }

      if (steeringResult.action === "synthesize") {
        // Force synthesis: produce a caveated brief and stop
        briefPathResult = briefFilePath(cwd, runId);
        const coverageSection = evidenceMix
          ? coverageToPromptSection(evidenceMix, negativeEvidence)
          : undefined;
        const draftLines = [
          "# Research Brief (Forced Synthesis)",
          "",
          `**Note**: This brief was produced by user-forced synthesis. ` +
            `The user requested synthesis after the current step.`,
          steeringResult.synthesisReason
            ? `\n**Reason**: ${steeringResult.synthesisReason}\n`
            : "",
          "",
          "## Caveats",
          "",
          "- This brief was produced before all intended research was complete.",
          "- Evidence is limited to the sources gathered before forced synthesis.",
          sourceNoteCount === 0
            ? "- No Source Notes were extracted — this brief is based solely on model summarization."
            : `- ${sourceNoteCount} source note(s) were available at the time of forced synthesis.`,
          "",
        ];
        const forcedBrief = draftLines.filter((l) => l !== null).join("\n");
        const finalDraft = coverageSection
          ? forcedBrief + "\n\n---\n\n" + coverageSection
          : forcedBrief;
        writeFileSync(briefPathResult, finalDraft);

        updateStatus(cwd, runId, "completed");
        currentRunStatus = "completed";
        refreshSummary(cwd, runId, run.question, budget, roundCount);
        refreshProgressDigest(cwd, runId, run.question, "completed", budget, roundCount, sourceNoteCount, evidenceMix, negativeEvidence, briefPathResult, (Date.now() - startTimeMs) / 1000);
        completed = true;
        break;
      }

      // For add_instruction (action === "continue"): log it and continue the loop.
      // In v1, add_instruction is recorded in the ledger but does not change
      // run-loop behavior mid-round. The instruction is deferred to future
      // rounds via the ledger history available to the Brain in the prompt.
    }

    // Check budget exhaustion after steering check (respects cancel even when budget exhausted)
    const elapsedSec = (Date.now() - startTimeMs) / 1000;
    const elapsedTimeExceeded = elapsedSec >= budget.limits.maxElapsedSeconds;
    if (isExhausted(budget, elapsedSec)) {
      evidenceMix?.markNotSearchedDueToBudget();

      if (!briefPathResult) {
        briefPathResult = briefFilePath(cwd, runId);
        const isTimeExhausted = elapsedTimeExceeded && !isExhausted(budget);
        const finalDraft = generateBudgetExhaustedBrief(
          run.question,
          isTimeExhausted,
          elapsedSec,
          budget,
          evidenceMix,
          negativeEvidence,
        );
        writeFileSync(briefPathResult, finalDraft);
      }
      updateStatus(cwd, runId, "budget_exhausted");
      currentRunStatus = "budget_exhausted";
      refreshSummary(cwd, runId, run.question, budget, roundCount);
      refreshProgressDigest(cwd, runId, run.question, "budget_exhausted", budget, roundCount, sourceNoteCount, evidenceMix, negativeEvidence, briefPathResult, (Date.now() - startTimeMs) / 1000);
      completed = true;
      break;
    }

    // 1. Account for this model call
    budget = trackUsage(budget, { modelCalls: 1 });

    // 2. Build prompt with evidence coverage and filtered candidates
    const coverageSection = evidenceMix
      ? coverageToPromptSection(evidenceMix, negativeEvidence)
      : undefined;
    const prompt = buildPrompt(
      run.question,
      currentSummary,
      budget,
      coverageSection,
      lastFilteredCandidates,
    );
    const rawResponse = await brain.generate(prompt);
    const intent = parseIntent(rawResponse);

    // 3. Validate and handle parse errors
    if (!intent || !VALID_INTENTS.includes(intent.intent as any)) {
      appendLedger(cwd, runId, {
        round: roundCount,
        intent: "parse_error",
        timestamp: new Date().toISOString(),
        content: "Failed to parse valid intent from Brain response",
        meta: { raw: rawResponse.slice(0, 200) },
      });
      // Log the full raw response to diagnostics for debugging
      writeRawContentToDiagnostics(
        runDir(cwd, runId),
        `brain-response-round-${roundCount}`,
        rawResponse,
      );
      continue;
    }

    // 4. Execute based on intent type
    switch (intent.intent) {
      // ── search ───────────────────────────────────────────────────────
      case "search": {
        const query = typeof intent.query === "string" ? intent.query : run.question;
        const rawResults = await options.search(query);
        budget = trackUsage(budget, { searches: 1 });

        // Apply Candidate Filtering — dedup, annotate, rank, drop low-signal
        const filter = new CandidateFilter(query);
        const filtered = filter.filter(rawResults);

        // Store filtered candidates for the Brain's next select_sources prompt
        lastFilteredCandidates = filtered.candidates;

        // Record drops as negative evidence
        for (const drop of filtered.drops) {
          negativeEvidence.recordDroppedSource(drop);
        }

        // Record zero-result searches as negative evidence
        if (rawResults.length === 0) {
          negativeEvidence.recordFailedSearch(query);
        }

        // Update evidence categories using the explicit method
        // (orchestrator doesn't know the category, but the heuristic may help)
        if (evidenceMix) {
          // Capture which categories were "missing" before markSearched
          const beforeStatuses = new Map(
            evidenceMix.categories.map((c) => [c.category, c.status]),
          );
          evidenceMix.markSearched(query, rawResults.length > 0);

          // Record negative evidence for categories that just became "missing"
          if (rawResults.length === 0) {
            for (const cat of evidenceMix.categories) {
              if (
                cat.status === "missing" &&
                beforeStatuses.get(cat.category) === "not-searched"
              ) {
                negativeEvidence.recordMissingCategory(
                  cat.category,
                  `Search "${query}" returned no results.`,
                );
              }
            }
          }
        }

        appendLedger(cwd, runId, {
          round: roundCount,
          intent: "search",
          timestamp: new Date().toISOString(),
          content: `Search: "${query}" returned ${rawResults.length} result(s) (${filtered.candidates.length} after filtering)`,
          meta: {
            query,
            resultCount: rawResults.length,
            filteredCount: filtered.candidates.length,
            dropCount: filtered.drops.length,
            results: filtered.candidates.map((r) => ({
              url: r.canonicalUrl,
              title: r.title,
              score: r.signalScore,
              primary: r.isPrimary,
            })),
          },
        });
        break;
      }

      // ── select_sources ───────────────────────────────────────────────
      case "select_sources": {
        const urls = Array.isArray(intent.selectedUrls) ? intent.selectedUrls : [];
        pendingUrls = urls;

        appendLedger(cwd, runId, {
          round: roundCount,
          intent: "select_sources",
          timestamp: new Date().toISOString(),
          content: `Selected ${urls.length} source(s) for review`,
          meta: {
            selectedUrls: urls,
            reasoning: intent.reasoning,
          },
        });

        // ── Auto-fetch selected sources ─────────────────────────────────
        // The Brain selected sources; fetch them immediately so the next
        // round can use update_findings for snippet extraction or skip to
        // synthesize_brief without the Brain stalling on the protocol.
        let fetchedCount = 0;
        for (const url of urls) {
          budget = trackUsage(budget, { fetchAttempts: 1 });

          let fetched;
          try {
            fetched = await options.fetch(url);
          } catch (err: any) {
            negativeEvidence.recordFetchFailed(url, err.message ?? String(err));
            appendLedger(cwd, runId, {
              round: roundCount,
              intent: "fetch_failed",
              timestamp: new Date().toISOString(),
              content: `Failed to fetch ${url}: ${err.message ?? String(err)}`,
            });
            continue;
          }

          budget = trackUsage(budget, { sourceVisits: 1 });
          sourceNoteCount++;
          fetchedCount++;

          const isOversized = fetched.content.length >= DEFAULT_CHUNK_THRESHOLD;
          if (isOversized) {
            writeRawContentToDiagnostics(runDir(cwd, runId), url, fetched.content);
          }

          const snippets = extractSnippetsFromContent(fetched.content);
          const note = extractFromWebSource(fetched, sourceNoteCount, snippets.length > 0 ? snippets : ["[Content retrieved]"]);
          if (note && isOversized) {
            note.partialExtraction = true;
          }

          if (note) {
            writeSourceNote(cwd, runId, note);
            sourceNoteDataList.push(note);

            appendLedger(cwd, runId, {
              round: roundCount,
              intent: "source_note_created",
              timestamp: new Date().toISOString(),
              content: `Created Source Note ${note.citationNumber} for ${url}`,
              meta: {
                sourceNoteNumber: note.citationNumber,
                snippetCount: note.snippets.length,
                truncated: fetched.truncated,
              },
            });
          }
        }

        if (fetchedCount > 0) {
          appendLedger(cwd, runId, {
            round: roundCount,
            intent: "sources_fetched",
            timestamp: new Date().toISOString(),
            content: `Auto-fetched ${fetchedCount}/${urls.length} selected source(s)`,
            meta: { attempted: urls.length, fetched: fetchedCount },
          });
        }

        pendingUrls = [];
        // Clear filtered candidates so the Brain doesn't re-search the
        // same results now that sources are already fetched.
        lastFilteredCandidates = [];
        break;
      }

      // ── update_findings ──────────────────────────────────────────────
      case "update_findings": {
        // Orchestrator-phase: fetch any selected sources and create Source Notes
        const urlsToFetch = pendingUrls.length > 0 ? pendingUrls : [];

        for (const url of urlsToFetch) {
          budget = trackUsage(budget, { fetchAttempts: 1 });

          let fetched;
          try {
            fetched = await options.fetch(url);
          } catch (err: any) {
            negativeEvidence.recordFetchFailed(url, err.message ?? String(err));
            appendLedger(cwd, runId, {
              round: roundCount,
              intent: "fetch_failed",
              timestamp: new Date().toISOString(),
              content: `Failed to fetch ${url}: ${err.message ?? String(err)}`,
            });
            continue;
          }

          budget = trackUsage(budget, { sourceVisits: 1 });
          sourceNoteCount++;

          // AC5: Detect oversized content, write raw to diagnostics
          const isOversized = fetched.content.length >= DEFAULT_CHUNK_THRESHOLD;
          if (isOversized) {
            writeRawContentToDiagnostics(runDir(cwd, runId), url, fetched.content);
          }

          // Create Source Note — for oversized sources, mark partial extraction
          // since the Brain hasn't processed all chunks independently (v1).
          const extractedFallback = extractSnippetsFromContent(fetched.content);
          const useSnippets = Array.isArray(intent.snippets)
            ? intent.snippets.map((s: unknown) => typeof s === "string" ? s : JSON.stringify(s))
            : (extractedFallback.length > 0 ? extractedFallback : ["[Content retrieved]"]);
          // AC6: If the Brain's extraction yielded no relevant snippets, skip
          if (useSnippets.length === 0) {
            appendLedger(cwd, runId, {
              round: roundCount,
              intent: "source_note_creation_skipped",
              timestamp: new Date().toISOString(),
              content: `Skipped Source Note for ${url}: no relevant evidence extracted.`,
              meta: { url, snippetCount: 0 },
            });
            continue;
          }

          const note = extractFromWebSource(fetched, sourceNoteCount, useSnippets);
          if (note && isOversized) {
            note.partialExtraction = true;
          }

          if (note) {
            writeSourceNote(cwd, runId, note);
            sourceNoteDataList.push(note);

            appendLedger(cwd, runId, {
              round: roundCount,
              intent: "source_note_created",
              timestamp: new Date().toISOString(),
              content: `Created Source Note ${note.citationNumber} for ${url}`,
              meta: {
                sourceNoteNumber: note.citationNumber,
                snippetCount: note.snippets.length,
                truncated: fetched.truncated,
              },
            });
          } else {
            appendLedger(cwd, runId, {
              round: roundCount,
              intent: "source_note_creation_skipped",
              timestamp: new Date().toISOString(),
              content: `Skipped Source Note for ${url}: no relevant evidence extracted.`,
              meta: { url },
            });
          }
        }

        // Also handle Brain-provided findings that aren't tied to a specific URL
        if (urlsToFetch.length === 0 && intent.snippets && intent.snippets.length > 0) {
          // AC3 guard: Brain-provided snippets without fetched/read content
          // cannot become a Source Note. Record a ledger entry instead.
          appendLedger(cwd, runId, {
            round: roundCount,
            intent: "source_note_creation_skipped",
            timestamp: new Date().toISOString(),
            content: "Skipped Source Note: Brain-provided snippets without fetched/read content cannot support factual claims.",
            meta: { snippetCount: intent.snippets.length },
          });
        }

        pendingUrls = [];
        break;
      }

      // ── synthesize_brief ─────────────────────────────────────────────
      case "synthesize_brief": {
        const draft = typeof intent.briefDraft === "string" ? intent.briefDraft : "# Research Brief\n\nNo draft provided.";
        briefPathResult = briefFilePath(cwd, runId);

        // Validate citations and attempt repair within budget
        const validatedBrief = await validateAndRepairBrief(
          draft,
          sourceNoteDataList,
          brain,
          () => remainingBudget(budget).retryAttempts > 0 && remainingBudget(budget).modelCalls > 0,
          (usage) => { budget = trackUsage(budget, usage); },
          (reason, prevAvailable) => {
            appendLedger(cwd, runId, {
              round: roundCount,
              intent: "synthesis_failed",
              timestamp: new Date().toISOString(),
              content: reason,
              meta: { previousBriefAvailable: prevAvailable },
            });
          },
          false, // previousBriefAvailable
          run.question,
          (run.triggerSource ?? "human") as "human" | "agent" | "task",
        );

        if (validatedBrief) {
          // Append coverage + negative evidence section to the brief
          const coverageSection = evidenceMix
            ? coverageToPromptSection(evidenceMix, negativeEvidence)
            : undefined;
          const finalDraft = coverageSection
            ? validatedBrief + "\n\n---\n\n" + coverageSection
            : validatedBrief;
          writeFileSync(briefPathResult, finalDraft);

          appendLedger(cwd, runId, {
            round: roundCount,
            intent: "synthesize_brief",
            timestamp: new Date().toISOString(),
            content: "Research Brief drafted with validated citations",
            meta: {
              confidence: intent.confidence,
              gaps: intent.gaps,
              reasoning: intent.reasoning,
              coveragePresent: !!coverageSection,
            },
          });

          budget = trackUsage(budget, { synthesisRounds: 1 });
          completed = true;
        } else {
          // Invalid citations — don't write brief.md. Pipeline's
          // onFailedSynthesis callback already logged synthesis_failed.
          budget = trackUsage(budget, { synthesisRounds: 1 });
          briefPathResult = "";
          completed = true;
        }
        break;
      }

      // ── stop_early ───────────────────────────────────────────────────
      case "stop_early": {
        appendLedger(cwd, runId, {
          round: roundCount,
          intent: "stop_early",
          timestamp: new Date().toISOString(),
          content: `Brain recommended early stop: ${intent.reasoning ?? "no reason given"}`,
        });

        // Check the early-synthesis gate using domain modules
        const evidenceMet = sourceNoteCount >= minimumSourceNotes;
        const canStopEarly = evidenceMix
          ? justifiesEarlyStop(evidenceMix, negativeEvidence, minimumSourceNotes, sourceNoteCount)
          : evidenceMet || negativeEvidence.hasAny;

        if (canStopEarly) {
          // Accept early stop
          completed = true;

          if (!briefPathResult) {
            briefPathResult = briefFilePath(cwd, runId);
            const coverageSection = evidenceMix
              ? coverageToPromptSection(evidenceMix, negativeEvidence)
              : undefined;
            const reason = evidenceMet
              ? `Sufficient evidence (${sourceNoteCount} source notes).`
              : `Coverage assessment or Negative Evidence justifies early stop.`;
            const draft = [
              "# Research Brief (Early Stop)",
              "",
              reason,
              intent.reasoning ? `\n**Brain Reasoning**: ${intent.reasoning}\n` : "",
            ].join("\n");
            const finalDraft = coverageSection ? draft + "\n\n---\n\n" + coverageSection : draft;
            writeFileSync(briefPathResult, finalDraft);
          }
        } else {
          // Reject early stop — insufficient evidence
          const needed = minimumSourceNotes - sourceNoteCount;
          appendLedger(cwd, runId, {
            round: roundCount,
            intent: "early_stop_rejected",
            timestamp: new Date().toISOString(),
            content:
              `Early stop rejected: need ${needed} more source note(s) (have ${sourceNoteCount}, need ${minimumSourceNotes}) and no Negative Evidence recorded.`,
          });
          // Continue the loop — Brain will be asked again
        }
        break;
      }
    }

    // 5. Check budget exhaustion after every round (recompute elapsed time in case brain.generate() was slow)
    // Only fire if the run hasn't already completed (e.g., via synthesize_brief)
    if (!completed) {
      const postElapsedSec = (Date.now() - startTimeMs) / 1000;
      if (isExhausted(budget, postElapsedSec)) {
        evidenceMix?.markNotSearchedDueToBudget();
        if (!briefPathResult) {
          briefPathResult = briefFilePath(cwd, runId);
          const postTimeExceeded = postElapsedSec >= budget.limits.maxElapsedSeconds;
          const isTimeExhausted = postTimeExceeded && !isExhausted(budget);
          const finalDraft = generateBudgetExhaustedBrief(
            run.question,
            isTimeExhausted,
            postElapsedSec,
            budget,
            evidenceMix,
            negativeEvidence,
          );
          writeFileSync(briefPathResult, finalDraft);
        }
        updateStatus(cwd, runId, "budget_exhausted");
        currentRunStatus = "budget_exhausted";
        refreshSummary(cwd, runId, run.question, budget, roundCount);
        refreshProgressDigest(cwd, runId, run.question, "budget_exhausted", budget, roundCount, sourceNoteCount, evidenceMix, negativeEvidence, briefPathResult, (Date.now() - startTimeMs) / 1000);
        completed = true;
        break;
      }
    }

    // 6. Refresh Run Summary and Progress Digest for next round
    refreshSummary(cwd, runId, run.question, budget, roundCount);
    refreshProgressDigest(cwd, runId, run.question, currentRunStatus, budget, roundCount, sourceNoteCount, evidenceMix, negativeEvidence, briefPathResult, (Date.now() - startTimeMs) / 1000);
    currentSummary = readFileSync(summaryPath(cwd, runId), "utf-8");
  }

  // ── Finalize ──────────────────────────────────────────────────────────

  const finalRun = getRun(cwd, runId);
  if (finalRun && finalRun.status === "running") {
    // If loop exited without drafting a brief, mark as failed
    const targetStatus = briefPathResult ? "completed" : "failed";
    updateStatus(cwd, runId, targetStatus as any);
    currentRunStatus = targetStatus as RunStatus;
  }

  refreshSummary(cwd, runId, run.question, budget, roundCount);
  refreshProgressDigest(cwd, runId, run.question, currentRunStatus, budget, roundCount, sourceNoteCount, evidenceMix, negativeEvidence, briefPathResult, (Date.now() - startTimeMs) / 1000);

  // Auto-generate Human Research View for human-initiated completed or budget_exhausted runs
  const readableForView = new Set(["completed", "budget_exhausted"]);
  if (
    currentRunStatus &&
    readableForView.has(currentRunStatus) &&
    run.triggerSource === "human"
  ) {
    try {
      await renderRun(cwd, runId);
    } catch {
      // Auto-generation is best-effort — don't fail the run if view rendering fails
    }
  }

  const finalLedger = readLedger(cwd, runId);

  return {
    briefPath: briefPathResult,
    sourceNoteCount,
    ledgerEntryCount: finalLedger.length,
    roundCount,
    finalUsage: {
      ...budget.usage,
      elapsedSeconds: Math.round((Date.now() - startTimeMs) / 1000 * 10) / 10,
    },
  };
}

/**
 * Continue a budget-exhausted Research Run with an additional budget allocation.
 *
 * Preserves prior artifacts (ledger, source notes, brief) and records a
 * budget_revision as an append-only ledger event. The original budget_approved
 * event remains intact.
 *
 * @param cwd     - Workspace root directory
 * @param runId   - Research Run identity (existing budget_exhausted run)
 * @param brain   - Research Brain instance
 * @param budget  - New Research Budget (combined remaining + additional limits)
 * @param options - Injection seams for orchestrator side effects
 * @param evidenceCategories - Intended evidence categories
 * @returns Metadata about the completed run
 */
export async function continueResearchRun(
  cwd: string,
  runId: string,
  brain: ResearchBrain,
  budget: Budget,
  options: RunLoopOptions,
  evidenceCategories: string[] = [],
): Promise<ResearchRunMeta> {
  const run = getRun(cwd, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  if (run.status !== "budget_exhausted") {
    throw new Error(
      `Cannot continue run ${runId}: status is "${run.status}", expected "budget_exhausted".`,
    );
  }

  // Transition back to running for the continuation
  updateStatus(cwd, runId, "running");

  // Execute the research loop with skipInit=true (preserves existing artifacts,
  // records budget_revision instead of budget_approved)
  return executeResearchRun(
    cwd,
    runId,
    brain,
    budget,
    options,
    1,
    evidenceCategories,
    true, // skipInit
  );
}

/**
 * Resume an interrupted, readiness_failed, or budget_exhausted Research Run.
 *
 * For "interrupted": transitions back to running and resumes from existing
 * artifacts (skipInit=true), recording a budget_revision ledger entry.
 *
 * For "readiness_failed": reruns readiness check before resuming.
 * For "budget_exhausted": delegates to continueResearchRun.
 *
 * @param cwd     - Workspace root directory
 * @param runId   - Research Run identity (existing run in resumable status)
 * @param brain   - Research Brain instance
 * @param budget  - New Research Budget for the continuation
 * @param options - Injection seams for orchestrator side effects
 * @param evidenceCategories - Intended evidence categories
 * @param readinessParams - Optional: resolved model and brain for readiness re-check
 *   on readiness_failed resume
 * @returns Metadata about the completed run
 */
export async function resumeResearchRun(
  cwd: string,
  runId: string,
  brain: ResearchBrain,
  budget: Budget,
  options: RunLoopOptions,
  evidenceCategories: string[] = [],
  readinessParams?: {
    resolved: import("../brain/setup-policy/setup-policy").ResolvedModel;
    brain: import("../brain/setup-policy/setup-policy").BrainWithModel;
  },
): Promise<ResearchRunMeta> {
  const run = getRun(cwd, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  if (run.status === "budget_exhausted") {
    // Delegate to the existing continuation path
    return continueResearchRun(cwd, runId, brain, budget, options, evidenceCategories);
  }

  if (run.status === "readiness_failed") {
    // Present diagnostics and rerun readiness check before source work
    if (readinessParams) {
      const { runReadinessGate } = await import("../lifecycle/run-readiness");
      await runReadinessGate(
        cwd,
        runId,
        readinessParams.resolved,
        readinessParams.brain,
      );
    } else {
      // No readiness params provided — transition to running directly
      updateStatus(cwd, runId, "running");
    }
    return executeResearchRun(
      cwd,
      runId,
      brain,
      budget,
      options,
      1,
      evidenceCategories,
      true, // skipInit
    );
  }

  if (run.status !== "interrupted") {
    throw new Error(
      `Run ${runId} with status "${run.status}" cannot be resumed. ` +
      `Only interrupted, readiness_failed, or budget_exhausted runs are resumable.`,
    );
  }

  // Transition back to running for the continuation
  updateStatus(cwd, runId, "running");

  // Execute the research loop with skipInit=true (preserves existing artifacts,
  // records budget_revision instead of budget_approved)
  return executeResearchRun(
    cwd,
    runId,
    brain,
    budget,
    options,
    1,
    evidenceCategories,
    true, // skipInit
  );
}
