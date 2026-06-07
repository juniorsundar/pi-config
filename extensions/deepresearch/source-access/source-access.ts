/**
 * Source access seam for the Research Orchestrator.
 *
 * In production, searchSource and fetchSource delegate to Pi-style
 * web search and fetch. In v1, these are pure seams that can be swapped
 * for real or mocked implementations in tests.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface FetchedSource {
  url: string;
  finalUrl?: string;
  title: string;
  content: string;
  contentType: string;
  truncated: boolean;
  retrievedAt: string;
}

// ── Seam functions ─────────────────────────────────────────────────────────

/**
 * Search for sources matching a query.
 * Seam — returns empty results by default; real implementation is injected
 * by the Research Orchestrator at runtime.
 */
export async function searchSource(
  _query: string,
): Promise<SearchResult[]> {
  return [];
}

/**
 * Fetch and extract readable content from a URL.
 * Seam — returns a minimal placeholder by default; real implementation is
 * injected by the Research Orchestrator at runtime.
 */
export async function fetchSource(
  url: string,
): Promise<FetchedSource> {
  return {
    url,
    title: url,
    content: `Fetched content for ${url}`,
    contentType: "text/markdown",
    truncated: false,
    retrievedAt: new Date().toISOString(),
  };
}
