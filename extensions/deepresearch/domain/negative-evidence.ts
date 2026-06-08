/**
 * Negative Evidence — records failed searches, missing categories,
 * contradictions, dropped sources, and user-excluded categories.
 *
 * CoverageState aggregates EvidenceMix + NegativeEvidence into a
 * unified snapshot that the Research Brain and Brief can consume.
 */

import type { EvidenceMix, EvidenceMixSnapshot } from "./evidence-mix";
import type { DropRecord } from "./candidate-filter";

// ── Types ──────────────────────────────────────────────────────────────────

export type NegativeEvidenceType =
  | "failed_search"     // Search returned zero results
  | "missing_category"  // Intended category could not be sourced
  | "contradiction"     // Sources contradict each other
  | "dropped_source"    // Candidate was dropped during filtering
  | "excluded_category" // User excluded this category
  | "fetch_failed";     // Fetch attempt failed

export interface NegativeEvidenceEntry {
  readonly type: NegativeEvidenceType;
  readonly timestamp: string;
  readonly detail: string;
  readonly category?: string;
  readonly url?: string;
}

export interface CoverageSnapshot {
  evidenceMix: EvidenceMixSnapshot;
  negativeEvidence: readonly NegativeEvidenceEntry[];
  readonly hasNegativeEvidence: boolean;
  readonly negativeEvidenceCount: number;
}

// ── NegativeEvidence class ──────────────────────────────────────────────────

export class NegativeEvidence {
  private readonly _entries: NegativeEvidenceEntry[];

  constructor() {
    this._entries = [];
  }

  /** All recorded negative evidence entries (read-only). */
  get entries(): readonly NegativeEvidenceEntry[] {
    return this._entries;
  }

  /** Number of recorded entries. */
  get count(): number {
    return this._entries.length;
  }

  /** Whether any negative evidence has been recorded. */
  get hasAny(): boolean {
    return this._entries.length > 0;
  }

  /** Record a failed search (zero results). */
  recordFailedSearch(query: string, timestamp?: string): void {
    this._entries.push({
      type: "failed_search",
      timestamp: timestamp ?? new Date().toISOString(),
      detail: `Search "${query}" returned zero results.`,
    });
  }

  /** Record that an intended category could not be sourced. */
  recordMissingCategory(category: string, reason: string, timestamp?: string): void {
    this._entries.push({
      type: "missing_category",
      timestamp: timestamp ?? new Date().toISOString(),
      detail: `Category "${category}": ${reason}`,
      category,
    });
  }

  /** Record a contradiction between sources. */
  recordContradiction(summary: string, timestamp?: string): void {
    this._entries.push({
      type: "contradiction",
      timestamp: timestamp ?? new Date().toISOString(),
      detail: summary,
    });
  }

  /** Record that a candidate source was dropped during filtering. */
  recordDroppedSource(drop: DropRecord, timestamp?: string): void {
    this._entries.push({
      type: "dropped_source",
      timestamp: timestamp ?? new Date().toISOString(),
      detail: `Dropped "${drop.title}" (${drop.url}): ${drop.reason}`,
      url: drop.url,
    });
  }

  /** Record that a user explicitly excluded a category. */
  recordExcludedCategory(category: string, timestamp?: string): void {
    this._entries.push({
      type: "excluded_category",
      timestamp: timestamp ?? new Date().toISOString(),
      detail: `Category "${category}" was excluded by the user.`,
      category,
    });
  }

  /** Record a failed fetch attempt. */
  recordFetchFailed(url: string, errorMsg: string, timestamp?: string): void {
    this._entries.push({
      type: "fetch_failed",
      timestamp: timestamp ?? new Date().toISOString(),
      detail: `Failed to fetch ${url}: ${errorMsg}`,
      url,
    });
  }

  /** Get all entries filtered by type. */
  byType(type: NegativeEvidenceType): NegativeEvidenceEntry[] {
    return this._entries.filter((e) => e.type === type);
  }

  /**
   * Render a summary of negative evidence for inclusion in Run Summary
   * or Brain prompt.
   */
  toPromptSection(): string {
    if (this._entries.length === 0) {
      return "## Negative Evidence\n\nNo negative evidence recorded.\n";
    }

    const lines: string[] = ["## Negative Evidence", ""];

    for (const entry of this._entries) {
      lines.push(`- **[${entry.type}]** ${entry.detail}`);
    }

    lines.push("");

    return lines.join("\n");
  }
}

// ── Coverage aggregation ───────────────────────────────────────────────────

/**
 * Build a unified CoverageSnapshot from EvidenceMix + NegativeEvidence.
 */
export function buildCoverageSnapshot(
  evidenceMix: EvidenceMix,
  negativeEvidence: NegativeEvidence,
): CoverageSnapshot {
  return {
    evidenceMix: evidenceMix.snapshot(),
    negativeEvidence: negativeEvidence.entries,
    hasNegativeEvidence: negativeEvidence.hasAny,
    negativeEvidenceCount: negativeEvidence.count,
  };
}

/**
 * Render a coverage block for the Brain prompt / Run Summary.
 */
export function coverageToPromptSection(
  evidenceMix: EvidenceMix,
  negativeEvidence: NegativeEvidence,
): string {
  const snap = buildCoverageSnapshot(evidenceMix, negativeEvidence);
  const parts: string[] = [evidenceMix.toPromptSection()];

  if (snap.hasNegativeEvidence) {
    parts.push(negativeEvidence.toPromptSection());
  }

  return parts.join("\n");
}

/**
 * Determine if the coverage state justifies early stop even when
 * minimum source notes haven't been met.
 */
export function justifiesEarlyStop(
  evidenceMix: EvidenceMix,
  negativeEvidence: NegativeEvidence,
  minimumSourceNotes: number,
  sourceNoteCount: number,
): boolean {
  // If minimum source notes are met, yes
  if (sourceNoteCount >= minimumSourceNotes) return true;

  // If all categories are found/weak (well-covered), yes
  const snap = evidenceMix.snapshot();
  const uncategorized = snap.missing + snap.excluded + snap.notSearched;
  if (uncategorized === 0 && snap.found > 0) return true;

  // If all categories have been searched or excluded but nothing found,
  // and there's negative evidence, yes
  const allSearched = snap.notSearched === 0;
  if (allSearched && negativeEvidence.hasAny) return true;

  return false;
}