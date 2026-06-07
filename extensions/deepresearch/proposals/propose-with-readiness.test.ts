import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { proposeWithReadiness } from "./propose-with-readiness.js";
import type { ResearchBrain } from "../brain/harness/types.js";

let dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-propose-rdy-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

/** Brain that returns a canned response (reachable). */
function reachableBrain(): ResearchBrain {
  return {
    generate: async (_prompt: string) => "ok",
  };
}

/** Brain that throws on generate (unreachable). */
function unreachableBrain(message: string): ResearchBrain {
  return {
    generate: async (_prompt: string) => {
      throw new Error(message);
    },
  };
}

describe("proposeWithReadiness", () => {
  it("creates a draft proposal when the brain is reachable", async () => {
    const cwd = makeDir();
    const brain = reachableBrain();

    const result = await proposeWithReadiness(brain, cwd, {
      question: "Is Deno better than Node.js?",
      trigger: "Evaluating runtime options",
      triggerSource: "agent",
    });

    expect(result.type).toBe("proposal_created");
    expect(result.meta).toBeDefined();
    expect(result.meta!.question).toBe("Is Deno better than Node.js?");
    expect(result.meta!.status).toBe("draft");
  });

  it("returns setup-blocked when quick reachability fails", async () => {
    const cwd = makeDir();
    const brain = unreachableBrain("Connection refused");

    const result = await proposeWithReadiness(brain, cwd, {
      question: "Should we use Rust or Go?",
      trigger: "Choosing a language for a high-performance service",
      triggerSource: "human",
    });

    expect(result.type).toBe("setup_blocked");
    expect(result.error).toContain("Connection refused");
    expect(result.meta).toBeNull();
  });

  it("setup-blocked result includes /research doctor guidance", async () => {
    const cwd = makeDir();
    const brain = unreachableBrain("model not found");

    const result = await proposeWithReadiness(brain, cwd, {
      question: "Is X better than Y?",
      trigger: "Choosing a framework",
      triggerSource: "agent",
    });

    expect(result.type).toBe("setup_blocked");
    expect(result.guidance).toContain("/research doctor");
  });

  it("writes workspace diagnostic on reachability failure", async () => {
    const cwd = makeDir();
    const brain = unreachableBrain("model 'bad-model' not found");

    const result = await proposeWithReadiness(brain, cwd, {
      question: "Which database to use?",
      trigger: "Evaluating database options for production",
      triggerSource: "agent",
    });

    // Should have written a diagnostic file
    const diagDir = join(cwd, ".pi", "research", "diagnostics");
    expect(existsSync(diagDir)).toBe(true);

    // Find any reachability diagnostic file
    const diagFiles = readFileSync;
    expect(result.diagnosticPath).toBeDefined();
    expect(existsSync(result.diagnosticPath!)).toBe(true);

    const parsed = JSON.parse(readFileSync(result.diagnosticPath!, "utf8"));
    expect(parsed.type).toBe("reachability");
    expect(parsed.reachable).toBe(false);
  });

  it("does NOT create a proposal when reachability fails", async () => {
    const cwd = makeDir();
    const brain = unreachableBrain("Connection refused");

    await proposeWithReadiness(brain, cwd, {
      question: "Which framework?",
      trigger: "Evaluating frameworks",
      triggerSource: "agent",
    });

    // proposals directory should not exist (no proposal created)
    const proposalsDir = join(cwd, ".pi", "research", "proposals");
    expect(existsSync(proposalsDir)).toBe(false);
  });

  it("does NOT create a Research Run when reachability fails", async () => {
    const cwd = makeDir();
    const brain = unreachableBrain("timeout");

    await proposeWithReadiness(brain, cwd, {
      question: "Which language?",
      trigger: "Choosing a language",
      triggerSource: "human",
    });

    const runsDir = join(cwd, ".pi", "research", "runs");
    expect(existsSync(runsDir)).toBe(false);
  });

  it("quick check runs before proposal creation — never creates proposal when unreachable", async () => {
    const cwd = makeDir();
    let generateCalled = false;
    const brain: ResearchBrain = {
      generate: async (_prompt: string) => {
        generateCalled = true;
        throw new Error("unreachable");
      },
    };

    const result = await proposeWithReadiness(brain, cwd, {
      question: "Test question?",
      trigger: "Test trigger",
      triggerSource: "agent",
    });

    expect(generateCalled).toBe(true);
    expect(result.type).toBe("setup_blocked");
    expect(result.meta).toBeNull();
  });

  it("preserves question and trigger in setup-blocked result for retry hints", async () => {
    const cwd = makeDir();
    const brain = unreachableBrain("host unreachable");

    const result = await proposeWithReadiness(brain, cwd, {
      question: "Should we use PostgreSQL or MySQL?",
      trigger: "Choosing a database for the new microservice",
      triggerSource: "human",
    });

    expect(result.question).toBe("Should we use PostgreSQL or MySQL?");
    expect(result.trigger).toBe("Choosing a database for the new microservice");
  });
});
