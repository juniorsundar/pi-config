/**
 * Domain types for Source Notes — owned by the source-notes module.
 *
 * These types are produced by source-note extraction and consumed by
 * the run-loop orchestrator. Re-exported by run-loop/types.ts for
 * backward compatibility during the transition.
 */

/**
 * A structured Source Note extracted from a source.
 */
export interface SourceNoteData {
  /** URL or local file path. */
  source: string;
  /** Final URL for fetched web sources. */
  finalUrl?: string;
  /** Title when available. */
  title: string;
  /** Source type. */
  sourceType: "web" | "local";
  /** ISO 8601 retrieval time. */
  retrievedAt: string;
  /** Citation number (sequential, starts at 1). */
  citationNumber: number;
  /** Evidence snippets extracted by the Brain. */
  snippets: string[];
  /** Fetched content type. */
  contentType: string;
  /** Whether the source was truncated. */
  truncated: boolean;
  /** Content hash (SHA-256) for local files. */
  contentHash?: string;
  /** Whether extraction was partial (some chunks failed). */
  partialExtraction?: boolean;
}