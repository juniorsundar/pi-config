import { describe, it, expect } from "vitest";
import { searchSource, fetchSource } from "./source-access";

describe("SourceAccess (seam)", () => {
  it("searchSource returns results with expected shape", async () => {
    // The seam returns results; in production it delegates to web search
    const results = await searchSource("test query");

    expect(Array.isArray(results)).toBe(true);
  });

  it("searchSource results have url, title, and snippet fields", async () => {
    const results = await searchSource("test query");
    if (results.length > 0) {
      const r = results[0];
      expect(r.url).toBeTypeOf("string");
      expect(r.title).toBeTypeOf("string");
      expect(r.snippet).toBeTypeOf("string");
    }
  });

  it("fetchSource returns a FetchedSource with expected shape", async () => {
    const source = await fetchSource("https://example.com");

    expect(source.url).toBe("https://example.com");
    expect(source.title).toBeTypeOf("string");
    expect(source.content).toBeTypeOf("string");
    expect(source.contentType).toBeTypeOf("string");
    expect(typeof source.truncated).toBe("boolean");
  });

  it("fetchSource records retrieval time", async () => {
    const source = await fetchSource("https://example.com");

    expect(source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
