import { describe, it, expect, vi } from "vitest";
import {
  buildValidatedBrief,
  validateAndRepairBrief,
  type BriefPipelineOptions,
} from "./brief-pipeline";
import { extractCitations, validateCitations } from "./citation-validator";
import type { SourceNoteData } from "../source-notes/types";
import type { BriefInput } from "./brief-renderer";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSourceNotes(): SourceNoteData[] {
  return [
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
  ];
}

function makeBaseInput(overrides?: Partial<BriefInput>): BriefInput {
  const base: BriefInput = {
    question: "Best approach?",
    bottomLine: "Approach A is recommended.",
    confidence: "high",
    confidenceRationale: "Multiple sources confirm.",
    evidence: [
      {
        heading: "Documentation",
        content: "Approach A supports feature X [1].",
        citationRefs: [1],
      },
    ],
    interpretation: "Based on evidence, Approach A is best [1][2].",
    interpretationCitationRefs: [1, 2],
    sourceNotes: [
      { citationNumber: 1, source: "https://example.com/1", title: "Source One", snippets: ["Evidence"] },
      { citationNumber: 2, source: "https://example.com/2", title: "Source Two", snippets: ["Evidence"] },
    ],
    triggerType: "human",
    tradeoffs: ["Complexity"],
    caveats: ["May vary"],
    gaps: ["No benchmarks"],
  };
  return { ...base, ...overrides };
}

function makeOptions(overrides?: Partial<BriefPipelineOptions>): BriefPipelineOptions {
  const brainGenerate = vi.fn().mockRejectedValue(new Error("unexpected"));
  const trackBudget = vi.fn();
  const hasBudgetForRetry = vi.fn().mockReturnValue(false);
  const onFailedSynthesis = vi.fn();

  return {
    validateCitations,
    extractCitations,
    sourceNotes: makeSourceNotes(),
    brain: { generate: brainGenerate },
    trackBudget,
    hasBudgetForRetry,
    onFailedSynthesis,
    ...overrides,
  };
}

describe("buildValidatedBrief", () => {
  it("returns brief with rendered markdown when citations are valid", async () => {
    const input = makeBaseInput();
    const options = makeOptions();

    const result = await buildValidatedBrief(input, options);

    expect(result.brief).not.toBeNull();
    expect(result.brief!.markdown).toContain("Bottom Line");
    expect(result.brief!.markdown).toContain("Approach A is recommended.");
    expect(result.brief!.markdown).toContain("[1]");
    expect(result.failed).toBe(false);
    expect(result.previousBriefAvailable).toBe(false);
  });

  it("returns citations metadata in the brief", async () => {
    const input = makeBaseInput();
    const options = makeOptions();

    const result = await buildValidatedBrief(input, options);

    expect(result.brief).not.toBeNull();
    expect(result.brief!.citations).toContain(1);
    expect(result.brief!.citations).toContain(2);
    expect(result.brief!.sections).toContain("bottom-line");
    expect(result.brief!.sections).toContain("confidence");
    expect(result.brief!.sections).toContain("evidence");
  });

  it("preserves previousBriefAvailable on success", async () => {
    const result = await buildValidatedBrief(
      makeBaseInput(),
      makeOptions({ previousBriefAvailable: true }),
    );

    expect(result.failed).toBe(false);
    expect(result.previousBriefAvailable).toBe(true);
  });

  it("does not call brain or retry when citations are valid", async () => {
    const brainGenerate = vi.fn();
    const trackBudget = vi.fn();
    const hasBudgetForRetry = vi.fn();
    const options = makeOptions({ brain: { generate: brainGenerate }, trackBudget, hasBudgetForRetry });

    await buildValidatedBrief(makeBaseInput(), options);

    expect(brainGenerate).not.toHaveBeenCalled();
    expect(trackBudget).toHaveBeenCalledWith({ modelCalls: 0 });
    expect(hasBudgetForRetry).not.toHaveBeenCalled();
  });
});

describe("buildValidatedBrief (invalid citations)", () => {
  it("calls brain for repair when citations are invalid and budget allows", async () => {
    const input = makeBaseInput({
      evidence: [
        { heading: "Bad ref", content: "Claim from nowhere [99].", citationRefs: [99] },
      ],
      interpretation: "",
    });
    const brainGenerate = vi.fn().mockResolvedValue(
      JSON.stringify({
        bottomLine: "Approach A is recommended.",
        evidence: [{ heading: "Documentation", content: "Fixed claim [1].", citationRefs: [1] }],
        interpretation: "",
      }),
    );
    const hasBudgetForRetry = vi.fn().mockReturnValue(true);
    const trackBudget = vi.fn();
    const onFailedSynthesis = vi.fn();

    const options = makeOptions({
      sourceNotes: makeSourceNotes(),
      brain: { generate: brainGenerate },
      hasBudgetForRetry,
      trackBudget,
      onFailedSynthesis,
    });

    const result = await buildValidatedBrief(input, options);

    expect(brainGenerate).toHaveBeenCalled();
    expect(trackBudget).toHaveBeenCalledWith({ modelCalls: 1 });
    expect(result.brief).not.toBeNull();
    expect(result.failed).toBe(false);
  });

  it("fails synthesis when repair budget is exhausted", async () => {
    const input = makeBaseInput({
      evidence: [
        { heading: "Bad ref", content: "Claim from nowhere [99].", citationRefs: [99] },
      ],
      interpretation: "",
    });
    const brainGenerate = vi.fn().mockResolvedValue(
      JSON.stringify({
        bottomLine: "Approach A is recommended.",
        evidence: [{ heading: "Documentation", content: "Still invalid [99].", citationRefs: [99] }],
        interpretation: "",
      }),
    );
    const hasBudgetForRetry = vi.fn().mockReturnValue(false);
    const trackBudget = vi.fn();
    const onFailedSynthesis = vi.fn();

    const options = makeOptions({
      sourceNotes: makeSourceNotes(),
      brain: { generate: brainGenerate },
      hasBudgetForRetry,
      trackBudget,
      onFailedSynthesis,
    });

    const result = await buildValidatedBrief(input, options);

    expect(result.brief).toBeNull();
    expect(result.failed).toBe(true);
    expect(result.previousBriefAvailable).toBe(false);
    expect(onFailedSynthesis).toHaveBeenCalled();
  });

  it("sets previousBriefAvailable=true when prior brief exists", async () => {
    const input = makeBaseInput({
      evidence: [
        { heading: "Bad ref", content: "Claim from nowhere [99].", citationRefs: [99] },
      ],
      interpretation: "",
    });
    const hasBudgetForRetry = vi.fn().mockReturnValue(false);
    const onFailedSynthesis = vi.fn();

    const options = makeOptions({
      sourceNotes: makeSourceNotes(),
      hasBudgetForRetry,
      onFailedSynthesis,
      previousBriefAvailable: true,
    });

    const result = await buildValidatedBrief(input, options);

    expect(result.failed).toBe(true);
    expect(result.brief).toBeNull();
    expect(result.previousBriefAvailable).toBe(true);
  });
});

describe("buildValidatedBrief (empty citation refs)", () => {
  it("accepts brief with no citation refs", async () => {
    const input = makeBaseInput({
      evidence: [],
      interpretation: "",
      sourceNotes: [],
    });
    const options = makeOptions({ sourceNotes: [] });

    const result = await buildValidatedBrief(input, options);

    expect(result.brief).not.toBeNull();
    expect(result.failed).toBe(false);
    expect(result.brief!.citations).toEqual([]);
  });
});

describe("buildValidatedBrief (brain repair succeeds)", () => {
  it("uses repaired draft from brain when initial citations invalid", async () => {
    const input = makeBaseInput({
      evidence: [
        { heading: "Bad ref", content: "Claim from nowhere [99].", citationRefs: [99] },
      ],
      interpretation: "",
    });
    const brainGenerate = vi.fn().mockResolvedValue(
      JSON.stringify({
        bottomLine: "Approach A is recommended.",
        evidence: [{ heading: "Documentation", content: "Fixed claim with valid citation [1].", citationRefs: [1] }],
        interpretation: "",
      }),
    );
    const hasBudgetForRetry = vi.fn().mockReturnValue(true);
    const trackBudget = vi.fn();

    const options = makeOptions({
      sourceNotes: makeSourceNotes(),
      brain: { generate: brainGenerate },
      hasBudgetForRetry,
      trackBudget,
    });

    const result = await buildValidatedBrief(input, options);

    expect(result.brief).not.toBeNull();
    expect(result.brief!.markdown).toContain("Fixed claim with valid citation");
    expect(result.brief!.citations).toContain(1);
    expect(result.failed).toBe(false);
    expect(trackBudget).toHaveBeenCalledWith({ modelCalls: 1 });
  });

  it("exhausts retry attempts after repeated invalid repairs", async () => {
    const input = makeBaseInput({
      evidence: [
        { heading: "Bad ref", content: "Claim from nowhere [99].", citationRefs: [99] },
      ],
      interpretation: "",
    });
    const brainGenerate = vi.fn().mockResolvedValue(
      JSON.stringify({
        bottomLine: "Approach A is recommended.",
        evidence: [{ heading: "Bad ref", content: "Still invalid [99].", citationRefs: [99] }],
        interpretation: "",
      }),
    );
    const hasBudgetForRetry = vi.fn();
    hasBudgetForRetry.mockReturnValueOnce(true);
    hasBudgetForRetry.mockReturnValueOnce(false);
    const trackBudget = vi.fn();
    const onFailedSynthesis = vi.fn();

    const options = makeOptions({
      sourceNotes: makeSourceNotes(),
      brain: { generate: brainGenerate },
      hasBudgetForRetry,
      trackBudget,
      onFailedSynthesis,
    });

    const result = await buildValidatedBrief(input, options);

    expect(result.brief).toBeNull();
    expect(result.failed).toBe(true);
    expect(brainGenerate).toHaveBeenCalledTimes(1);
    expect(trackBudget).toHaveBeenCalledWith({ modelCalls: 1 });
  });
});

describe("validateAndRepairBrief", () => {
  it("normalizes a valid draft to include required sections and source list", async () => {
    const draft = [
      "# Research Brief",
      "",
      "## Bottom Line",
      "Approach A is recommended [1].",
      "",
      "## Confidence",
      "**Level**: high",
      "",
      "**Rationale**: Multiple sources confirm the recommendation.",
      "",
      "## Evidence: Documentation",
      "Approach A is documented as the preferred option [1].",
      "",
      "## Interpretation",
      "The sources point toward Approach A as the safest default [1].",
      "",
    ].join("\n");

    const result = await validateAndRepairBrief(
      draft,
      makeSourceNotes(),
      { generate: vi.fn() },
      vi.fn().mockReturnValue(false),
      vi.fn(),
      undefined,
      false,
      "Best approach?",
      "human",
    );

    expect(result).not.toBeNull();
    expect(result!).toContain("## Tradeoffs");
    expect(result!).toContain("## Caveats");
    expect(result!).toContain("## Gaps");
    expect(result!).toContain("## Sources");
    expect(result!).toContain("[1] Source One — https://example.com/1");
  });

  it("accepts variant section headers via heading aliases", async () => {
    const draft = [
      "# Research Brief",
      "",
      "## Key Finding",
      "Approach A is recommended [1].",
      "",
      "## Confidence",
      "**Level**: high",
      "",
      "**Rationale**: Multiple sources confirm the recommendation.",
      "",
      "## Evidence: Documentation",
      "Approach A is documented as the preferred option [1].",
      "",
      "## Analysis",
      "The sources point toward Approach A as the safest default [1].",
      "",
    ].join("\n");

    const result = await validateAndRepairBrief(
      draft,
      makeSourceNotes(),
      { generate: vi.fn() },
      vi.fn().mockReturnValue(false),
      vi.fn(),
      undefined,
      false,
      "Best approach?",
      "human",
    );

    // "Key Finding" should be normalized to "Bottom Line", "Analysis" to "Interpretation"
    expect(result).not.toBeNull();
    expect(result!).toContain("## Bottom Line");
    expect(result!).toContain("## Interpretation");
    // The content should be preserved, not replaced with boilerplate
    expect(result!).toContain("Approach A is recommended");
    expect(result!).toContain("safest default");
  });

  it("removes task implications for human-triggered drafts", async () => {
    const draft = [
      "# Research Brief",
      "",
      "## Bottom Line",
      "Approach A is recommended [1].",
      "",
      "## Confidence",
      "**Level**: high",
      "",
      "**Rationale**: Multiple sources confirm the recommendation.",
      "",
      "## Evidence: Documentation",
      "Approach A is documented as the preferred option [1].",
      "",
      "## Interpretation",
      "The sources point toward Approach A as the safest default [1].",
      "",
      "## Implications for Current Task",
      "Use Approach A in Pi immediately [1].",
      "",
    ].join("\n");

    const result = await validateAndRepairBrief(
      draft,
      makeSourceNotes(),
      { generate: vi.fn() },
      vi.fn().mockReturnValue(false),
      vi.fn(),
      undefined,
      false,
      "Best approach?",
      "human",
    );

    expect(result).not.toBeNull();
    expect(result!).not.toContain("Implications for Current Task");
  });

  it("rejects unsupported factual drafts when source notes exist but no citations are present", async () => {
    const draft = [
      "# Research Brief",
      "",
      "## Bottom Line",
      "Approach A is recommended.",
      "",
      "## Confidence",
      "**Level**: high",
      "",
      "**Rationale**: Multiple sources confirm the recommendation.",
      "",
      "## Evidence: Documentation",
      "Approach A is documented as the preferred option.",
      "",
      "## Interpretation",
      "The sources point toward Approach A as the safest default.",
      "",
    ].join("\n");

    const onFailedSynthesis = vi.fn();
    const result = await validateAndRepairBrief(
      draft,
      makeSourceNotes(),
      { generate: vi.fn() },
      vi.fn().mockReturnValue(false),
      vi.fn(),
      onFailedSynthesis,
      false,
      "Best approach?",
      "human",
    );

    expect(result).toBeNull();
    expect(onFailedSynthesis).toHaveBeenCalled();
  });
});
