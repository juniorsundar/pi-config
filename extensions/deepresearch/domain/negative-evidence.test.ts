import { describe, it, expect } from "vitest";
import {
  NegativeEvidence,
  buildCoverageSnapshot,
  coverageToPromptSection,
  justifiesEarlyStop,
} from "./negative-evidence";
import { EvidenceMix } from "./evidence-mix";
import type { DropRecord } from "./candidate-filter";

describe("NegativeEvidence", () => {
  // ── Tracer Bullet: basic recording ────────────────────────────────────

  it("starts with no entries", () => {
    const ne = new NegativeEvidence();
    expect(ne.count).toBe(0);
    expect(ne.hasAny).toBe(false);
    expect(ne.entries).toHaveLength(0);
  });

  it("records a failed search", () => {
    const ne = new NegativeEvidence();
    ne.recordFailedSearch("rust performance");
    expect(ne.count).toBe(1);
    expect(ne.entries[0].type).toBe("failed_search");
    expect(ne.entries[0].detail).toContain('"rust performance"');
  });

  it("records a missing category", () => {
    const ne = new NegativeEvidence();
    ne.recordMissingCategory("benchmarks", "No benchmarks found for this topic.");
    expect(ne.count).toBe(1);
    expect(ne.entries[0].type).toBe("missing_category");
    expect(ne.entries[0].category).toBe("benchmarks");
    expect(ne.entries[0].detail).toContain("benchmarks");
  });

  it("records a contradiction", () => {
    const ne = new NegativeEvidence();
    ne.recordContradiction("Source A says X, Source B says not X.");
    expect(ne.entries[0].type).toBe("contradiction");
    expect(ne.entries[0].detail).toContain("Source A");
  });

  it("records a dropped source from a DropRecord", () => {
    const ne = new NegativeEvidence();
    const drop: DropRecord = {
      url: "https://forum.example.com/topic",
      title: "Forum Discussion",
      reason: "Low-signal source: forum",
    };
    ne.recordDroppedSource(drop);
    expect(ne.entries[0].type).toBe("dropped_source");
    expect(ne.entries[0].url).toBe("https://forum.example.com/topic");
    expect(ne.entries[0].detail).toContain("Forum Discussion");
  });

  it("records an excluded category", () => {
    const ne = new NegativeEvidence();
    ne.recordExcludedCategory("case studies");
    expect(ne.entries[0].type).toBe("excluded_category");
    expect(ne.entries[0].category).toBe("case studies");
  });

  it("records a fetch failure", () => {
    const ne = new NegativeEvidence();
    ne.recordFetchFailed("https://example.com", "Connection refused");
    expect(ne.entries[0].type).toBe("fetch_failed");
    expect(ne.entries[0].url).toBe("https://example.com");
    expect(ne.entries[0].detail).toContain("Connection refused");
  });

  // ── Multiple entries ──────────────────────────────────────────────────

  it("records multiple entries of different types", () => {
    const ne = new NegativeEvidence();
    ne.recordFailedSearch("benchmarks");
    ne.recordExcludedCategory("case studies");
    ne.recordContradiction("Sources disagree about version.");
    expect(ne.count).toBe(3);
  });

  it("hasAny returns true after recording", () => {
    const ne = new NegativeEvidence();
    expect(ne.hasAny).toBe(false);
    ne.recordFailedSearch("test");
    expect(ne.hasAny).toBe(true);
  });

  // ── Filtering by type ─────────────────────────────────────────────────

  it("byType filters correctly", () => {
    const ne = new NegativeEvidence();
    ne.recordFailedSearch("query1");
    ne.recordFailedSearch("query2");
    ne.recordContradiction("Conflict");
    ne.recordExcludedCategory("tutorials");

    expect(ne.byType("failed_search")).toHaveLength(2);
    expect(ne.byType("contradiction")).toHaveLength(1);
    expect(ne.byType("excluded_category")).toHaveLength(1);
    expect(ne.byType("dropped_source")).toHaveLength(0);
  });

  // ── toPromptSection ───────────────────────────────────────────────────

  it("toPromptSection says no negative evidence when empty", () => {
    const ne = new NegativeEvidence();
    const section = ne.toPromptSection();
    expect(section).toContain("No negative evidence recorded");
  });

  it("toPromptSection lists all entries when present", () => {
    const ne = new NegativeEvidence();
    ne.recordFailedSearch("test query");
    ne.recordContradiction("Sources conflict.");
    const section = ne.toPromptSection();
    expect(section).toContain("## Negative Evidence");
    expect(section).toContain("[failed_search]");
    expect(section).toContain("[contradiction]");
  });
});

// ── Coverage aggregation ──────────────────────────────────────────────────

describe("Coverage aggregation", () => {
  describe("buildCoverageSnapshot", () => {
    it("builds snapshot from EvidenceMix and NegativeEvidence", () => {
      const mix = new EvidenceMix(["docs", "benchmarks"]);
      mix.update("docs", "found");
      const ne = new NegativeEvidence();
      ne.recordFailedSearch("benchmarks");

      const snap = buildCoverageSnapshot(mix, ne);
      expect(snap.evidenceMix.found).toBe(1);
      expect(snap.evidenceMix.notSearched).toBe(1);
      expect(snap.negativeEvidenceCount).toBe(1);
      expect(snap.hasNegativeEvidence).toBe(true);
    });

    it("hasNegativeEvidence is false when no negative evidence", () => {
      const mix = new EvidenceMix(["docs"]);
      const ne = new NegativeEvidence();
      const snap = buildCoverageSnapshot(mix, ne);
      expect(snap.hasNegativeEvidence).toBe(false);
      expect(snap.negativeEvidenceCount).toBe(0);
    });
  });

  describe("coverageToPromptSection", () => {
    it("includes Evidence Mix and Negative Evidence sections", () => {
      const mix = new EvidenceMix(["docs"]);
      mix.update("docs", "found");
      const ne = new NegativeEvidence();
      ne.recordFailedSearch("benchmarks");

      const section = coverageToPromptSection(mix, ne);
      expect(section).toContain("## Evidence Coverage");
      expect(section).toContain("## Negative Evidence");
    });

    it("omits Negative Evidence section when none recorded", () => {
      const mix = new EvidenceMix(["docs"]);
      const ne = new NegativeEvidence();
      const section = coverageToPromptSection(mix, ne);
      expect(section).toContain("## Evidence Coverage");
      expect(section).not.toContain("## Negative Evidence");
    });
  });

  describe("justifiesEarlyStop", () => {
    it("returns true when minimum source notes met", () => {
      const mix = new EvidenceMix(["docs", "benchmarks"]);
      const ne = new NegativeEvidence();
      expect(justifiesEarlyStop(mix, ne, 3, 5)).toBe(true);
    });

    it("returns true when all categories found and some found > 0", () => {
      const mix = new EvidenceMix(["docs", "benchmarks"]);
      mix.update("docs", "found");
      mix.update("benchmarks", "weak");
      const ne = new NegativeEvidence();
      expect(justifiesEarlyStop(mix, ne, 10, 0)).toBe(true);
    });

    it("returns true when all searched and negative evidence present", () => {
      const mix = new EvidenceMix(["docs", "benchmarks"]);
      mix.update("docs", "missing");
      mix.update("benchmarks", "missing");
      const ne = new NegativeEvidence();
      ne.recordFailedSearch("docs");
      expect(justifiesEarlyStop(mix, ne, 5, 0)).toBe(true);
    });

    it("returns false when not enough notes and no other justification", () => {
      const mix = new EvidenceMix(["docs", "benchmarks"]);
      // both still not-searched
      const ne = new NegativeEvidence();
      expect(justifiesEarlyStop(mix, ne, 3, 0)).toBe(false);
    });
  });
});