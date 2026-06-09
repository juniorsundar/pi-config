import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SearchResult, FetchedSource } from "../source-access/source-access";
import type { RunLoopOptions } from "./types";
import * as path from "node:path";
import * as fs from "node:fs";

// ── Web-search internal types (not exported from the web-search extension) ──

interface WebSearchResult {
  title: string;
  href: string;
  body: string;
}

interface WebFetchResponse {
  url?: string;
  finalUrl?: string;
  contentType?: string;
  title?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
}

// ── Pure type-mapping functions (independently testable) ───────────────────

export function webSearchResultToSearchResult(ws: WebSearchResult): SearchResult {
  return {
    url: ws.href,
    title: ws.title,
    snippet: ws.body,
  };
}

export function webFetchResponseToFetchedSource(fetchResp: WebFetchResponse): FetchedSource {
  return {
    url: fetchResp.url ?? "",
    finalUrl: fetchResp.finalUrl,
    title: fetchResp.title ?? fetchResp.url ?? "",
    content: fetchResp.content ?? "",
    contentType: fetchResp.contentType ?? "text/markdown",
    truncated: fetchResp.truncated ?? false,
    retrievedAt: new Date().toISOString(),
  };
}

// ── Helpers for locating web-search scripts ────────────────────────────────

/**
 * Resolve the web-search extension directory relative to this file.
 *
 * Layout:
 *   extensions/
 *     deepresearch/
 *       run-loop/
 *         pi-adapters.ts   ← this file
 *     web-search/
 *       scripts/
 *         search.py
 *         fetch.py
 *
 * From run-loop/ → ../.. → extensions/ → web-search/
 */
function getWebSearchDir(): string {
  return path.resolve(__dirname, "..", "..", "web-search");
}

function getUvBinary(): string {
  const home = process.env.HOME || "";
  const candidates = [
    "uv",
    home ? path.join(home, ".local/bin/uv") : undefined,
    home ? path.join(home, ".cargo/bin/uv") : undefined,
    "/usr/local/bin/uv",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === "uv" || fs.existsSync(candidate)) return candidate;
  }
  return "uv";
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build a real `RunLoopOptions` that delegates search and fetch to Pi's
 * web-search extension Python scripts via `pi.exec`.
 */
export function buildRunLoopOptions(pi: ExtensionAPI): RunLoopOptions {
  const webSearchDir = getWebSearchDir();
  const searchScript = path.join(webSearchDir, "scripts", "search.py");
  const fetchScript = path.join(webSearchDir, "scripts", "fetch.py");
  const uv = getUvBinary();

  const runOptions = { timeout: 20_000, cwd: webSearchDir };

  return {
    async search(query: string): Promise<SearchResult[]> {
      const result = await pi.exec(uv, [
        "run",
        "--project", webSearchDir,
        "python", searchScript,
        "--query", query,
        "--max-results", "10",
        "--region", "wt-wt",
        "--safesearch", "moderate",
      ], runOptions);

      const output = result.stdout.trim();
      if (!output) return [];

      let parsed: any;
      try {
        parsed = JSON.parse(output);
      } catch {
        return [];
      }

      // Script-level error — degrade gracefully; the run loop handles
      // empty results by recording negative evidence.
      if (!Array.isArray(parsed) && typeof (parsed as any).error === "string") {
        return [];
      }

      const rawResults: WebSearchResult[] = Array.isArray(parsed)
        ? parsed
        : parsed.results ?? [];

      return rawResults.map(webSearchResultToSearchResult);
    },

    async fetch(url: string): Promise<FetchedSource> {
      const result = await pi.exec(uv, [
        "run",
        "--project", webSearchDir,
        "python", fetchScript,
        "--url", url,
        "--max-chars", "30000",
        "--format", "markdown",
      ], { ...runOptions, timeout: 30_000 });

      const output = result.stdout.trim();
      if (!output) {
        return {
          url,
          title: url,
          content: "",
          contentType: "text/plain",
          truncated: false,
          retrievedAt: new Date().toISOString(),
        };
      }

      let parsed: WebFetchResponse;
      try {
        parsed = JSON.parse(output) as WebFetchResponse;
      } catch {
        return {
          url,
          title: url,
          content: `Failed to parse fetch response for ${url}`,
          contentType: "text/plain",
          truncated: false,
          retrievedAt: new Date().toISOString(),
        };
      }

      // Script-level error — throw so the run loop's inline try/catch
      // (run-loop.ts ~line 970) records it as a failed fetch.
      if (parsed.error) {
        throw new Error(`Fetch failed: ${parsed.error}`);
      }

      return webFetchResponseToFetchedSource(parsed);
    },
  };
}
