import type { SearchResult, FetchedSource } from "../source-access/source-access";

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
}

/**
 * The Brain's parsed structured intent.
 */
export interface ParsedIntent {
  intent: string;
  reasoning?: string;
  query?: string;
  selectedUrls?: string[];
  snippets?: string[];
  briefDraft?: string;
  confidence?: string;
  gaps?: string[];
}
