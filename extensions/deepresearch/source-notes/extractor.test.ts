import { describe, it, expect } from "vitest";
import { extractFromWebSource, extractFromLocalSource, computeContentHash, chunkContent, mergeChunkExtractions } from "./extractor";
import type { FetchedSource } from "../source-access/source-access";
import type { SearchResult } from "../source-access/source-access";
import type { SourceNoteData } from "./types";

// Guardrail: SearchResult is structurally incompatible with FetchedSource.
function _typeGuard_assertSearchResultNotFetchedSource(sr: SearchResult): void {
  // @ts-expect-error — SearchResult is missing FetchedSource fields
  const _: FetchedSource = sr;
}

function makeFetched(overrides: Partial<FetchedSource> = {}): FetchedSource {
  return {
    url: "https://example.com/doc",
    finalUrl: "https://example.com/doc",
    title: "Example Documentation",
    content: "Full fetched content for testing purposes.",
    contentType: "text/markdown",
    truncated: false,
    retrievedAt: "2026-06-08T10:00:00.000Z",
    ...overrides,
  };
}

describe("extractFromWebSource", () => {
  it("produces a SourceNoteData with all required web fields", () => {
    const fetched = makeFetched();
    const note = extractFromWebSource(fetched, 1, [
      "The API returns a 200 status code on success.",
      "Rate limits apply at 100 requests per minute.",
    ]);

    expect(note).not.toBeNull();
    expect(note!.source).toBe("https://example.com/doc");
    expect(note!.finalUrl).toBe("https://example.com/doc");
    expect(note!.title).toBe("Example Documentation");
    expect(note!.sourceType).toBe("web");
    expect(note!.retrievedAt).toBe("2026-06-08T10:00:00.000Z");
    expect(note!.citationNumber).toBe(1);
    expect(note!.contentType).toBe("text/markdown");
    expect(note!.truncated).toBe(false);
    expect(note!.snippets).toEqual([
      "The API returns a 200 status code on success.",
      "Rate limits apply at 100 requests per minute.",
    ]);
  });

  it("passes through source url and leaves finalUrl undefined when missing", () => {
    const fetched = makeFetched({ finalUrl: undefined });
    const note = extractFromWebSource(fetched, 1, ["snippet"]);
    expect(note).not.toBeNull();
    expect(note!.source).toBe("https://example.com/doc");
    expect(note!.finalUrl).toBeUndefined();
  });

  it("uses url as fallback when title is empty", () => {
    const fetched = makeFetched({ title: "" });
    const note = extractFromWebSource(fetched, 2, ["snippet"]);
    expect(note).not.toBeNull();
    expect(note!.title).toBe("https://example.com/doc");
  });

  it("sets truncated flag from fetched source", () => {
    const fetched = makeFetched({ truncated: true });
    const note = extractFromWebSource(fetched, 3, ["snippet"]);
    expect(note).not.toBeNull();
    expect(note!.truncated).toBe(true);
  });

  it("accepts empty snippets array", () => {
    const fetched = makeFetched();
    const note = extractFromWebSource(fetched, 4, []);
    expect(note).not.toBeNull();
    expect(note!.snippets).toEqual([]);
  });
});

describe("extractFromLocalSource", () => {
  it("produces a SourceNoteData with all required local-file fields", () => {
    const note = extractFromLocalSource(
      { filePath: "/tmp/some-doc.md", content: "File contents here", contentType: "text/markdown", retrievedAt: "2026-06-08T10:00:00.000Z" },
      1,
      ["Key insight from the document."],
    );

    expect(note).not.toBeNull();
    expect(note!.source).toBe("/tmp/some-doc.md");
    expect(note!.sourceType).toBe("local");
    expect(note!.retrievedAt).toBe("2026-06-08T10:00:00.000Z");
    expect(note!.citationNumber).toBe(1);
    expect(note!.contentType).toBe("text/markdown");
    expect(note!.snippets).toEqual(["Key insight from the document."]);
    expect(note!.contentHash).toBeTypeOf("string");
    expect(note!.contentHash!.length).toBeGreaterThan(0);
  });

  it("computes a deterministic SHA-256 content hash", () => {
    const content = "Same content produces same hash";
    const note1 = extractFromLocalSource(
      { filePath: "/tmp/a.md", content, contentType: "text/plain", retrievedAt: "2026-06-08T10:00:00.000Z" },
      1,
      ["snippet"],
    );
    const note2 = extractFromLocalSource(
      { filePath: "/tmp/b.md", content, contentType: "text/plain", retrievedAt: "2026-06-08T10:00:00.000Z" },
      2,
      ["snippet"],
    );

    expect(note1).not.toBeNull();
    expect(note2).not.toBeNull();
    expect(note1!.contentHash).toBe(note2!.contentHash);
  });

  it("uses file path as fallback when title is empty", () => {
    const note = extractFromLocalSource(
      { filePath: "/tmp/no-title.txt", content: "stuff", contentType: "text/plain", retrievedAt: "2026-06-08T10:00:00.000Z" },
      3,
      [],
    );
    expect(note).not.toBeNull();
    expect(note!.title).toBe("/tmp/no-title.txt");
  });

  it("does not have finalUrl field", () => {
    const note = extractFromLocalSource(
      { filePath: "/tmp/doc.md", content: "x", contentType: "text/markdown", retrievedAt: "2026-06-08T10:00:00.000Z" },
      1,
      [],
    );
    expect(note).not.toBeNull();
    expect(note!.finalUrl).toBeUndefined();
  });

  it("is not truncated", () => {
    const note = extractFromLocalSource(
      { filePath: "/tmp/doc.md", content: "x", contentType: "text/markdown", retrievedAt: "2026-06-08T10:00:00.000Z" },
      1,
      [],
    );
    expect(note).not.toBeNull();
    expect(note!.truncated).toBe(false);
  });
});

describe("computeContentHash", () => {
  it("returns a 64-character hex SHA-256 hash", () => {
    const hash = computeContentHash("test content");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different hashes for different content", () => {
    const hash1 = computeContentHash("content A");
    const hash2 = computeContentHash("content B");
    expect(hash1).not.toBe(hash2);
  });
});

describe("chunkContent", () => {
  it("returns single chunk when content is below threshold", () => {
    const chunks = chunkContent("Small content", 100);
    expect(chunks).toEqual(["Small content"]);
  });

  it("splits content into multiple chunks when above threshold", () => {
    const content = "a".repeat(250);
    const chunks = chunkContent(content, 100);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(100);
    expect(chunks[1].length).toBe(100);
    expect(chunks[2].length).toBe(50);
  });

  it("returns content at exact threshold as a single chunk", () => {
    const chunks = chunkContent("x".repeat(100), 100);
    expect(chunks).toEqual(["x".repeat(100)]);
  });

  it("handles empty content", () => {
    const chunks = chunkContent("", 100);
    expect(chunks).toEqual([""]);
  });

  it("returns single chunk when threshold is zero or negative", () => {
    expect(chunkContent("test", 0)).toEqual(["test"]);
    expect(chunkContent("test", -1)).toEqual(["test"]);
  });
});

describe("mergeChunkExtractions", () => {
  const baseMeta = {
    url: "https://example.com/large-doc",
    finalUrl: "https://example.com/large-doc",
    title: "Large Document",
    sourceType: "web" as const,
    retrievedAt: "2026-06-08T10:00:00.000Z",
    contentType: "text/markdown",
    truncated: false,
  };

  it("merges multiple chunks into one SourceNoteData", () => {
    const result = mergeChunkExtractions(baseMeta, 1, [
      { chunkIndex: 0, snippets: ["Introduction covers the basics."] },
      { chunkIndex: 1, snippets: ["Chapter 2 dives into advanced topics."] },
      { chunkIndex: 2, snippets: ["Appendix contains reference tables."] },
    ]);

    expect(result).not.toBeNull();
    expect(result!.source).toBe("https://example.com/large-doc");
    expect(result!.citationNumber).toBe(1);
    expect(result!.snippets).toEqual([
      "Introduction covers the basics.",
      "Chapter 2 dives into advanced topics.",
      "Appendix contains reference tables.",
    ]);
    expect(result!.partialExtraction).toBeUndefined();
  });

  it("sets partialExtraction when some chunks yield no snippets", () => {
    const result = mergeChunkExtractions(baseMeta, 2, [
      { chunkIndex: 0, snippets: ["Chunk 0 has evidence."] },
      { chunkIndex: 1, snippets: [] },
      { chunkIndex: 2, snippets: ["Chunk 2 has evidence."] },
    ]);

    expect(result).not.toBeNull();
    expect(result!.snippets).toEqual(["Chunk 0 has evidence.", "Chunk 2 has evidence."]);
    expect(result!.partialExtraction).toBe(true);
  });

  it("sets partialExtraction for a mix of full and empty chunks", () => {
    const result = mergeChunkExtractions(baseMeta, 3, [
      { chunkIndex: 0, snippets: [] },
      { chunkIndex: 1, snippets: ["Only this chunk had useful info."] },
      { chunkIndex: 2, snippets: [] },
    ]);

    expect(result).not.toBeNull();
    expect(result!.snippets).toEqual(["Only this chunk had useful info."]);
    expect(result!.partialExtraction).toBe(true);
  });

  it("returns null when no chunk produces evidence", () => {
    const result = mergeChunkExtractions(baseMeta, 4, [
      { chunkIndex: 0, snippets: [] },
      { chunkIndex: 1, snippets: [] },
      { chunkIndex: 2, snippets: [] },
    ]);

    expect(result).toBeNull();
  });

  it("returns null when chunkResults is empty", () => {
    const result = mergeChunkExtractions(baseMeta, 5, []);
    expect(result).toBeNull();
  });

  it("does not set partialExtraction for a single chunk with snippets", () => {
    const result = mergeChunkExtractions(baseMeta, 6, [
      { chunkIndex: 0, snippets: ["Only chunk, everything fine."] },
    ]);

    expect(result).not.toBeNull();
    expect(result!.snippets).toEqual(["Only chunk, everything fine."]);
    expect(result!.partialExtraction).toBeUndefined();
  });
});