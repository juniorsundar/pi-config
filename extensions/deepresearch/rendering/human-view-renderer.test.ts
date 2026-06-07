import { describe, it, expect } from "vitest";
import { renderHumanView, type HumanViewInput } from "./human-view-renderer";

describe("Human Research View renderer (seam)", () => {
  it("renderHumanView returns HTML content", async () => {
    const input: HumanViewInput = {
      question: "Test question?",
      brief: "## Research Brief\n\nThis is a test brief.",
      status: "completed",
      sourceNotes: [],
      budgetSummary: { searches: 3, sourceVisits: 2, modelCalls: 5 },
    };

    const html = await renderHumanView(input);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("Test question?");
    expect(html).toContain("completed");
  });

  it("renderHumanView includes budget summary", async () => {
    const input: HumanViewInput = {
      question: "Budget test",
      brief: "Brief content.",
      status: "budget_exhausted",
      sourceNotes: [],
      budgetSummary: { searches: 5, sourceVisits: 3, modelCalls: 10 },
    };

    const html = await renderHumanView(input);

    expect(html).toContain("budget exhausted");
    expect(html).toContain("5");
  });

  it("renderHumanView includes source notes when provided", async () => {
    const input: HumanViewInput = {
      question: "Source test",
      brief: "Brief with sources.",
      status: "completed",
      sourceNotes: [
        {
          url: "https://example.com/1",
          title: "Source One",
          citationNumber: 1,
          snippets: ["Evidence one"],
        },
        {
          url: "https://example.com/2",
          title: "Source Two",
          citationNumber: 2,
          snippets: ["Evidence two"],
        },
      ],
      budgetSummary: { searches: 1, sourceVisits: 2, modelCalls: 1 },
    };

    const html = await renderHumanView(input);

    expect(html).toContain("Source One");
    expect(html).toContain("Source Two");
    expect(html).toContain("https://example.com/1");
  });

  it("renderHumanView is self-contained (no external assets)", async () => {
    const input: HumanViewInput = {
      question: "Self-contained test",
      brief: "Brief.",
      status: "completed",
      sourceNotes: [],
      budgetSummary: { searches: 0, sourceVisits: 0, modelCalls: 0 },
    };

    const html = await renderHumanView(input);

    // No external CSS or JS loaded
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
    expect(html).toContain("<style>");
  });
});
