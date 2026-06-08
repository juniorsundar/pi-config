/**
 * Citation Validator — deterministic analysis helper.
 *
 * Extracts numbered citations from Research Brief markdown and validates
 * them against existing Source Notes. Owned by the brief-pipeline layer;
 * does not interact with the Research Brain.
 */

import type { SourceNoteData } from "../source-notes/types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CitationValidationResult {
  /** Whether all citations reference existing Source Notes. */
  valid: boolean;
  /** Citation numbers found in the brief that don't exist in source notes. */
  invalidCitations: number[];
  /** All citation numbers found in the brief. */
  allCitations: number[];
}

// ── Extract ────────────────────────────────────────────────────────────────

/**
 * Extract numbered citation references from markdown text.
 *
 * Matches patterns like [1], [2,3], [4, 5], [6-8], or [see 9] — any bracket
 * containing digits, commas, hyphens, and spaces.
 *
 * Skips: markdown links [text](url), non-numeric brackets [abc].
 */
export function extractCitations(markdown: string): number[] {
  // Match any bracket group that contains at least one digit
  const bracketPattern = /\[(\d[\d, \-]*)\]/g;
  const citations: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = bracketPattern.exec(markdown)) !== null) {
    // Split on comma first to get segments
    const segments = match[1].split(",");
    for (const seg of segments) {
      const trimmed = seg.trim();
      // Check for range pattern like "1-3" or "1 - 3"
      const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let n = start; n <= end; n++) {
          citations.push(n);
        }
      } else if (/^\d+$/.test(trimmed)) {
        citations.push(parseInt(trimmed, 10));
      }
    }
  }

  return citations;
}

// ── Validate ───────────────────────────────────────────────────────────────

/**
 * Validate that every citation number references an existing Source Note.
 *
 * Pure deterministic function — no side effects, no model calls.
 */
export function validateCitations(
  citations: number[],
  sourceNotes: SourceNoteData[],
): CitationValidationResult {
  const validNumbers = new Set(sourceNotes.map((n) => n.citationNumber));
  const invalidCitations = citations.filter((c) => !validNumbers.has(c));

  return {
    valid: invalidCitations.length === 0,
    invalidCitations,
    allCitations: [...citations],
  };
}