import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runReadinessGate } from "./run-readiness.js";
import { createRun } from "./run-store.js";
import type { ResolvedModel } from "../brain/setup-policy/setup-policy.js";

let dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-run-rdy-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

const resolvedModel: ResolvedModel = {
  model: "tongyi-deepresearch:30b",
  provider: "ollama",
  host: "http://localhost:11434",
  source: "conventional_default",
};

/** Mock brain that passes all probes. */
function passingBrain(model: string) {
  const responses: Record<string, string> = {
    "structured-intents": JSON.stringify({ intent: "search" }),
    "inline-thinking": "Clean response without thinking tags.",
    "stop-behavior": JSON.stringify({
      intent: "stop_early",
      reasoning: "sufficient",
    }),
    "fenced-output": JSON.stringify({ intent: "search" }),
    "source-note": JSON.stringify({
      url: "https://example.com",
      title: "Example",
      snippets: ["Finding"],
      citation_number: 1,
    }),
    synthesis: "Findings show results [1] and [2] support the conclusion.",
    "research-simulation": JSON.stringify({ intent: "search", query: "SQLite vs DuckDB" }),
  };
  return {
    model,
    generate: async (prompt: string) => {
      for (const [key, value] of Object.entries(responses)) {
        if (prompt.includes(`probe: ${key}`)) return value;
      }
      return "";
    },
  };
}

describe("runReadinessGate", () => {
  it("transitions the run to running when readiness passes", async () => {
    const cwd = makeDir();
    const run = createRun(cwd, "Is Deno better than Node.js?");
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await runReadinessGate(cwd, run.identity.id, resolvedModel, brain);

    expect(result.status).toBe("running");
    expect(result.ready).toBe(true);
    expect(result.testedModel).toBe("tongyi-deepresearch:30b");
  });

  it("transitions to readiness_failed when the harness has failures", async () => {
    const cwd = makeDir();
    const run = createRun(cwd, "Which framework is best?");
    const brain = {
      model: "tongyi-deepresearch:30b",
      generate: async (_prompt: string) => "gibberish not json at all",
    };

    await expect(
      runReadinessGate(cwd, run.identity.id, resolvedModel, brain),
    ).rejects.toThrow("Model Readiness Check");

    // Verify the run status was updated to readiness_failed
    const statusPath = join(
      cwd,
      ".pi",
      "research",
      "runs",
      run.identity.id,
      "status.json",
    );
    expect(existsSync(statusPath)).toBe(true);
    const meta = JSON.parse(readFileSync(statusPath, "utf8"));
    expect(meta.status).toBe("readiness_failed");
  });

  it("writes run diagnostics on readiness failure", async () => {
    const cwd = makeDir();
    const run = createRun(cwd, "What is the best DB?");
    const brain = {
      model: "tongyi-deepresearch:30b",
      generate: async (_prompt: string) => "not json",
    };

    await expect(
      runReadinessGate(cwd, run.identity.id, resolvedModel, brain),
    ).rejects.toThrow();

    // Check diagnostics file was written
    const diagDir = join(
      cwd,
      ".pi",
      "research",
      "runs",
      run.identity.id,
      "diagnostics",
    );
    expect(existsSync(diagDir)).toBe(true);
  });

  it("hard-blocks execution on readiness failure (throws)", async () => {
    const cwd = makeDir();
    const run = createRun(cwd, "Test question?");
    const brain = {
      model: "tongyi-deepresearch:30b",
      generate: async () => {
        throw new Error("Connection refused");
      },
    };

    await expect(
      runReadinessGate(cwd, run.identity.id, resolvedModel, brain),
    ).rejects.toThrow();
  });

  it("rejects when brain model does not match resolved model", async () => {
    const cwd = makeDir();
    const run = createRun(cwd, "Test question?");
    const brain = passingBrain("wrong-model:v1");

    await expect(
      runReadinessGate(cwd, run.identity.id, resolvedModel, brain),
    ).rejects.toThrow("does not match the resolved Research Brain model");
  });

  it("stores the tested model in the result", async () => {
    const cwd = makeDir();
    const run = createRun(cwd, "What language should I use?");
    const brain = passingBrain("tongyi-deepresearch:30b");

    const result = await runReadinessGate(cwd, run.identity.id, resolvedModel, brain);

    expect(result.testedModel).toBe("tongyi-deepresearch:30b");
    expect(result.testedProvider).toBe("ollama");
  });

  it("leaves a stable readiness_failed artifact for inspection", async () => {
    const cwd = makeDir();
    const run = createRun(cwd, "Which database to use?");
    const brain = {
      model: "tongyi-deepresearch:30b",
      generate: async (_prompt: string) => "bad response",
    };

    await expect(
      runReadinessGate(cwd, run.identity.id, resolvedModel, brain),
    ).rejects.toThrow();

    // The run should still exist with readiness_failed status
    const { getRun } = await import("./run-store.js");
    const meta = getRun(cwd, run.identity.id);
    expect(meta).not.toBeNull();
    expect(meta!.status).toBe("readiness_failed");

    // The diagnostics directory should exist
    const diagDir = join(
      cwd,
      ".pi",
      "research",
      "runs",
      run.identity.id,
      "diagnostics",
    );
    expect(existsSync(diagDir)).toBe(true);
  });

  it("diagnostic artifact contains actual harness results on failure", async () => {
    const cwd = makeDir();
    const run = createRun(cwd, "Test question for harness capture?");
    const brain = {
      model: "tongyi-deepresearch:30b",
      generate: async (_prompt: string) => "completely invalid response",
    };

    await expect(
      runReadinessGate(cwd, run.identity.id, resolvedModel, brain),
    ).rejects.toThrow();

    // Find the diagnostic file and verify it has real probe results
    const diagDir = join(
      cwd,
      ".pi",
      "research",
      "runs",
      run.identity.id,
      "diagnostics",
    );
    const files = require("fs").readdirSync(diagDir);
    expect(files.length).toBeGreaterThan(0);

    const diagFile = join(diagDir, files[0]);
    const parsed = JSON.parse(readFileSync(diagFile, "utf8"));
    expect(parsed.type).toBe("readiness");
    expect(parsed.harness.results.length).toBeGreaterThan(0);
    expect(parsed.harness.failed).toBeGreaterThan(0);
  });
});
