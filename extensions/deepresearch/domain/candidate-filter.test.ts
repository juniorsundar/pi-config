import { describe, it, expect } from "vitest";
import { CandidateFilter, type RawCandidate } from "./candidate-filter";

function result(overrides: Partial<RawCandidate> & { url: string }): RawCandidate {
  return {
    title: overrides.title ?? "Test Result",
    snippet: overrides.snippet ?? "A test snippet about the topic.",
    ...overrides,
  };
}

describe("CandidateFilter", () => {
  // ── Tracer Bullet: Dedup ──────────────────────────────────────────────

  it("deduplicates identical URLs", () => {
    const filter = new CandidateFilter("test");
    const raw: RawCandidate[] = [
      result({ url: "https://example.com/page", title: "First" }),
      result({ url: "https://example.com/page", title: "Duplicate" }),
    ];
    const result1 = filter.filter(raw);
    expect(result1.candidates).toHaveLength(1);
    expect(result1.drops).toHaveLength(1);
    expect(result1.drops[0].reason).toContain("Duplicate");
  });

  it("deduplicates URLs with trailing slash variation", () => {
    const filter = new CandidateFilter("test");
    const raw: RawCandidate[] = [
      result({ url: "https://example.com/page", title: "First" }),
      result({ url: "https://example.com/page/", title: "Duplicate" }),
    ];
    const result1 = filter.filter(raw);
    expect(result1.candidates).toHaveLength(1);
    expect(result1.drops).toHaveLength(1);
  });

  it("deduplicates URLs with fragment variation", () => {
    const filter = new CandidateFilter("test");
    const raw: RawCandidate[] = [
      result({ url: "https://example.com/page", title: "First" }),
      result({ url: "https://example.com/page#section", title: "Duplicate" }),
    ];
    const result1 = filter.filter(raw);
    expect(result1.candidates).toHaveLength(1);
    expect(result1.drops).toHaveLength(1);
  });

  it("deduplicates URLs with www prefix variation", () => {
    const filter = new CandidateFilter("test");
    const raw: RawCandidate[] = [
      result({ url: "https://example.com/page", title: "First" }),
      result({ url: "https://www.example.com/page", title: "Duplicate" }),
    ];
    const result1 = filter.filter(raw);
    expect(result1.candidates).toHaveLength(1);
  });

  it("keeps distinct URLs as separate candidates", () => {
    const filter = new CandidateFilter("test");
    const raw: RawCandidate[] = [
      result({ url: "https://example.com/page1" }),
      result({ url: "https://example.com/page2" }),
      result({ url: "https://other.org/doc" }),
    ];
    const result1 = filter.filter(raw);
    expect(result1.candidates).toHaveLength(3);
    expect(result1.drops).toHaveLength(0);
  });

  it("deduplicates across multiple filter calls", () => {
    const filter = new CandidateFilter("test");
    const batch1 = [result({ url: "https://example.com/page" })];
    const batch2 = [result({ url: "https://example.com/page" })];

    filter.filter(batch1);
    const result2 = filter.filter(batch2);
    expect(result2.candidates).toHaveLength(0);
    expect(result2.drops).toHaveLength(1);
  });

  // ── Annotation: isPrimary ─────────────────────────────────────────────

  it("annotates github.com as primary", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://github.com/org/repo" })];
    const out = filter.filter(raw);
    expect(out.candidates[0].isPrimary).toBe(true);
  });

  it("annotates docs.example.com as primary", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://docs.example.com/api" })];
    const out = filter.filter(raw);
    expect(out.candidates[0].isPrimary).toBe(true);
  });

  it("annotates URLs with 'official' in title as primary", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://example.com", title: "Official Documentation" })];
    const out = filter.filter(raw);
    expect(out.candidates[0].isPrimary).toBe(true);
  });

  it("does not annotate random blog as primary", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://randomblog.com/post" })];
    const out = filter.filter(raw);
    expect(out.candidates[0].isPrimary).toBe(false);
  });

  // ── Ranking ───────────────────────────────────────────────────────────

  it("ranks primary sources above non-primary", () => {
    const filter = new CandidateFilter("programming guide");
    const raw = [
      result({ url: "https://randomblog.com/post", title: "A Guide" }),
      result({ url: "https://docs.example.com/guide", title: "Official Guide" }),
    ];
    const out = filter.filter(raw);
    expect(out.candidates[0].url).toBe("https://docs.example.com/guide");
    expect(out.candidates[0].signalScore).toBeGreaterThan(
      out.candidates[1].signalScore,
    );
  });

  it("gives score boost for title matching query terms", () => {
    const filter = new CandidateFilter("Rust performance benchmarks");
    const raw = [
      result({
        url: "https://example.com/unrelated",
        title: "Unrelated Article",
      }),
      result({
        url: "https://example.com/benchmarks",
        title: "Rust Performance Benchmarks Results",
      }),
    ];
    const out = filter.filter(raw);
    // Second should have higher score due to title match
    const benchResult = out.candidates.find(
      (c) => c.url === "https://example.com/benchmarks",
    );
    expect(benchResult!.signalScore).toBeGreaterThan(
      out.candidates.find((c) => c.url === "https://example.com/unrelated")!
        .signalScore,
    );
  });

  it("gives score boost for rich snippets (200+ chars)", () => {
    const filter = new CandidateFilter("test");
    const raw = [
      result({
        url: "https://example.com/rich",
        snippet: "a".repeat(250),
      }),
      result({
        url: "https://example.com/thin",
        snippet: "short snippet",
      }),
    ];
    const out = filter.filter(raw);
    const rich = out.candidates.find((c) => c.url === "https://example.com/rich");
    const thin = out.candidates.find((c) => c.url === "https://example.com/thin");
    expect(rich!.signalScore).toBeGreaterThan(thin!.signalScore);
  });

  it("sorts candidates by signal score descending", () => {
    const filter = new CandidateFilter("test");
    const raw = [
      result({ url: "https://example.com/low", title: "Low Signal" }),
      result({
        url: "https://docs.example.com/high",
        title: "High Signal Official Docs",
      }),
      result({
        url: "https://example.com/medium",
        title: "Medium Signal",
        snippet: "a".repeat(250),
      }),
    ];
    const out = filter.filter(raw);
    for (let i = 1; i < out.candidates.length; i++) {
      expect(out.candidates[i - 1].signalScore).toBeGreaterThanOrEqual(
        out.candidates[i].signalScore,
      );
    }
  });

  // ── Downranking / dropping low-signal ─────────────────────────────────

  it("drops forum sources that are not primary", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://forum.example.com/topic" })];
    const out = filter.filter(raw);
    expect(out.candidates).toHaveLength(0);
    expect(out.drops).toHaveLength(1);
    expect(out.drops[0].reason).toContain("Low-signal");
  });

  it("drops reddit sources", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://reddit.com/r/test" })];
    const out = filter.filter(raw);
    expect(out.candidates).toHaveLength(0);
  });

  it("drops stackoverflow sources", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://stackoverflow.com/q/123" })];
    const out = filter.filter(raw);
    expect(out.candidates).toHaveLength(0);
  });

  it("keeps low-signal sources if they are primary", () => {
    const filter = new CandidateFilter("test");
    // github.com is primary despite being a blog-like platform
    const raw = [result({ url: "https://github.com/org/repo", title: "Official Repo" })];
    const out = filter.filter(raw);
    expect(out.candidates).toHaveLength(1);
    expect(out.drops).toHaveLength(0);
  });

  // ── hasCandidates ─────────────────────────────────────────────────────

  it("hasCandidates is true when candidates remain", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://example.com/page" })];
    const out = filter.filter(raw);
    expect(out.hasCandidates).toBe(true);
  });

  it("hasCandidates is false when all dropped", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://forum.example.com/topic" })];
    const out = filter.filter(raw);
    expect(out.hasCandidates).toBe(false);
  });

  // ── Empty input ───────────────────────────────────────────────────────

  it("handles empty result list", () => {
    const filter = new CandidateFilter("test");
    const out = filter.filter([]);
    expect(out.candidates).toHaveLength(0);
    expect(out.drops).toHaveLength(0);
    expect(out.hasCandidates).toBe(false);
  });

  // ── Drop record shape ─────────────────────────────────────────────────

  it("records drops with URL, title, and reason", () => {
    const filter = new CandidateFilter("test");
    const raw = [result({ url: "https://forum.example.com/topic", title: "Forum Topic" })];
    const out = filter.filter(raw);
    expect(out.drops[0].url).toBe("https://forum.example.com/topic");
    expect(out.drops[0].title).toBe("Forum Topic");
    expect(out.drops[0].reason.length).toBeGreaterThan(0);
  });

  // ── queryType (Brain self-classification) ────────────────────────────

  it("accepts comparison queryType from Brain keeps low-signal comparison sources", () => {
    // A query that doesn't match the regex should still be treated as comparison
    // when the Brain provides queryType="comparison"
    const filter = new CandidateFilter("non-comparison query", "comparison");
    const raw = [result({
      url: "https://forum.example.com/topic",
      title: "Forum Discussion",
      snippet: "Some discussion content",
    })];
    const out = filter.filter(raw);
    // Low-signal forum source should be kept (not dropped) because queryType=comparison
    expect(out.candidates).toHaveLength(1);
    expect(out.drops).toHaveLength(0);
  });

  it("accepts general queryType from Brain drops low-signal sources", () => {
    // A query that would match the regex should NOT be treated as comparison
    // when the Brain provides queryType="general"
    const filter = new CandidateFilter("X vs Y comparison", "general");
    const raw = [result({
      url: "https://forum.example.com/topic",
      title: "Forum Topic",
      snippet: "Forum discussion about X vs Y",
    })];
    const out = filter.filter(raw);
    // Low-signal forum source should be dropped because queryType=general
    expect(out.candidates).toHaveLength(0);
    expect(out.drops).toHaveLength(1);
  });

  it("falls back to regex heuristic when queryType is not provided", () => {
    // Without queryType, the regex should detect "vs" as comparison
    const filter = new CandidateFilter("X vs Y");
    const raw = [result({
      url: "https://forum.example.com/topic",
      title: "Forum Topic",
      snippet: "Comparing X and Y",
    })];
    const out = filter.filter(raw);
    // Low-signal forum source should be kept (regex detects comparison)
    expect(out.candidates).toHaveLength(1);
    expect(out.drops).toHaveLength(0);
  });

  it("falls back to regex when queryType is undefined", () => {
    // Explicit undefined queryType should fall back to regex
    const filter = new CandidateFilter("X vs Y", undefined);
    const raw = [result({
      url: "https://forum.example.com/topic",
      title: "Forum Topic",
      snippet: "Comparing X and Y",
    })];
    const out = filter.filter(raw);
    expect(out.candidates).toHaveLength(1);
    expect(out.drops).toHaveLength(0);
  });
});