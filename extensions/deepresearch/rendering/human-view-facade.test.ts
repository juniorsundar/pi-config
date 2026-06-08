import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { renderRun, type RenderRunOptions } from "./human-view-facade";

// ── Temp dir management ────────────────────────────────────────────────────

const workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-view-"));
  workDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of workDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

// ── Fixture helpers ────────────────────────────────────────────────────────

interface RunFixtureOptions {
  status?: string;
  question?: string;
  triggerSource?: string;
  briefContent?: string;
  budgetUsage?: { searches: number; sourceVisits: number; modelCalls: number };
  previousBriefAvailable?: boolean;
  hasSourceNotes?: boolean;
  evidenceMixCategories?: Array<{ category: string; status: string }>;
}

function createRunFixture(baseDir: string, runId: string, opts: RunFixtureOptions = {}): string {
  const runDir = join(baseDir, ".pi", "research", "runs", runId);
  mkdirSync(runDir, { recursive: true });

  // Defaults
  const status = opts.status ?? "completed";
  const question = opts.question ?? "Test research question?";
  const triggerSource = opts.triggerSource ?? "human";

  // Write status.json
  const statusJson: Record<string, any> = {
    identity: { id: runId, date: "2026-06-08", slug: "test", shortId: "abc12345" },
    status,
    question,
    createdAt: "2026-06-08T12:00:00.000Z",
    updatedAt: "2026-06-08T12:30:00.000Z",
    triggerSource,
  };
  if (status === "failed" && opts.previousBriefAvailable) {
    statusJson.previousBriefAvailable = true;
  }
  writeFileSync(join(runDir, "status.json"), JSON.stringify(statusJson, null, 2));

  // Write brief.md
  const briefContent = opts.briefContent ?? `# Research Brief\n\n**Question**: ${question}\n\n## Bottom Line\n\nTest finding.\n\n## Sources\n\n[1] Example Source — https://example.com\n  > Key evidence snippet.\n`;
  writeFileSync(join(runDir, "brief.md"), briefContent);

  // Write budget.json (optional — facade should handle missing gracefully)
  if (opts.budgetUsage) {
    const budgetJson = {
      limits: {
        maxSearches: 10,
        maxFetchAttempts: 10,
        maxSourceVisits: 10,
        maxSynthesisRounds: 3,
        maxModelCalls: 20,
        maxRetryAttempts: 5,
        maxElapsedSeconds: 300,
      },
      usage: opts.budgetUsage,
      startedAt: "2026-06-08T12:00:00.000Z",
    };
    writeFileSync(join(runDir, "budget.json"), JSON.stringify(budgetJson, null, 2));
  }

  // Write evidence-mix.json (optional)
  if (opts.evidenceMixCategories) {
    const cats = opts.evidenceMixCategories.map((c) => ({
      category: c.category,
      status: c.status,
    }));
    const evidenceMixJson = { categories: cats };
    writeFileSync(join(runDir, "evidence-mix.json"), JSON.stringify(evidenceMixJson, null, 2));
  }

  // Write source notes
  if (opts.hasSourceNotes ?? true) {
    const notesDir = join(runDir, "source-notes");
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(
      join(notesDir, "note-001.md"),
      [
        `# Source Note 1`,
        ``,
        `**Source**: https://example.com`,
        `**Title**: Example Source`,
        `**Type**: web`,
        `**Retrieved**: 2026-06-08T12:05:00.000Z`,
        `**Content Type**: text/html`,
        ``,
        `## Snippets`,
        ``,
        `- [1:1] Key evidence snippet.`,
        ``,
      ].join("\n"),
    );
    writeFileSync(
      join(notesDir, "note-002.md"),
      [
        `# Source Note 2`,
        ``,
        `**Source**: https://example.org`,
        `**Title**: Another Source`,
        `**Type**: web`,
        `**Retrieved**: 2026-06-08T12:10:00.000Z`,
        `**Content Type**: text/html`,
        ``,
        `## Snippets`,
        ``,
        `- [2:1] Additional evidence.`,
        ``,
      ].join("\n"),
    );
  }

  return runDir;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("HumanViewFacade (tracer bullet)", () => {
  it("renderRun reads canonical artifacts and writes self-contained HTML", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-test-abc12345";
    createRunFixture(baseDir, runId, {
      budgetUsage: { searches: 3, sourceVisits: 2, modelCalls: 5 },
    });

    const viewPath = await renderRun(baseDir, runId);

    // Returns a path under view/index.html
    expect(viewPath).toContain(runId);
    expect(viewPath).toContain("view/index.html");
    expect(existsSync(viewPath)).toBe(true);

    const html = readFileSync(viewPath, "utf-8");

    // Self-contained: no external CSS/JS
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
    expect(html).toContain("<style>");

    // Contains question
    expect(html).toContain("Test research question?");

    // Contains brief content
    expect(html).toContain("Test finding.");
  });

  it("renderRun includes capitalized status label in the HTML", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-completed-abc12345";
    createRunFixture(baseDir, runId, { status: "completed" });

    const viewPath = await renderRun(baseDir, runId);
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("Completed");
  });

  it("renderRun includes budget-exhausted banner for budget_exhausted runs", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-exhausted-abc12345";
    createRunFixture(baseDir, runId, { status: "budget_exhausted", budgetUsage: { searches: 5, sourceVisits: 3, modelCalls: 10 } });

    const viewPath = await renderRun(baseDir, runId);
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("Budget Exhausted");
    expect(html).toContain("Best Effort");
    expect(html).toContain("class=\"banner budget-exhausted\"");
  });

  it("renderRun refuses failed runs by default", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-failed-abc12345";
    createRunFixture(baseDir, runId, {
      status: "failed",
      previousBriefAvailable: true,
    });

    await expect(renderRun(baseDir, runId)).rejects.toThrow(/failed/i);
  });

  it("renderRun includes budget numbers when budget.json exists", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-budget-abc12345";
    createRunFixture(baseDir, runId, {
      budgetUsage: { searches: 5, sourceVisits: 3, modelCalls: 10 },
    });

    const viewPath = await renderRun(baseDir, runId);
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("5");
    expect(html).toContain("3");
    expect(html).toContain("10");
  });

  it("renderRun handles missing budget.json gracefully", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-nobudget-abc12345";
    createRunFixture(baseDir, runId, { budgetUsage: undefined });

    // Should not throw — budget is optional
    const viewPath = await renderRun(baseDir, runId);
    expect(existsSync(viewPath)).toBe(true);
  });

  it("renderRun includes evidence-mix coverage when evidence-mix.json exists", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-evidence-abc12345";
    createRunFixture(baseDir, runId, {
      budgetUsage: { searches: 4, sourceVisits: 3, modelCalls: 7 },
      evidenceMixCategories: [
        { category: "documentation", status: "found" },
        { category: "benchmarks", status: "weak" },
        { category: "source-code", status: "missing" },
      ],
    });

    const viewPath = await renderRun(baseDir, runId);
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("documentation");
    expect(html).toContain("benchmarks");
    expect(html).toContain("source-code");
    expect(html).toContain("found");
    expect(html).toContain("weak");
    expect(html).toContain("missing");
  });

  it("renderRun includes source links with citation numbers from source notes", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-sources-abc12345";
    createRunFixture(baseDir, runId);

    const viewPath = await renderRun(baseDir, runId);
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("Example Source");
    expect(html).toContain("Another Source");
    expect(html).toContain("https://example.com");
    expect(html).toContain("Key evidence snippet.");
    // Citation numbers rendered
    expect(html).toContain("[1]");
    expect(html).toContain("[2]");
  });

  it("renderRun with allowFailed on a failed run succeeds", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-inspect-abc12345";
    createRunFixture(baseDir, runId, {
      status: "failed",
      previousBriefAvailable: true,
    });

    const viewPath = await renderRun(baseDir, runId, { allowFailed: true });
    expect(existsSync(viewPath)).toBe(true);
  });

  it("renderRun refuses non-completed/budget_exhausted statuses", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-running-abc12345";
    createRunFixture(baseDir, runId, { status: "running" });

    await expect(renderRun(baseDir, runId)).rejects.toThrow(/cannot render/i);
  });

  it("renderRun includes caveats when present in brief", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-caveats-abc12345";
    const briefWithCaveats = `# Research Brief

**Question**: Test

## Bottom Line

Finding.

## Caveats

- Caveat one
- Caveat two

## Sources

[1] Example — https://example.com
`;
    createRunFixture(baseDir, runId, {
      briefContent: briefWithCaveats,
      budgetUsage: { searches: 1, sourceVisits: 1, modelCalls: 1 },
    });

    const viewPath = await renderRun(baseDir, runId);
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("Caveat one");
    expect(html).toContain("Caveat two");
  });

  it("renderRun includes budget summary labels", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-budgetlabels-abc12345";
    createRunFixture(baseDir, runId, {
      budgetUsage: { searches: 3, sourceVisits: 2, modelCalls: 5 },
    });

    const viewPath = await renderRun(baseDir, runId);
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("Searches");
    expect(html).toContain("Source Visits");
    expect(html).toContain("Model Calls");
  });

  it("renderRun with allowFailed shows stale banner for failed run with previous brief", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-stale-abc12345";
    createRunFixture(baseDir, runId, {
      status: "failed",
      previousBriefAvailable: true,
      hasSourceNotes: false,
    });

    const viewPath = await renderRun(baseDir, runId, { allowFailed: true });
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("Stale Brief");
    expect(html).toContain("Last continuation attempt failed");
    expect(html).toContain("class=\"banner stale\"");
  });

  it("renderRun throws on missing run directory", async () => {
    const baseDir = makeWorkDir();
    await expect(
      renderRun(baseDir, "nonexistent-run-id"),
    ).rejects.toThrow(/not found/i);
  });

  it("renderRun renders gaps and continuation recommendation in the HTML", async () => {
    const baseDir = makeWorkDir();
    const runId = "2026-06-08-allfields-abc12345";
    const briefWithAll = [
      "# Research Brief",
      "",
      "**Question**: Test",
      "",
      "## Bottom Line",
      "",
      "Finding.",
      "",
      "## Caveats",
      "",
      "- Caveat one",
      "",
      "## Gaps",
      "",
      "- Gap one",
      "- Gap two",
      "",
      "## Continuation Recommendation",
      "",
      "Consider investigating further.",
      "",
      "## Sources",
      "",
      "[1] Example \u2014 https://example.com",
      "",
    ].join("\n");
    createRunFixture(baseDir, runId, {
      status: "budget_exhausted",
      briefContent: briefWithAll,
      budgetUsage: { searches: 5, sourceVisits: 3, modelCalls: 8 },
    });

    const viewPath = await renderRun(baseDir, runId);
    const html = readFileSync(viewPath, "utf-8");

    expect(html).toContain("Budget Exhausted");
    expect(html).toContain("Caveat one");
    expect(html).toContain("Gap one");
    expect(html).toContain("Gap two");
    expect(html).toContain("Consider investigating further");
  });
});