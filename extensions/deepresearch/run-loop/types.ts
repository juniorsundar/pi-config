import type { SearchResult, FetchedSource } from "../source-access/source-access";
import type { SourceNoteData } from "../source-notes/types";

/**
 * Injection seam for Research Orchestrator side-effecting operations.
 * The Research Orchestrator uses these to perform search, fetch, and other
 * I/O-bound work on behalf of the Research Brain.
 */
export interface RunLoopOptions {
  /** Search for sources matching a query. */
  search: (query: string) => Promise<SearchResult[]>;
  /** Fetch and extract readable content from a URL. */
  fetch: (url: string) => Promise<FetchedSource>;
}

/**
 * Metadata returned after executing a Research Run.
 */
export interface ResearchRunMeta {
  /** Path to the brief.md artifact. */
  briefPath: string;
  /** Number of Source Notes created. */
  sourceNoteCount: number;
  /** Number of ledger entries appended. */
  ledgerEntryCount: number;
  /** Number of orchestration rounds executed. */
  roundCount: number;
  /** Final budget usage snapshot (for post-run analysis). */
  finalUsage?: {
    searches: number;
    fetchAttempts: number;
    sourceVisits: number;
    synthesisRounds: number;
    modelCalls: number;
    retryAttempts: number;
    elapsedSeconds: number;
  };
}

/**
 * A Continuation Recommendation generated when budget is exhausted.
 * Names remaining gaps and proposes an additional budget allocation.
 */
export interface ContinuationRecommendation {
  /** Remaining gaps that need investigation. */
  remainingGaps: string[];
  /** Proposed additional budget categories and limits. */
  proposedBudget: string;
}

/**
 * A single entry in the Claim/Evidence Ledger.
 */
export interface LedgerEntry {
  /** Round number. */
  round: number;
  /** The intent that produced this entry. */
  intent: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Free-form content. */
  content: string;
  /** Optional structured metadata. */
  meta?: Record<string, unknown>;
}

/**
 * A structured Source Note extracted from a source.
 *
 * Re-exported from source-notes/types.ts where this type is owned.
 */
export type { SourceNoteData };

/**
 * The Brain's parsed structured intent.
 */
export interface ParsedIntent {
  intent: string;
  reasoning?: string;
  query?: string;
  /** Brain-classified query type for search intents ("comparison" | "general"). */
  queryType?: "comparison" | "general";
  /** URLs the Brain selected for fetching. */
  selectedUrls?: string[];
  /** Per-URL justification from the Brain (used to override hallucination checks). */
  reasoningPerUrl?: Record<string, string>;
  snippets?: string[];
  briefDraft?: string;
  confidence?: string;
  gaps?: string[];
}
