import { describe, it, expect } from "vitest";
import { EvidenceMix } from "./evidence-mix";

describe("EvidenceMix", () => {
  // ── Tracer Bullet Test ────────────────────────────────────────────────

  it("creates an EvidenceMix with all categories as not-searched", () => {
    const mix = new EvidenceMix(["docs", "benchmarks", "source code"]);
    const cats = mix.categories;

    expect(cats).toHaveLength(3);
    expect(cats.map((c) => c.category)).toEqual([
      "docs",
      "benchmarks",
      "source code",
    ]);
    for (const cat of cats) {
      expect(cat.status).toBe("not-searched");
    }
  });

  it("returns intendedCategories read-only list", () => {
    const mix = new EvidenceMix(["api docs", "tutorials"]);
    expect(mix.intendedCategories).toEqual(["api docs", "tutorials"]);
  });

  // ── Status transitions ─────────────────────────────────────────────────

  it("updates a category status after creation", () => {
    const mix = new EvidenceMix(["docs"]);
    mix.update("docs", "found");
    expect(mix.categories[0].status).toBe("found");
  });

  it("transitions through all statuses: not-searched → found → weak", () => {
    const mix = new EvidenceMix(["benchmarks"]);
    mix.update("benchmarks", "found");
    expect(mix.categories[0].status).toBe("found");
    mix.update("benchmarks", "weak");
    expect(mix.categories[0].status).toBe("weak");
  });

  it("marks a category as excluded", () => {
    const mix = new EvidenceMix(["docs", "benchmarks"]);
    mix.update("docs", "excluded");
    const cats = mix.categories;
    expect(cats.find((c) => c.category === "docs")!.status).toBe("excluded");
  });

  it("records an optional note on status update", () => {
    const mix = new EvidenceMix(["docs"]);
    mix.update("docs", "missing", "No relevant documentation found.");
    expect(mix.categories[0].note).toBe("No relevant documentation found.");
  });

  it("throws on unknown category", () => {
    const mix = new EvidenceMix(["docs"]);
    expect(() => mix.update("nonexistent", "found")).toThrow(
      'Unknown evidence category "nonexistent"',
    );
  });

  it("throws on empty string category update", () => {
    const mix = new EvidenceMix(["docs"]);
    expect(() => mix.update("", "found")).toThrow(
      'Unknown evidence category ""',
    );
  });

  // ── markCategorySearched (explicit variant) ──────────────────────────

  it("markCategorySearched explicitly marks a category as found", () => {
    const mix = new EvidenceMix(["docs", "benchmarks"]);
    mix.markCategorySearched("docs", true);
    expect(
      mix.categories.find((c) => c.category === "docs")!.status,
    ).toBe("found");
  });

  it("markCategorySearched explicitly marks a category as missing", () => {
    const mix = new EvidenceMix(["docs"]);
    mix.markCategorySearched("docs", false);
    expect(
      mix.categories.find((c) => c.category === "docs")!.status,
    ).toBe("missing");
  });

  it("markCategorySearched throws on unknown category", () => {
    const mix = new EvidenceMix(["docs"]);
    expect(() => mix.markCategorySearched("nonexistent", true)).toThrow(
      'Unknown evidence category "nonexistent"',
    );
  });

  it("markCategorySearched does not change already-set status", () => {
    const mix = new EvidenceMix(["docs"]);
    mix.update("docs", "found");
    mix.markCategorySearched("docs", false);
    // stays found, not overridden to missing
    expect(
      mix.categories.find((c) => c.category === "docs")!.status,
    ).toBe("found");
  });

  // ── markSearched ───────────────────────────────────────────────────────

  it("marks matching category as found when search results exist", () => {
    const mix = new EvidenceMix(["api documentation", "benchmark results"]);
    mix.markSearched("api documentation best practices", true);
    const api = mix.categories.find((c) => c.category === "api documentation");
    expect(api!.status).toBe("found");
  });

  it("marks matching category as missing when no search results", () => {
    const mix = new EvidenceMix(["api documentation", "benchmarks"]);
    mix.markSearched("api documentation best practices", false);
    const api = mix.categories.find((c) => c.category === "api documentation");
    expect(api!.status).toBe("missing");
    expect(api!.note).toContain("returned no results");
  });

  it("does not change already-set statuses", () => {
    const mix = new EvidenceMix(["docs", "benchmarks"]);
    mix.update("docs", "excluded");
    mix.markSearched("documentation guide", true);
    // docs stays excluded
    expect(
      mix.categories.find((c) => c.category === "docs")!.status,
    ).toBe("excluded");
  });

  it("does not match categories with very short words", () => {
    const mix = new EvidenceMix(["go"]);
    mix.markSearched("golang programming guide", true);
    // "go" is <= 2 chars, so no match
    expect(mix.categories[0].status).toBe("not-searched");
  });

  // ── Snapshot ───────────────────────────────────────────────────────────

  it("snapshot counts categories by status", () => {
    const mix = new EvidenceMix([
      "docs",
      "benchmarks",
      "tutorials",
      "source code",
      "case studies",
    ]);
    mix.update("docs", "found");
    mix.update("benchmarks", "found");
    mix.update("source code", "missing");
    mix.update("case studies", "excluded");

    const snap = mix.snapshot();
    expect(snap.found).toBe(2);
    expect(snap.weak).toBe(0);
    expect(snap.missing).toBe(1);
    expect(snap.excluded).toBe(1);
    expect(snap.notSearched).toBe(1);
  });

  it("snapshot overall is 'strong' when >= 75% found and none missing", () => {
    const mix = new EvidenceMix(["docs", "benchmarks", "tutorials", "source code"]);
    mix.update("docs", "found");
    mix.update("benchmarks", "found");
    mix.update("tutorials", "found");
    mix.update("source code", "weak");
    expect(mix.snapshot().overall).toBe("strong");
  });

  it("snapshot overall is 'partial' when some found/weak but < 75%", () => {
    const mix = new EvidenceMix(["docs", "benchmarks", "tutorials"]);
    mix.update("docs", "found");
    // only 1/3 = 33% found
    expect(mix.snapshot().overall).toBe("partial");
  });

  it("snapshot overall is 'weak' when nothing found", () => {
    const mix = new EvidenceMix(["docs", "benchmarks"]);
    mix.update("docs", "missing");
    mix.update("benchmarks", "excluded");
    expect(mix.snapshot().overall).toBe("weak");
  });

  it("snapshot overall is 'weak' when empty category list", () => {
    const mix = new EvidenceMix([]);
    const snap = mix.snapshot();
    expect(snap.found).toBe(0);
    expect(snap.overall).toBe("weak"); // 0 >= 0.75*0 is true, but found is 0
  });

  // ── toPromptSection ────────────────────────────────────────────────────

  it("toPromptSection renders all categories with status", () => {
    const mix = new EvidenceMix(["docs", "benchmarks"]);
    mix.update("docs", "found");
    const section = mix.toPromptSection();
    expect(section).toContain("## Evidence Coverage");
    expect(section).toContain("docs: **found**");
    expect(section).toContain("benchmarks: **not-searched**");
    expect(section).toContain("Overall");
  });

  it("toPromptSection includes suggested search queries for not-searched categories", () => {
    const mix = new EvidenceMix(["API documentation", "Community comparison articles"]);
    const section = mix.toPromptSection();
    expect(section).toContain("API documentation: **not-searched**");
    expect(section).toContain("Consider searching for");
    expect(section).toContain("Consider searching for: community comparison articles");
  });

  it("toPromptSection includes notes when present", () => {
    const mix = new EvidenceMix(["docs"]);
    mix.update("docs", "missing", "Could not find any relevant docs.");
    const section = mix.toPromptSection();
    expect(section).toContain("Could not find any relevant docs.");
  });

  // ── Empty constructor ──────────────────────────────────────────────────

  it("handles empty category list", () => {
    const mix = new EvidenceMix([]);
    expect(mix.categories).toHaveLength(0);
    expect(mix.intendedCategories).toHaveLength(0);
    const snap = mix.snapshot();
    expect(snap.found).toBe(0);
    expect(snap.missing).toBe(0);
  });

  // ── Budget-exhausted marking ───────────────────────────────────────

  it("markNotSearchedDueToBudget adds notes to not-searched categories only", () => {
    const mix = new EvidenceMix(["docs", "benchmarks", "tutorials"]);
    mix.update("docs", "found");
    // tutorials and benchmarks remain "not-searched"
    mix.markNotSearchedDueToBudget();

    // Already-searched categories are unchanged
    const docs = mix.categories.find((c) => c.category === "docs")!;
    expect(docs.status).toBe("found");
    expect(docs.note).toBeUndefined();

    // Not-searched categories get budget notes
    const bench = mix.categories.find((c) => c.category === "benchmarks")!;
    expect(bench.status).toBe("not-searched");
    expect(bench.note).toContain("budget exhausted");

    const tut = mix.categories.find((c) => c.category === "tutorials")!;
    expect(tut.status).toBe("not-searched");
    expect(tut.note).toContain("budget exhausted");
  });

  it("markNotSearchedDueToBudget does nothing when all categories are searched", () => {
    const mix = new EvidenceMix(["docs"]);
    mix.update("docs", "found");
    mix.markNotSearchedDueToBudget();
    expect(mix.categories[0].note).toBeUndefined();
  });
});