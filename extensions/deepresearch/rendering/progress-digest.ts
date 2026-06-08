/**
 * Progress Digest — compact user-facing status update for a Research Run.
 *
 * The Progress Digest is written as a run artifact (progress-digest.md)
 * and refreshed between rounds. It is distinct from the model-facing
 * Run Summary (run-summary.md): optimized for human readability, not
 * for the Research Brain's prompt.
 *
 * @see CONTEXT.md — "Progress Digest"
 */

import type { RunStatus } from "../domain/types";
import type { BudgetLimits, BudgetUsage } from "../budgets/budget";
import type { EvidenceMixSnapshot } from "../domain/evidence-mix";

// ── Type ──────────────────────────────────────────────────────────────────

/**
 * Compact input for rendering a Progress Digest.
 *
 * All fields are primitives or small shapes — no references to live objects.
 * The renderer is a pure function: given this input, produce a markdown string.
 */
export interface ProgressDigestInput {
  /** Short identifier for this Run (e.g. date-slug-shortId). */
  runId: string;
  /** Current lifecycle status. */
  status: RunStatus;
  /** The Research Question. */
  question: string;
  /** Rounds completed so far. */
  roundCount: number;
  /** Current budget usage and approved limits. */
  budget: {
    usage: BudgetUsage;
    limits: BudgetLimits;
  };
  /** Evidence Mix snapshot, or null if no categories were defined. */
  evidenceMix: EvidenceMixSnapshot | null;
  /** Count of negative-evidence entries (failed searches, etc.). */
  negativeEvidenceCount: number;
  /** Unresolved gaps discovered so far. */
  gaps: string[];
  /** Description of what the run is doing next. */
  nextStep: string;
  /** Number of Source Notes created. */
  sourceNoteCount: number;
  /** Number of Ledger entries (including round 0). */
  ledgerEntryCount: number;
  /** Whether the Research Brief artifact exists. */
  hasBrief: boolean;
  /** Elapsed wall-clock seconds since the run started. */
  elapsedSeconds: number;
  /** Human-readable interruption or queued state (optional). */
  interruptionState?: string;
  /**
   * A one-line description of the strongest (or most notable) signal
   * discovered so far, e.g. "Documentation confirms API v2 supports streaming".
   * Optional — may not be known until later rounds.
   */
  currentSignal?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

function budgetLine(usage: BudgetUsage, limits: BudgetLimits): string {
  return (
    `${usage.searches}/${limits.maxSearches} searches, ` +
    `${usage.fetchAttempts}/${limits.maxFetchAttempts} fetches, ` +
    `${usage.sourceVisits}/${limits.maxSourceVisits} sources, ` +
    `${usage.synthesisRounds}/${limits.maxSynthesisRounds} synth rounds, ` +
    `${usage.modelCalls}/${limits.maxModelCalls} model calls`
  );
}

function evidenceLine(snap: EvidenceMixSnapshot | null): string {
  if (!snap) return "No evidence categories defined.";
  const catCount = snap.categories.length;
  const parts: string[] = [];
  if (snap.found > 0) parts.push(`${snap.found} found`);
  if (snap.weak > 0) parts.push(`${snap.weak} weak`);
  if (snap.missing > 0) parts.push(`${snap.missing} missing`);
  if (snap.excluded > 0) parts.push(`${snap.excluded} excluded`);
  if (snap.notSearched > 0) parts.push(`${snap.notSearched} not searched`);
  const coverage = parts.length > 0 ? parts.join(" · ") : "none";
  return `**${snap.overall}** — ${coverage} (${catCount} categories)`;
}

function statusIcon(status: RunStatus): string {
  switch (status) {
    case "running":           return "🔍";
    case "synthesizing":      return "✍️";
    case "queued":            return "⏳";
    case "completed":         return "✅";
    case "budget_exhausted":  return "💰";
    case "cancelled":         return "🚫";
    case "interrupted":       return "⚠️";
    case "failed":            return "❌";
    case "readiness_failed":  return "🔧";
    default:                  return "❓";
  }
}

function statusLabel(status: RunStatus): string {
  return status.replace(/_/g, " ");
}

function gapsBlock(gaps: string[]): string {
  if (gaps.length === 0) return "None identified.";
  // Show at most 3 gaps; note overflow
  const shown = gaps.slice(0, 3);
  const overflow = gaps.length - shown.length;
  let text = shown.map((g) => `- ${g}`).join("\n");
  if (overflow > 0) text += `\n- … and ${overflow} more`;
  return text;
}

// ── Renderer ───────────────────────────────────────────────────────────────

/**
 * Render a compact Progress Digest markdown string from a ProgressDigestInput.
 *
 * The output is designed to be read at a glance — distinct from the
 * model-facing Run Summary in both content density and tone.
 */
export function renderProgressDigest(input: ProgressDigestInput): string {
  const lines: string[] = [
    `## Progress Digest — \`${input.runId}\``,
    "",
    `${statusIcon(input.status)} **Status**: ${statusLabel(input.status)}` +
      (input.roundCount > 0 ? ` (Round ${input.roundCount})` : ""),
    "",
    `⏱️ **Elapsed**: ${formatElapsed(input.elapsedSeconds)}`,
    "",
    `📊 **Budget**: ${budgetLine(input.budget.usage, input.budget.limits)}`,
    "",
    `🎯 **Evidence**: ${evidenceLine(input.evidenceMix)}`,
    "",
  ];

  // Current signal
  if (input.currentSignal) {
    lines.push(`📡 **Signal**: ${input.currentSignal}`, "");
  }

  // Negative evidence note (compact)
  if (input.negativeEvidenceCount > 0) {
    lines.push(
      `⚠️ **Warnings**: ${input.negativeEvidenceCount} issue(s) recorded` +
        ` (failed searches, dropped sources, etc.)`,
      "",
    );
  }

  // Gaps
  lines.push("🔮 **Gaps:**");
  lines.push(gapsBlock(input.gaps));
  lines.push("");

  // Next step
  const nextIcon =
    input.status === "synthesizing" ? "✍️" :
    input.status === "running" ? "➡️" :
    input.status === "queued" ? "⏳" : "";
  if (nextIcon) {
    lines.push(`${nextIcon} **Next**: ${input.nextStep}`);
    lines.push("");
  }

  // Artifact pointers (compact, relative paths)
  const artifacts: string[] = [];
  if (input.hasBrief)            artifacts.push("📄 brief.md");
  if (input.sourceNoteCount > 0) artifacts.push(`📝 ${input.sourceNoteCount} source-notes`);
  artifacts.push(`📋 ${input.ledgerEntryCount} ledger entries`);
  lines.push(`📁 **Artifacts**: ${artifacts.join(" · ")}`);

  // Interruption / queued state
  if (input.interruptionState) {
    lines.push("", `⚠️ ${input.interruptionState}`);
  }

  lines.push("");

  return lines.join("\n");
}