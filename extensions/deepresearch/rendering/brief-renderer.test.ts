import { describe, it, expect } from "vitest";
import { renderBrief, type BriefInput } from "./brief-renderer";

describe("Research Brief renderer (tracer bullet)", () => {
  it("renderBrief includes bottom line and confidence in output", () => {
    const input: BriefInput = {
      question: "What is the best approach?",
      bottomLine: "Approach A is recommended for performance.",
      confidence: "high",
      confidenceRationale: "Three independent sources confirm similar benchmarks.",
      evidence: [],
      interpretation: "",
      sourceNotes: [],
      triggerType: "human",
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("Bottom Line");
    expect(result.markdown).toContain("Approach A is recommended for performance.");
    expect(result.markdown).toContain("Confidence");
    expect(result.markdown).toContain("high");
    expect(result.markdown).toContain("Three independent sources confirm similar benchmarks.");
  });

  it("renderBrief includes the research question", () => {
    const input: BriefInput = {
      question: "What is the best approach?",
      bottomLine: "Approach A is recommended.",
      confidence: "medium",
      confidenceRationale: "Mixed evidence.",
      evidence: [],
      interpretation: "",
      sourceNotes: [],
      triggerType: "human",
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("What is the best approach?");
  });

  it("renderBrief returns section names and citations", () => {
    const input: BriefInput = {
      question: "Test question",
      bottomLine: "Bottom line here.",
      confidence: "low",
      confidenceRationale: "Weak evidence.",
      evidence: [],
      interpretation: "",
      sourceNotes: [],
      triggerType: "human",
    };

    const result = renderBrief(input);

    expect(result.sections).toContain("bottom-line");
    expect(result.sections).toContain("confidence");
    expect(result.citations).toEqual([]);
  });
});

describe("Research Brief renderer (required sections)", () => {
  const baseInput: BriefInput = {
    question: "Best approach for auth?",
    bottomLine: "OAuth 2.0 is recommended.",
    confidence: "high",
    confidenceRationale: "Multiple sources confirm.",
    evidence: [],
    interpretation: "",
    sourceNotes: [],
    triggerType: "human",
  };

  it("includes evidence sections with citation refs", () => {
    const input: BriefInput = {
      ...baseInput,
      evidence: [
        {
          heading: "Documentation",
          content: "OAuth 2.0 is widely adopted.",
          citationRefs: [1],
        },
        {
          heading: "Benchmarks",
          content: "OAuth 2.0 shows 99.9% uptime.",
          citationRefs: [2],
        },
      ],
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("Evidence: Documentation");
    expect(result.markdown).toContain("OAuth 2.0 is widely adopted.");
    expect(result.markdown).toContain("Evidence: Benchmarks");
    expect(result.markdown).toContain("OAuth 2.0 shows 99.9% uptime.");
    expect(result.sections).toContain("evidence");
    expect(result.citations).toContain(1);
    expect(result.citations).toContain(2);
  });

  it("includes interpretation section", () => {
    const input: BriefInput = {
      ...baseInput,
      interpretation: "OAuth 2.0 is the best choice for scalability.",
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("## Interpretation");
    expect(result.markdown).toContain("OAuth 2.0 is the best choice for scalability.");
    expect(result.sections).toContain("interpretation");
  });

  it("includes interpretation citation refs when provided", () => {
    const input: BriefInput = {
      ...baseInput,
      interpretation: "Synthesis of all sources confirms OAuth 2.0.",
      interpretationCitationRefs: [1, 2],
    };

    const result = renderBrief(input);

    expect(result.citations).toContain(1);
    expect(result.citations).toContain(2);
  });

  it("includes tradeoffs section", () => {
    const input: BriefInput = {
      ...baseInput,
      tradeoffs: ["OAuth 2.0 is more complex than API keys.", "OAuth 2.0 requires token management."],
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("## Tradeoffs");
    expect(result.markdown).toContain("more complex than API keys");
    expect(result.markdown).toContain("requires token management");
    expect(result.sections).toContain("tradeoffs");
  });

  it("includes caveats section", () => {
    const input: BriefInput = {
      ...baseInput,
      caveats: ["Benchmarks may vary by provider.", "Token expiration policies differ."],
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("## Caveats");
    expect(result.markdown).toContain("Benchmarks may vary by provider.");
    expect(result.markdown).toContain("Token expiration policies differ.");
    expect(result.sections).toContain("caveats");
  });

  it("includes gaps section", () => {
    const input: BriefInput = {
      ...baseInput,
      gaps: ["No benchmarks for small-scale deployments.", "Token rotation best practices unclear."],
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("## Gaps");
    expect(result.markdown).toContain("No benchmarks for small-scale deployments.");
    expect(result.markdown).toContain("Token rotation best practices unclear.");
    expect(result.sections).toContain("gaps");
  });

  it("includes sources section with citation metadata", () => {
    const input: BriefInput = {
      ...baseInput,
      sourceNotes: [
        {
          citationNumber: 1,
          source: "https://example.com/docs",
          title: "OAuth 2.0 Documentation",
          snippets: ["OAuth 2.0 is the industry standard."],
        },
        {
          citationNumber: 2,
          source: "https://example.com/benchmarks",
          title: "Auth Benchmarks 2026",
          snippets: ["Uptime: 99.9%"],
        },
      ],
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("## Sources");
    expect(result.markdown).toContain("[1] OAuth 2.0 Documentation — https://example.com/docs");
    expect(result.markdown).toContain("[2] Auth Benchmarks 2026 — https://example.com/benchmarks");
    expect(result.markdown).toContain("> OAuth 2.0 is the industry standard.");
    expect(result.markdown).toContain("> Uptime: 99.9%");
    expect(result.sections).toContain("sources");
    expect(result.citations).toContain(1);
    expect(result.citations).toContain(2);
  });

  it("includes continuation recommendation when provided", () => {
    const input: BriefInput = {
      ...baseInput,
      continuationRecommendation: "Additional budget needed to investigate token rotation.",
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("## Continuation Recommendation");
    expect(result.markdown).toContain("Additional budget needed to investigate token rotation.");
    expect(result.sections).toContain("continuation-recommendation");
  });

  it("omits optional sections when not provided", () => {
    const input: BriefInput = {
      ...baseInput,
    };

    const result = renderBrief(input);

    expect(result.markdown).not.toContain("Tradeoffs");
    expect(result.markdown).not.toContain("Caveats");
    expect(result.markdown).not.toContain("Gaps");
    expect(result.markdown).not.toContain("Continuation Recommendation");
    expect(result.sections).not.toContain("tradeoffs");
    expect(result.sections).not.toContain("caveats");
    expect(result.sections).not.toContain("gaps");
    expect(result.sections).not.toContain("continuation-recommendation");
  });
});

describe("Research Brief renderer (agent/task gating)", () => {
  const baseInput: BriefInput = {
    question: "Best approach for auth?",
    bottomLine: "OAuth 2.0 is recommended.",
    confidence: "high",
    confidenceRationale: "Multiple sources confirm.",
    evidence: [],
    interpretation: "",
    sourceNotes: [],
    triggerType: "human",
    taskImplications: "Use OAuth 2.0 in the implementation.",
  };

  it("includes task implications for agent-triggered runs", () => {
    const input: BriefInput = { ...baseInput, triggerType: "agent" };
    const result = renderBrief(input);

    expect(result.markdown).toContain("Implications for Current Task");
    expect(result.markdown).toContain("Use OAuth 2.0 in the implementation.");
    expect(result.sections).toContain("task-implications");
  });

  it("includes task implications for task-triggered runs", () => {
    const input: BriefInput = { ...baseInput, triggerType: "task" };
    const result = renderBrief(input);

    expect(result.markdown).toContain("Implications for Current Task");
    expect(result.sections).toContain("task-implications");
  });

  it("omits task implications for human-triggered runs", () => {
    const input: BriefInput = { ...baseInput, triggerType: "human" };
    const result = renderBrief(input);

    expect(result.markdown).not.toContain("Implications for Current Task");
    expect(result.sections).not.toContain("task-implications");
  });

  it("omits task implications when not provided even for agent triggers", () => {
    const input: BriefInput = {
      ...baseInput,
      triggerType: "agent",
      taskImplications: undefined,
    };
    const result = renderBrief(input);

    expect(result.markdown).not.toContain("Implications for Current Task");
  });

  it("omits task implications when empty for agent triggers", () => {
    const input: BriefInput = {
      ...baseInput,
      triggerType: "agent",
      taskImplications: "",
    };
    const result = renderBrief(input);

    expect(result.markdown).not.toContain("Implications for Current Task");
  });
});

describe("Research Brief renderer (evidence vs interpretation)", () => {
  it("evidence and interpretation are separate sections", () => {
    const input: BriefInput = {
      question: "Best approach?",
      bottomLine: "Approach A.",
      confidence: "medium",
      confidenceRationale: "Mixed sources.",
      evidence: [
        {
          heading: "Documentation",
          content: "Approach A supports feature X.",
          citationRefs: [1],
        },
      ],
      interpretation: "Based on the evidence, Approach A is the most future-proof choice.",
      sourceNotes: [
        {
          citationNumber: 1,
          source: "https://example.com/docs",
          title: "Approach A Docs",
          snippets: ["Feature X supported."],
        },
      ],
      triggerType: "human",
    };

    const result = renderBrief(input);

    // Evidence section
    expect(result.markdown).toContain("Evidence: Documentation");
    expect(result.markdown).toContain("Approach A supports feature X.");
    // Interpretation section is separate
    expect(result.markdown).toContain("## Interpretation");
    expect(result.markdown).toContain("most future-proof choice");
    // Both appear in sections list
    expect(result.sections).toContain("evidence");
    expect(result.sections).toContain("interpretation");
  });
});

describe("Research Brief renderer (confidence rationale)", () => {
  it("includes confidence level and rationale in output", () => {
    const input: BriefInput = {
      question: "Best approach?",
      bottomLine: "Approach A.",
      confidence: "high",
      confidenceRationale: "Three independent sources agree on the key benchmarks. All sources are primary documentation.",
      evidence: [],
      interpretation: "",
      sourceNotes: [],
      triggerType: "human",
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("**Level**: high");
    expect(result.markdown).toContain("**Rationale**: Three independent sources agree");
    expect(result.sections).toContain("confidence");
  });

  it("renders low confidence with rationale", () => {
    const input: BriefInput = {
      question: "Best approach?",
      bottomLine: "Uncertain.",
      confidence: "low",
      confidenceRationale: "Only one informal source found.",
      evidence: [],
      interpretation: "",
      sourceNotes: [],
      triggerType: "human",
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("**Level**: low");
    expect(result.markdown).toContain("**Rationale**: Only one informal source found.");
  });

  it("renders medium confidence with rationale", () => {
    const input: BriefInput = {
      question: "Best approach?",
      bottomLine: "Tentative.",
      confidence: "medium",
      confidenceRationale: "Two sources agree but one contradicts.",
      evidence: [],
      interpretation: "",
      sourceNotes: [],
      triggerType: "human",
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("**Level**: medium");
    expect(result.markdown).toContain("**Rationale**: Two sources agree but one contradicts.");
  });
});

describe("Research Brief renderer (evidence mix coverage)", () => {
  it("includes evidence mix coverage block when provided", () => {
    const input: BriefInput = {
      question: "Best approach?",
      bottomLine: "Approach A.",
      confidence: "medium",
      confidenceRationale: "Partial coverage.",
      evidence: [],
      interpretation: "",
      sourceNotes: [],
      triggerType: "human",
      evidenceMixCoverage: "## Evidence Coverage\n\n- Documentation: **found**",
    };

    const result = renderBrief(input);

    expect(result.markdown).toContain("## Evidence Coverage");
    expect(result.markdown).toContain("Documentation: **found**");
    expect(result.sections).toContain("evidence-coverage");
  });

  it("omits evidence mix coverage when not provided", () => {
    const input: BriefInput = {
      question: "Best approach?",
      bottomLine: "Approach A.",
      confidence: "medium",
      confidenceRationale: "Partial.",
      evidence: [],
      interpretation: "",
      sourceNotes: [],
      triggerType: "human",
    };

    const result = renderBrief(input);

    expect(result.sections).not.toContain("evidence-coverage");
  });
});