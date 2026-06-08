import { describe, it, expect } from "vitest";
import { extractCitations, validateCitations } from "./citation-validator";
import type { SourceNoteData } from "../source-notes/types";

describe("Citation validator", () => {
  describe("extractCitations", () => {
    it("extracts single citation [1] from markdown", () => {
      const md = "Approach A [1] is recommended.";
      expect(extractCitations(md)).toEqual([1]);
    });

    it("extracts multiple citations [1][2][3]", () => {
      const md = "Approach A [1][2] is recommended [3].";
      expect(extractCitations(md)).toEqual([1, 2, 3]);
    });

    it("extracts citations in [N] format with surrounding text", () => {
      const md = "Approach A [1] shows improvement [2].";
      expect(extractCitations(md)).toEqual([1, 2]);
    });

    it("extracts citations from numbered reference format [1][2][3]", () => {
      const md = "Sources [1][2][3] confirm.";
      expect(extractCitations(md)).toEqual([1, 2, 3]);
    });

    it("returns empty array when no citations", () => {
      const md = "This text has no citations.";
      expect(extractCitations(md)).toEqual([]);
    });

    it("extracts single citation [1] in heading", () => {
      const md = "## Sources [1]";
      expect(extractCitations(md)).toEqual([1]);
    });

    it("handles citations without brackets", () => {
      const md = "Plain text with no references.";
      expect(extractCitations(md)).toEqual([]);
    });

    it("skips non-numeric bracket content [abc]", () => {
      const md = "Some markdown [link](url) here [abc].";
      expect(extractCitations(md)).toEqual([]);
    });

    it("extracts only numeric brackets, skipping text brackets", () => {
      const md = "Claim [1] supported [abc] and [foo] here.";
      expect(extractCitations(md)).toEqual([1]);
    });

    it("extracts compound format [1,2]", () => {
      const md = "Sources [1,2] confirm.";
      expect(extractCitations(md)).toEqual([1, 2]);
    });

    it("extracts compound format [1, 2, 3]", () => {
      const md = "Sources [1, 2, 3] confirm.";
      expect(extractCitations(md)).toEqual([1, 2, 3]);
    });

    it("extracts range format [1-3]", () => {
      const md = "Sources [1-3] confirm.";
      expect(extractCitations(md)).toEqual([1, 2, 3]);
    });

    it("extracts mixed formats [1][2,3]", () => {
      const md = "Sources [1][2,3] confirm.";
      expect(extractCitations(md)).toEqual([1, 2, 3]);
    });

    it("handles empty brackets []", () => {
      const md = "Empty brackets [] here.";
      expect(extractCitations(md)).toEqual([]);
    });
  });

  describe("validateCitations", () => {
    const sourceNotes: SourceNoteData[] = [
      {
        source: "https://example.com/1",
        title: "Source One",
        citationNumber: 1,
        snippets: ["Evidence one"],
        sourceType: "web",
        retrievedAt: "2026-06-01T00:00:00Z",
        contentType: "text/html",
        truncated: false,
      },
      {
        source: "https://example.com/2",
        title: "Source Two",
        citationNumber: 2,
        snippets: ["Evidence two"],
        sourceType: "web",
        retrievedAt: "2026-06-01T00:00:00Z",
        contentType: "text/html",
        truncated: false,
      },
      {
        source: "https://example.com/5",
        title: "Source Five",
        citationNumber: 5,
        snippets: ["Evidence five"],
        sourceType: "web",
        retrievedAt: "2026-06-01T00:00:00Z",
        contentType: "text/html",
        truncated: false,
      },
    ];

    it("returns valid=true when all citations exist in source notes", () => {
      const result = validateCitations([1, 2], sourceNotes);
      expect(result.valid).toBe(true);
      expect(result.invalidCitations).toEqual([]);
      expect(result.allCitations).toEqual([1, 2]);
    });

    it("returns valid=false when some citations are missing", () => {
      const result = validateCitations([1, 3], sourceNotes);
      expect(result.valid).toBe(false);
      expect(result.invalidCitations).toEqual([3]);
      expect(result.allCitations).toEqual([1, 3]);
    });

    it("returns valid=false when all citations are missing", () => {
      const result = validateCitations([99, 100], sourceNotes);
      expect(result.valid).toBe(false);
      expect(result.invalidCitations).toEqual([99, 100]);
    });

    it("returns valid=true for empty citations list", () => {
      const result = validateCitations([], sourceNotes);
      expect(result.valid).toBe(true);
      expect(result.invalidCitations).toEqual([]);
    });

    it("handles non-sequential citation numbers (e.g., 1, 5)", () => {
      const result = validateCitations([1, 5], sourceNotes);
      expect(result.valid).toBe(true);
      expect(result.invalidCitations).toEqual([]);
    });

    it("detects gap in citation numbers (2 exists but 3 doesn't)", () => {
      const result = validateCitations([2, 3], sourceNotes);
      expect(result.valid).toBe(false);
      expect(result.invalidCitations).toEqual([3]);
    });
  });
});