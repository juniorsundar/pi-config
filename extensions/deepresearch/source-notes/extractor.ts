import { createHash } from "crypto";
import type { FetchedSource } from "../source-access/source-access";
import type { SourceNoteData } from "./types";

/**
 * Content read from a local file.
 */
export interface LocalFileContent {
  /** Absolute or relative path to the file. */
  filePath: string;
  /** The full text content read from the file. */
  content: string;
  /** Content type (e.g. "text/markdown", "text/plain"). */
  contentType: string;
  /** ISO 8601 retrieval time. */
  retrievedAt: string;
}

/**
 * Compute a SHA-256 hex digest of arbitrary string content.
 */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Extract a Source Note from a fetched web source.
 *
 * The extractor produces structured, goal-relevant notes from fetched content.
 * It does not store the raw full source — only metadata and evidence snippets
 * are retained in the Source Note artifact.
 *
 * @param fetched - The fetched source content and metadata
 * @param citationNumber - Sequential citation number (starts at 1)
 * @param snippets - Evidence snippets extracted by the Research Brain
 * @returns A structured SourceNoteData
 */
export function extractFromWebSource(
  fetched: FetchedSource,
  citationNumber: number,
  snippets: string[],
): SourceNoteData | null {
  return {
    source: fetched.url,
    finalUrl: fetched.finalUrl,
    title: fetched.title || fetched.url,
    sourceType: "web",
    retrievedAt: fetched.retrievedAt,
    citationNumber,
    snippets,
    contentType: fetched.contentType,
    truncated: fetched.truncated,
  };
}

/**
 * Extract a Source Note from local file content.
 *
 * Computes a SHA-256 content hash for integrity tracking. The raw file
 * content is not stored in the Source Note — only metadata and evidence
 * snippets are retained.
 *
 * @param fileContent - The local file content and metadata
 * @param citationNumber - Sequential citation number (starts at 1)
 * @param snippets - Evidence snippets extracted by the Research Brain
 * @returns A structured SourceNoteData with contentHash
 */
export function extractFromLocalSource(
  fileContent: LocalFileContent,
  citationNumber: number,
  snippets: string[],
): SourceNoteData | null {
  const hash = computeContentHash(fileContent.content);

  return {
    source: fileContent.filePath,
    title: fileContent.filePath,
    sourceType: "local",
    retrievedAt: fileContent.retrievedAt,
    citationNumber,
    snippets,
    contentType: fileContent.contentType,
    truncated: false,
    contentHash: hash,
  };
}

// ── Chunking ──────────────────────────────────────────────────────────────

/**
 * Result of extracting snippets from one chunk of an oversized source.
 */
export interface ChunkResult {
  /** Index of the chunk (0-based). */
  chunkIndex: number;
  /** Snippets extracted from this chunk (empty if no evidence found). */
  snippets: string[];
}

/**
 * Default chunk size threshold in characters.
 */
export const DEFAULT_CHUNK_THRESHOLD = 50_000;

/**
 * Split a string into chunks of at most `threshold` characters.
 * Simple character-count chunking — no natural-boundary splitting in v1.
 *
 * @param content  - The text to split
 * @param threshold - Maximum characters per chunk (default 50,000)
 * @returns Array of content chunks
 */
export function chunkContent(content: string, threshold: number = DEFAULT_CHUNK_THRESHOLD): string[] {
  if (threshold <= 0) {
    return [content];
  }
  if (content.length <= threshold) {
    return [content];
  }

  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += threshold) {
    chunks.push(content.slice(i, i + threshold));
  }
  return chunks;
}

/**
 * Source metadata shared across all chunks of a multi-chunk extraction.
 * This is a subset of SourceNoteData fields, used as input to mergeChunkExtractions.
 */
export interface SourceNoteMeta {
  /** URL or local file path. */
  url: string;
  /** Final URL for fetched web sources. */
  finalUrl?: string;
  /** Title when available. */
  title: string;
  /** Source type. */
  sourceType: "web" | "local";
  /** ISO 8601 retrieval time. */
  retrievedAt: string;
  /** Content type (e.g. "text/markdown", "text/plain"). */
  contentType: string;
  /** Whether the source was truncated. */
  truncated: boolean;
}

/**
 * Merge extraction results from multiple chunks into a single SourceNoteData.
 *
 * Chunks whose extraction produced no snippets are skipped. If at least one
 * chunk produced snippets but others failed, `partialExtraction: true` is set.
 * If no chunk produced any evidence, returns `null`.
 *
 * @param baseMeta      - Source metadata (shared across all chunks)
 * @param citationNumber - Sequential citation number
 * @param chunkResults  - Per-chunk extraction results
 * @returns Merged SourceNoteData, or null if no evidence found
 */
export function mergeChunkExtractions(
  baseMeta: SourceNoteMeta,
  citationNumber: number,
  chunkResults: ChunkResult[],
): SourceNoteData | null {
  // Collect all non-empty snippets in order
  const mergedSnippets: string[] = [];
  let hadEmpty = false;
  let hadContent = false;

  for (const cr of chunkResults) {
    if (cr.snippets.length === 0) {
      hadEmpty = true;
    } else {
      hadContent = true;
      mergedSnippets.push(...cr.snippets);
    }
  }

  // No evidence from any chunk
  if (!hadContent) {
    return null;
  }

  return {
    source: baseMeta.url,
    finalUrl: baseMeta.finalUrl,
    title: baseMeta.title,
    sourceType: baseMeta.sourceType,
    retrievedAt: baseMeta.retrievedAt,
    citationNumber,
    snippets: mergedSnippets,
    contentType: baseMeta.contentType,
    truncated: baseMeta.truncated,
    partialExtraction: hadEmpty || undefined,
  };
}