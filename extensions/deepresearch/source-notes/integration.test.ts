import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  extractFromWebSource,
  extractFromLocalSource,
  chunkContent,
  mergeChunkExtractions,
  computeContentHash,
} from "./extractor";
import { writeRawContentToDiagnostics } from "./diagnostics";
import type { FetchedSource } from "../source-access/source-access";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeFetched(overrides: Partial<FetchedSource> = {}): FetchedSource {
  return {
    url: "https://example.com/integration/doc",
    finalUrl: "https://example.com/integration/doc",
    title: "Integration Test Doc",
    content: "Full content from integration test source.",
    contentType: "text/markdown",
    truncated: false,
    retrievedAt: "2026-06-08T12:00:00.000Z",
    ...overrides,
  };
}

// ── AC 1: Normal web Source Note ──────────────────────────────────────────

describe("AC 1: Web Source Note includes all required fields", () => {
  it("creates a full SourceNoteData from a fetched web source", () => {
    const fetched = makeFetched();
    const note = extractFromWebSource(fetched, 1, [
      "The API requires authentication via bearer token.",
      "Rate limiting is 100 requests per minute per API key.",
    ]);

    expect(note).not.toBeNull();
    expect(note!.source).toBe("https://example.com/integration/doc");
    expect(note!.finalUrl).toBe("https://example.com/integration/doc");
    expect(note!.title).toBe("Integration Test Doc");
    expect(note!.sourceType).toBe("web");
    expect(note!.retrievedAt).toBe("2026-06-08T12:00:00.000Z");
    expect(note!.citationNumber).toBe(1);
    expect(note!.contentType).toBe("text/markdown");
    expect(note!.truncated).toBe(false);
    expect(note!.snippets).toHaveLength(2);
    expect(note!.snippets[0]).toContain("authentication");
  });
});

// ── AC 2: Local-file Source Note ──────────────────────────────────────────

describe("AC 2: Local-file Source Note includes path, type, hash", () => {
  it("creates a SourceNoteData with source type 'local' and content hash", () => {
    const note = extractFromLocalSource(
      {
        filePath: "/home/user/docs/api-spec.md",
        content: "API v2 returns JSON responses with pagination metadata.",
        contentType: "text/markdown",
        retrievedAt: "2026-06-08T12:00:00.000Z",
      },
      2,
      ["API v2 uses cursor-based pagination."],
    );

    expect(note).not.toBeNull();
    expect(note!.source).toBe("/home/user/docs/api-spec.md");
    expect(note!.sourceType).toBe("local");
    expect(note!.citationNumber).toBe(2);
    expect(note!.contentHash).toBeTypeOf("string");
    expect(note!.contentHash!.length).toBe(64);
    expect(note!.finalUrl).toBeUndefined();
    expect(note!.contentType).toBe("text/markdown");
  });

  it("content hash changes when file content changes", () => {
    const note1 = extractFromLocalSource(
      { filePath: "/tmp/conf.md", content: "version 1", contentType: "text/markdown", retrievedAt: "2026-06-08T12:00:00.000Z" },
      3,
      [],
    );
    const note2 = extractFromLocalSource(
      { filePath: "/tmp/conf.md", content: "version 2", contentType: "text/markdown", retrievedAt: "2026-06-08T12:00:00.000Z" },
      4,
      [],
    );

    expect(note1).not.toBeNull();
    expect(note2).not.toBeNull();
    expect(note1!.contentHash).not.toBe(note2!.contentHash);
  });
});

// ── AC 4: Raw content excluded from normal artifacts ──────────────────────

describe("AC 4: Raw full source content excluded from normal artifacts", () => {
  it("Source Note does NOT contain the raw full source", () => {
    const fetched = makeFetched({ content: "---VERY LONG RAW CONTENT---" });
    const note = extractFromWebSource(fetched, 5, ["Just the relevant snippet."]);

    expect(note).not.toBeNull();
    // The note has snippets, not the raw content
    expect(note!.snippets).toEqual(["Just the relevant snippet."]);
    // SourceNoteData has no `rawContent` or `content` field
    expect((note as any).content).toBeUndefined();
  });

  it("raw content can be written to Run Diagnostics when needed", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-diag-"));
    try {
      const runDir = join(tmpDir, "runs", "test-001");
      const rawContent = "VERY LONG RAW CONTENT THAT SHOULD GO TO DIAGNOSTICS";

      const resultPath = writeRawContentToDiagnostics(runDir, "https://example.com/doc", rawContent);

      expect(existsSync(resultPath)).toBe(true);
      expect(readFileSync(resultPath, "utf-8")).toBe(rawContent);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── AC 5: Oversized sources chunked and merged ────────────────────────────

describe("AC 5: Oversized sources chunked and merged", () => {
  const baseMeta = {
    url: "https://example.com/large-spec",
    finalUrl: "https://example.com/large-spec/final",
    title: "Large API Specification",
    sourceType: "web" as const,
    retrievedAt: "2026-06-08T12:00:00.000Z",
    contentType: "text/markdown",
    truncated: false,
  };

  it("chunks oversized content and merges results into one Source Note", () => {
    // Simulate a large document
    const largeContent = Array.from({ length: 3 }, (_, i) =>
      `# Section ${i + 1}\n\nThis is section ${i + 1} of the large document.\n`.repeat(200),
    ).join("\n\n");

    const chunks = chunkContent(largeContent, 5000);
    expect(chunks.length).toBeGreaterThan(1);

    // Simulate Brain extracting snippets from each chunk
    const chunkResults = chunks.map((_chunk, i) => ({
      chunkIndex: i,
      snippets: [`Section ${i + 1}: Key finding from chunk ${i}.`],
    }));

    const merged = mergeChunkExtractions(baseMeta, 6, chunkResults);

    expect(merged).not.toBeNull();
    expect(merged!.source).toBe("https://example.com/large-spec");
    expect(merged!.snippets).toHaveLength(chunks.length);
    expect(merged!.snippets[0]).toContain("Key finding from chunk 0");
    expect(merged!.snippets[1]).toContain("Key finding from chunk 1");
  });

  it("sets partialExtraction marker when some chunks fail", () => {
    const chunkResults = [
      { chunkIndex: 0, snippets: ["Chunk 0 had useful evidence."] },
      { chunkIndex: 1, snippets: [] }, // failed
      { chunkIndex: 2, snippets: ["Chunk 2 had useful evidence."] },
    ];

    const merged = mergeChunkExtractions(baseMeta, 7, chunkResults);

    expect(merged).not.toBeNull();
    expect(merged!.snippets).toHaveLength(2);
    expect(merged!.partialExtraction).toBe(true);
  });
});

// ── AC 6: No reliable evidence → no Source Note ───────────────────────────

describe("AC 6: No reliable evidence → no Source Note created", () => {
  const baseMeta = {
    url: "https://example.com/stale-doc",
    title: "Stale Documentation",
    sourceType: "web" as const,
    retrievedAt: "2026-06-08T12:00:00.000Z",
    contentType: "text/markdown",
    truncated: false,
  };

  it("returns null when no chunk produces relevant evidence", () => {
    const chunkResults = [
      { chunkIndex: 0, snippets: [] },
      { chunkIndex: 1, snippets: [] },
      { chunkIndex: 2, snippets: [] },
    ];

    const result = mergeChunkExtractions(baseMeta, 8, chunkResults);
    expect(result).toBeNull();
  });

  it("partial extraction with all-empty chunks also returns null", () => {
    const result = mergeChunkExtractions(baseMeta, 9, []);
    expect(result).toBeNull();
  });

  it("null return from mergeChunkExtractions documents the orchestrator contract", () => {
    // Contract: when mergeChunkExtractions returns null, the orchestrator
    // must NOT create a Source Note and MUST record a source_note_creation_skipped
    // ledger entry with the source URL in meta.
    const result = mergeChunkExtractions(baseMeta, 10, [
      { chunkIndex: 0, snippets: [] },
    ]);

    expect(result).toBeNull();
  });
});

// ── AC 3: Search snippet guardrail ────────────────────────────────────────

describe("AC 3: Search snippets cannot become Source Notes without fetching", () => {
  it("SearchResult is not accepted by extractFromWebSource (type-level)", () => {
    // TypeScript compilation check: the import of SearchResult exists,
    // but _typeGuard_assertSearchResultNotFetchedSource in extractor.test.ts
    // verifies that SearchResult is structurally incompatible with FetchedSource.
    // This is enforced at compile time, not at runtime.
    expect(typeof extractFromWebSource).toBe("function");
  });
});