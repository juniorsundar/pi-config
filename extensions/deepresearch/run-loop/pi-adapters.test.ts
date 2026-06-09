import { describe, it, expect, vi } from "vitest";
import {
  webSearchResultToSearchResult,
  webFetchResponseToFetchedSource,
  buildRunLoopOptions,
} from "./pi-adapters";

// ── Pure type-mapping: webSearchResult → SearchResult ─────────────────────

describe("webSearchResultToSearchResult", () => {
  it("maps href to url, body to snippet, preserves title", () => {
    const ws = {
      title: "Example Page",
      href: "https://example.com/page",
      body: "This is an example snippet.",
    };

    const result = webSearchResultToSearchResult(ws);

    expect(result).toEqual({
      url: "https://example.com/page",
      title: "Example Page",
      snippet: "This is an example snippet.",
    });
  });

  it("preserves empty strings without changing them", () => {
    const ws = { title: "", href: "", body: "" };
    const result = webSearchResultToSearchResult(ws);
    expect(result).toEqual({ url: "", title: "", snippet: "" });
  });
});

// ── Pure type-mapping: FetchResponse → FetchedSource ──────────────────────

describe("webFetchResponseToFetchedSource", () => {
  it("maps all provided fields correctly", () => {
    const fetchResp = {
      url: "https://example.com/article",
      finalUrl: "https://example.com/article?ref=1",
      contentType: "text/html",
      title: "Example Article",
      content: "# Article\n\nFull content here.",
      truncated: false,
    };

    const result = webFetchResponseToFetchedSource(fetchResp);

    expect(result.url).toBe("https://example.com/article");
    expect(result.finalUrl).toBe("https://example.com/article?ref=1");
    expect(result.contentType).toBe("text/html");
    expect(result.title).toBe("Example Article");
    expect(result.content).toBe("# Article\n\nFull content here.");
    expect(result.truncated).toBe(false);
    expect(result.retrievedAt).toBeTruthy();
    // retrievedAt should be an ISO string
    expect(new Date(result.retrievedAt).toISOString()).toBe(result.retrievedAt);
  });

  it("handles missing optional fields gracefully", () => {
    const fetchResp = {};

    const result = webFetchResponseToFetchedSource(fetchResp);

    expect(result.url).toBe("");
    expect(result.finalUrl).toBeUndefined();
    expect(result.contentType).toBe("text/markdown");
    expect(result.title).toBe("");
    expect(result.content).toBe("");
    expect(result.truncated).toBe(false);
    expect(result.retrievedAt).toBeTruthy();
  });

  it("uses content as empty string when absent", () => {
    const fetchResp = {
      url: "https://example.com",
      title: "No Content",
    };

    const result = webFetchResponseToFetchedSource(fetchResp);

    expect(result.content).toBe("");
    expect(result.url).toBe("https://example.com");
  });

  it("preserves truncated=true", () => {
    const fetchResp = { truncated: true };
    const result = webFetchResponseToFetchedSource(fetchResp);
    expect(result.truncated).toBe(true);
  });
});

// ── buildRunLoopOptions ───────────────────────────────────────────────────

describe("buildRunLoopOptions", () => {
  it("returns an object with search and fetch methods", () => {
    const mockPi = {
      exec: vi.fn(),
    } as any;

    const options = buildRunLoopOptions(mockPi);

    expect(options).toHaveProperty("search");
    expect(options).toHaveProperty("fetch");
    expect(typeof options.search).toBe("function");
    expect(typeof options.fetch).toBe("function");
  });

  it("search calls pi.exec and maps results", async () => {
    const mockPi = {
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          results: [
            { title: "Result 1", href: "https://example.com/1", body: "Snippet 1" },
            { title: "Result 2", href: "https://example.com/2", body: "Snippet 2" },
          ],
        }),
        stderr: "",
        code: 0,
      }),
    } as any;

    const options = buildRunLoopOptions(mockPi);
    const results = await options.search("test query");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      url: "https://example.com/1",
      title: "Result 1",
      snippet: "Snippet 1",
    });
    expect(results[1]).toEqual({
      url: "https://example.com/2",
      title: "Result 2",
      snippet: "Snippet 2",
    });
    // Verify pi.exec was called with uv and search script args
    expect(mockPi.exec).toHaveBeenCalledOnce();
    const [cmd, args] = mockPi.exec.mock.calls[0];
    expect(args.some((a: string) => a.includes("search.py"))).toBe(true);
    expect(args).toContain("--query");
    expect(args).toContain("test query");
  });

  it("search returns empty array on empty output", async () => {
    const mockPi = {
      exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }),
    } as any;

    const options = buildRunLoopOptions(mockPi);
    const results = await options.search("empty query");
    expect(results).toEqual([]);
  });

  it("fetch calls pi.exec and maps response", async () => {
    const mockPi = {
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          url: "https://example.com/article",
          finalUrl: "https://example.com/article",
          contentType: "text/html",
          title: "Example Article",
          content: "Full content",
          truncated: false,
        }),
        stderr: "",
        code: 0,
      }),
    } as any;

    const options = buildRunLoopOptions(mockPi);
    const result = await options.fetch("https://example.com/article");

    expect(result.url).toBe("https://example.com/article");
    expect(result.title).toBe("Example Article");
    expect(result.content).toBe("Full content");
    expect(result.truncated).toBe(false);

    expect(mockPi.exec).toHaveBeenCalledOnce();
    const [cmd, args] = mockPi.exec.mock.calls[0];
    expect(args.some((a: string) => a.includes("fetch.py"))).toBe(true);
    expect(args).toContain("--url");
    expect(args).toContain("https://example.com/article");
  });

  it("fetch returns placeholder on empty output", async () => {
    const mockPi = {
      exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }),
    } as any;

    const options = buildRunLoopOptions(mockPi);
    const result = await options.fetch("https://example.com/missing");

    expect(result.url).toBe("https://example.com/missing");
    expect(result.title).toBe("https://example.com/missing");
    expect(result.content).toBe("");
    expect(result.contentType).toBe("text/plain");
    expect(result.truncated).toBe(false);
    expect(result.retrievedAt).toBeTruthy();
  });

  it("search returns empty array on script error response", async () => {
    const mockPi = {
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ error: "Rate limited" }),
        stderr: "",
        code: 0,
      }),
    } as any;

    const options = buildRunLoopOptions(mockPi);
    const results = await options.search("error query");
    expect(results).toEqual([]);
  });

  it("fetch throws on script error response", async () => {
    const mockPi = {
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ error: "Rate limited", url: "https://example.com" }),
        stderr: "",
        code: 0,
      }),
    } as any;

    const options = buildRunLoopOptions(mockPi);
    await expect(options.fetch("https://example.com")).rejects.toThrow("Fetch failed: Rate limited");
  });

  it("search propagates pi.exec rejection", async () => {
    const mockPi = {
      exec: vi.fn().mockRejectedValue(new Error("Network error")),
    } as any;

    const options = buildRunLoopOptions(mockPi);
    await expect(options.search("fail")).rejects.toThrow("Network error");
  });

  it("fetch propagates pi.exec rejection", async () => {
    const mockPi = {
      exec: vi.fn().mockRejectedValue(new Error("Network error")),
    } as any;

    const options = buildRunLoopOptions(mockPi);
    await expect(options.fetch("https://example.com")).rejects.toThrow("Network error");
  });
});
