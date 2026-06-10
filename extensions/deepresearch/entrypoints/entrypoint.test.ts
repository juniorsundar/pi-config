import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as statusModule from "../lifecycle/status";
import { registerDeepresearchTool } from "./tool";
import { registerResearchCommand } from "./command";
import { initStore } from "../workspace/store";
import { createProposal } from "../proposals/proposal-manager";
import { createRun, updateStatus, getRun } from "../lifecycle/run-store";
import type { ResearchBrain } from "../brain/harness/types";

// ── Module import ──

import deepresearchEntryPoint from "../index";

// ── Helpers ──

let workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-test-"));
  workDirs.push(dir);
  return dir;
}

function mockExtensionAPI(): {
  registerTool: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
} {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    on: vi.fn(),
    sendMessage: vi.fn(),
  };
}

/** Mock brain factory that returns a reachable brain for tests. */
function mockBrainFactory(): () => Promise<ResearchBrain> {
  return async () => ({
    generate: async (_prompt: string) => "ok",
  });
}

/** Brain factory that passes all readiness probes. */
function passingBrainFactory(): () => Promise<ResearchBrain> {
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
  return async () => ({
    generate: async (prompt: string) => {
      for (const [key, value] of Object.entries(responses)) {
        if (prompt.includes(`probe: ${key}`)) return value;
      }
      return "";
    },
  });
}

/** Mock brain factory that returns an unreachable brain. */
function unreachableBrainFactory(message: string): () => Promise<ResearchBrain> {
  return async () => ({
    generate: async (_prompt: string) => {
      throw new Error(message);
    },
  });
}

/** Register the tool with a reachable mock brain by default. */
function registerToolWithMockBrain(pi: ReturnType<typeof mockExtensionAPI>) {
  registerDeepresearchTool(pi, mockBrainFactory());
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of workDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ── Tracer Bullet Tests ──────────────────────────────────────────────────

describe("deepresearch entry point", () => {
  it("registers the /research command", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    expect(pi.registerCommand).toHaveBeenCalledWith("research", expect.any(Object));
  });

  it("/research command has a description", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    expect(cmdOpts.description).toBeTypeOf("string");
    expect(cmdOpts.description.length).toBeGreaterThan(0);
  });

  it("/research command handler is a function", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    expect(cmdOpts.handler).toBeTypeOf("function");
  });

  it("registers the deepresearch tool", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const toolDef = pi.registerTool.mock.calls[0][0];
    expect(toolDef.name).toBe("deepresearch");
  });

  it("deepresearch tool has a label and description", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const toolDef = pi.registerTool.mock.calls[0][0];
    expect(toolDef.label).toBeTypeOf("string");
    expect(toolDef.label.length).toBeGreaterThan(0);
    expect(toolDef.description).toBeTypeOf("string");
    expect(toolDef.description.length).toBeGreaterThan(0);
  });

  it("tool description includes the three-criteria Research Trigger rubric", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const desc = toolDef.description;

    expect(desc).toContain("names a specific decision");
    expect(desc).toContain("beyond the agent");
    expect(desc).toContain("local codebase exploration");
  });

  it("tool description includes the stateless agent lifecycle", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const desc = toolDef.description;

    expect(desc).toContain("propose");
    expect(desc).toContain("status");
    expect(desc).toContain("read_brief");
  });

  it("tool description does not reference 'weak trigger'", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const desc = toolDef.description;

    expect(desc).not.toContain("weak trigger");
    expect(desc).not.toContain("weak_trigger");
  });

  it("deepresearch tool has parameter schema with action field", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const toolDef = pi.registerTool.mock.calls[0][0];
    expect(toolDef.parameters.properties.action).toBeDefined();
    expect(toolDef.parameters.required).toContain("action");
  });

  it("deepresearch tool supports propose action", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const actionProp = toolDef.parameters.properties.action;
    expect(actionProp.enum).toContain("propose");
  });

  it("deepresearch tool execute handler is a function", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const toolDef = pi.registerTool.mock.calls[0][0];
    expect(toolDef.execute).toBeTypeOf("function");
  });
});

// ── Shutdown marking (Issue 0034) ──────────────────────────────────────

describe("session_shutdown handler", () => {
  it("registers a session_shutdown event handler", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    expect(pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });

  it("marks active running run as interrupted on shutdown", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    // Create and activate a running run
    const run = createRun(workDir, "Active run");
    updateStatus(workDir, run.identity.id, "running");

    // Get the session_shutdown handler
    const shutdownHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_shutdown",
    )?.[1];
    expect(shutdownHandler).toBeDefined();

    // Call the shutdown handler with a quit reason
    await shutdownHandler({ reason: "quit" }, { cwd: workDir });

    // Verify the run is now interrupted
    const updatedRun = getRun(workDir, run.identity.id);
    expect(updatedRun).not.toBeNull();
    expect(updatedRun!.status).toBe("interrupted");
    expect(updatedRun!.terminationReason).toBe("Pi shutdown");
  });

  it("marks active synthesizing run as interrupted on shutdown", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Synthesizing run");
    updateStatus(workDir, run.identity.id, "synthesizing");

    const shutdownHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_shutdown",
    )?.[1];
    expect(shutdownHandler).toBeDefined();

    await shutdownHandler({ reason: "quit" }, { cwd: workDir });

    const updatedRun = getRun(workDir, run.identity.id);
    expect(updatedRun).not.toBeNull();
    expect(updatedRun!.status).toBe("interrupted");
    expect(updatedRun!.terminationReason).toBe("Pi shutdown");
  });

  it("does not interrupt non-active runs on shutdown", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Completed run");
    updateStatus(workDir, run.identity.id, "completed");

    const shutdownHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_shutdown",
    )?.[1];
    expect(shutdownHandler).toBeDefined();

    await shutdownHandler({ reason: "quit" }, { cwd: workDir });

    const updatedRun = getRun(workDir, run.identity.id);
    expect(updatedRun).not.toBeNull();
    expect(updatedRun!.status).toBe("completed");
  });

  it("does not throw when no active run exists on shutdown", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const shutdownHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_shutdown",
    )?.[1];
    expect(shutdownHandler).toBeDefined();

    // Should not throw
    await expect(
      shutdownHandler({ reason: "quit" }, { cwd: workDir }),
    ).resolves.toBeUndefined();
  });

  it("marks interrupted with correct reason for reload", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Reload run");
    updateStatus(workDir, run.identity.id, "running");

    const shutdownHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_shutdown",
    )?.[1];

    await shutdownHandler({ reason: "reload" }, { cwd: workDir });

    const updatedRun = getRun(workDir, run.identity.id);
    expect(updatedRun).not.toBeNull();
    expect(updatedRun!.status).toBe("interrupted");
    expect(updatedRun!.terminationReason).toBe("Session reload");
  });

  it("marks interrupted with correct reason for new", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "New session run");
    updateStatus(workDir, run.identity.id, "running");

    const shutdownHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_shutdown",
    )?.[1];

    await shutdownHandler({ reason: "new" }, { cwd: workDir });

    const updatedRun = getRun(workDir, run.identity.id);
    expect(updatedRun!.status).toBe("interrupted");
    expect(updatedRun!.terminationReason).toBe("Session new");
  });

  it("marks interrupted with correct reason for resume", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Resume session run");
    updateStatus(workDir, run.identity.id, "running");

    const shutdownHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_shutdown",
    )?.[1];

    await shutdownHandler({ reason: "resume" }, { cwd: workDir });

    const updatedRun = getRun(workDir, run.identity.id);
    expect(updatedRun!.status).toBe("interrupted");
    expect(updatedRun!.terminationReason).toBe("Session resume");
  });

  it("does not throw on shutdown when getActiveRun or updateStatus errors", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const shutdownHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_shutdown",
    )?.[1];
    expect(shutdownHandler).toBeDefined();

    // With no store initialized, getActiveRun and updateStatus won't throw
    // because getActiveRun gracefully returns null for missing dirs.
    // This test verifies the try/catch guard doesn't itself cause issues.
    await expect(
      shutdownHandler({ reason: "quit" }, { cwd: workDir }),
    ).resolves.toBeUndefined();
  });
});

// ── session_start orphan scan (Issue 0034, Slice 6) ─────────────────────

describe("session_start orphan scan", () => {
  it("registers a session_start event handler", () => {
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });

  it("marks orphaned running runs as interrupted on session_start", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    // Create a running run that was left orphaned (crash scenario)
    const run = createRun(workDir, "Orphaned running run");
    updateStatus(workDir, run.identity.id, "running");

    const sessionStartHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_start",
    )?.[1];
    expect(sessionStartHandler).toBeDefined();

    await sessionStartHandler({ reason: "startup" }, { cwd: workDir });

    const orphanedRun = getRun(workDir, run.identity.id);
    expect(orphanedRun).not.toBeNull();
    expect(orphanedRun!.status).toBe("interrupted");
    expect(orphanedRun!.terminationReason).toBe("Session crashed");
  });

  it("marks orphaned synthesizing runs as interrupted on session_start", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Orphaned synthesizing run");
    updateStatus(workDir, run.identity.id, "synthesizing");

    const sessionStartHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_start",
    )?.[1];
    expect(sessionStartHandler).toBeDefined();

    await sessionStartHandler({ reason: "startup" }, { cwd: workDir });

    const orphanedRun = getRun(workDir, run.identity.id);
    expect(orphanedRun!.status).toBe("interrupted");
  });

  it("does not interrupt completed runs on session_start", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Completed run");
    updateStatus(workDir, run.identity.id, "completed");

    const sessionStartHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_start",
    )?.[1];
    expect(sessionStartHandler).toBeDefined();

    await sessionStartHandler({ reason: "startup" }, { cwd: workDir });

    const completedRun = getRun(workDir, run.identity.id);
    expect(completedRun!.status).toBe("completed");
  });

  it("does not throw when no runs exist on session_start", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const sessionStartHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_start",
    )?.[1];
    expect(sessionStartHandler).toBeDefined();

    await expect(
      sessionStartHandler({ reason: "startup" }, { cwd: workDir }),
    ).resolves.toBeUndefined();
  });

  it("handles errors gracefully during orphan scan", async () => {
    const workDir = makeWorkDir();

    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    // No store initialized — listRuns should return empty gracefully
    const sessionStartHandler = pi.on.mock.calls.find(
      (c: any) => c[0] === "session_start",
    )?.[1];
    expect(sessionStartHandler).toBeDefined();

    await expect(
      sessionStartHandler({ reason: "resume" }, { cwd: workDir }),
    ).resolves.toBeUndefined();
  });
});

// ── Orphan prevention (AC2) ───────────────────────────────────────────────

describe("orphan prevention (AC2)", () => {
  it("no child_process or spawn usage in deepresearch extension", () => {
    // The deepresearch extension should not use child_process, spawn, or exec
    // to prevent detached orphan processes. This is a design-level test.
    const extDir = join(__dirname, "..");
    const filesToCheck = [
      "index.ts",
      "entrypoints/tool.ts",
      "entrypoints/command.ts",
      "run-loop/run-loop.ts",
      "lifecycle/run-store.ts",
    ];

    for (const file of filesToCheck) {
      const filePath = join(extDir, file);
      const content = readFileSync(filePath, "utf-8");
      // No direct child_process, spawn, or exec usage in orchestrator files
      expect(content).not.toMatch(/require\("child_process"\)/);
      expect(content).not.toMatch(/from "child_process"/);
      expect(content).not.toMatch(/\bspawn\(/);
      expect(content).not.toMatch(/\bexec\(/);
    }
  });
});

// ── Status reporting (empty workspace) ───────────────────────────────────

describe("status in fresh workspace", () => {
  it("reports no active run", () => {
    const workDir = makeWorkDir();
    const result = statusModule.getStatus(workDir);

    expect(result.activeRun).toBeNull();
  });

  it("reports no proposals", () => {
    const workDir = makeWorkDir();
    const result = statusModule.getStatus(workDir);

    expect(result.proposals).toEqual([]);
  });

  it("reports no runs", () => {
    const workDir = makeWorkDir();
    const result = statusModule.getStatus(workDir);

    expect(result.runs).toEqual([]);
  });

  it("includes workspace path in status result", () => {
    const workDir = makeWorkDir();
    const result = statusModule.getStatus(workDir);

    expect(result.storePath).toBe(join(workDir, ".pi", "research"));
  });
});

// ── Status integration via tool execute ──────────────────────────────────

describe("deepresearch tool status action", () => {
  it("returns empty results for a fresh workspace", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-1",
      { action: "status" },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    expect(result.content).toBeTypeOf("object");
    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent).toBeDefined();
    expect(textContent.text).toContain("Active Run");
    expect(textContent.text).toContain("none");
    expect(textContent.text).toContain("Proposals");
    expect(textContent.text).toContain("No research proposals or runs exist");
  });

  it("includes progress digest content for an active run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    // Create an active run with a progress digest
    initStore(workDir);
    const run = createRun(workDir, "Active research", {
      mode: "blocking",
      trigger: "Testing progress digest in tool",
    });
    updateStatus(workDir, run.identity.id, "running");

    // Write a progress-digest.md artifact
    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "progress-digest.md"),
      "## Progress Digest — test\n\n📊 Budget: 2/10 searches\n🎯 Evidence: partial\n",
    );

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-status-digest",
      { action: "status" },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent).toBeDefined();
    // Digest content rendered in the status text
    expect(textContent.text).toContain("Progress Digest");
    expect(textContent.text).toContain("2/10 searches");
    // Active run info still present
    expect(textContent.text).toContain(run.identity.id);
    expect(textContent.text).toContain("blocking");
    // Artifact pointer paths rendered
    expect(textContent.text).toContain("progress-digest.md");
    // No raw diagnostic paths in output
    expect(textContent.text).not.toContain("diagnostics");

    // Details exclude raw diagnostics
    expect(result.details).toBeDefined();
    expect(result.details.activeRun).toBeDefined();
    expect(result.details.activeProgressDigest).toBeDefined();
  });
});

// ── Propose via tool ─────────────────────────────────────────────────────

describe("deepresearch tool propose action", () => {
  it("creates a draft proposal and returns preview", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-2",
      {
        action: "propose",
        question: "Is Deno better than Node.js for CLI tools?",
        trigger: "Evaluating runtime options for a new CLI project",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent).toBeDefined();
    expect(textContent.text).toContain("Research Proposal");
    expect(textContent.text).toContain(
      "Is Deno better than Node.js for CLI tools?",
    );
    expect(textContent.text).toContain("draft");
    expect(textContent.text).toContain("proposal.md");

    // Verify it's persisted
    const proposals = statusModule.getStatus(workDir).proposals;
    expect(proposals.length).toBe(1);
    expect(proposals[0].status).toBe("draft");
  });

  it("propose returns summary, trigger, blockingMode, evidenceMix, and budget fields in details", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-newfields",
      {
        action: "propose",
        question: "Is Deno better than Node.js for CLI tools?",
        trigger: "Evaluating runtime options for a new CLI project",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    expect(result.details.action).toBe("propose");
    expect(result.details.status).toBe("draft");

    // Existing fields preserved
    expect(result.details.proposal).toBeDefined();
    expect(result.details.proposal.id).toBeTypeOf("string");
    expect(result.details.proposal.path).toContain("proposal.md");

    // New additive fields
    expect(result.details).toHaveProperty("summary");
    expect(result.details).toHaveProperty("trigger");
    expect(result.details).toHaveProperty("blockingMode");
    expect(result.details).toHaveProperty("evidenceMix");
    expect(result.details).toHaveProperty("budget");

    expect(typeof result.details.summary).toBe("string");
    expect(typeof result.details.trigger).toBe("string");
    expect(result.details.trigger).toBe("Evaluating runtime options for a new CLI project");
    expect(typeof result.details.blockingMode).toBe("boolean");
    expect(result.details.blockingMode).toBe(true);
    expect(Array.isArray(result.details.evidenceMix)).toBe(true);
    expect(result.details.evidenceMix).toEqual([]);
    expect(result.details.budget).toBeNull();
  });

  it("returns error when question is missing", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-3",
      { action: "propose", trigger: "Some trigger" },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("Error");
  });

  it("returns error when trigger is missing", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-4",
      { action: "propose", question: "A question?" },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("Error");
  });

  it("accepts a valid decision-relevant trigger", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-5",
      {
        action: "propose",
        question: "Should we use Bun or Node.js for this project?",
        trigger: "Evaluating runtime performance for our API server",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    expect(result.details.action).toBe("propose");
    expect(result.details.status).toBe("draft");

    // Verify proposal persisted with draft status
    const proposals = statusModule.getStatus(workDir).proposals;
    expect(proposals.length).toBe(1);
    expect(proposals[0].status).toBe("draft");
  });

  it("refuses a routine lookup trigger with clear guidance", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-6",
      {
        action: "propose",
        question: "What is the current version of React?",
        trigger: "What is the current version of React?",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("Error");
    expect(textContent.text).toContain("web_search");

    // Verify no proposal was created
    const proposals = statusModule.getStatus(workDir).proposals;
    expect(proposals.length).toBe(0);
  });

  it("refuses a local-codebase exploration trigger with clear guidance", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-7",
      {
        action: "propose",
        question: "Where is the proposal manager?",
        trigger: "Find all TypeScript files in this project",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("Error");
    expect(textContent.text).toContain("bash");

    // Verify no proposal was created
    const proposals = statusModule.getStatus(workDir).proposals;
    expect(proposals.length).toBe(0);
  });

  it("refuses a curiosity-only trigger with clear guidance", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-8",
      {
        action: "propose",
        question: "I wonder how Rust stacks up",
        trigger: "I wonder how Rust compares to Go for web servers",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("Error");
    expect(textContent.text).toContain("rephrase");

    // Verify no proposal was created
    const proposals = statusModule.getStatus(workDir).proposals;
    expect(proposals.length).toBe(0);
  });

  // ── Quick reachability guard ──────────────────────────────────────────

  it("returns setup-blocked when quick reachability fails", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerDeepresearchTool(pi, unreachableBrainFactory("Connection refused"));

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-reach-1",
      {
        action: "propose",
        question: "Should we use Rust or Go?",
        trigger: "Choosing a language for a high-performance service",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("Setup Blocked");
    expect(textContent.text).toContain("Connection refused");
    expect(result.details.status).toBe("setup_blocked");

    // Verify no proposal was created
    const proposals = statusModule.getStatus(workDir).proposals;
    expect(proposals.length).toBe(0);
  });

  it("setup-blocked result includes /research doctor guidance", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerDeepresearchTool(pi, unreachableBrainFactory("model 'bad-model' not found"));

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-reach-2",
      {
        action: "propose",
        question: "Which database to use?",
        trigger: "Evaluating database options",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("/research doctor");
  });

  it("writes workspace diagnostic on reachability failure", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerDeepresearchTool(pi, unreachableBrainFactory("timeout"));

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-reach-3",
      {
        action: "propose",
        question: "Which framework?",
        trigger: "Evaluating frameworks",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    // Diagnostic path should be in details
    expect(result.details.diagnosticPath).toBeDefined();
    expect(result.details.diagnosticPath).toContain(
      ".pi/research/diagnostics/reachability-",
    );
  });
});

// ── Forbidden action surface (C4, C5, C6) ─────────────────────────────

describe("deepresearch tool forbidden actions", () => {
  it("action enum excludes approve, deny, start, resume, cancel, force_synthesis", () => {
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const allowedActions = toolDef.parameters.properties.action.enum;

    const forbiddenActions = [
      "approve",
      "deny",
      "start",
      "resume",
      "cancel",
      "force_synthesis",
      "steer",
      "add_instruction",
      "promote",
    ];

    for (const forbidden of forbiddenActions) {
      expect(allowedActions).not.toContain(forbidden);
    }
  });

  it("rejects additional properties (steering injection prevention)", () => {
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    expect(toolDef.parameters.additionalProperties).toBe(false);
  });

  it("propose action does not auto-approve — proposal stays draft", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    await toolDef.execute(
      "call-guard-1",
      {
        action: "propose",
        question: "Should we use X or Y?",
        trigger: "Choosing a database for production",
      },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const status = statusModule.getStatus(workDir);
    // No run was created (C5: human approval required)
    expect(status.runs.length).toBe(0);
    expect(status.activeRun).toBeNull();

    // All proposals are draft
    for (const p of status.proposals) {
      expect(p.status).toBe("draft");
    }
  });
});

// ── recommend_resume (Issue 0034) ────────────────────────────────────────

describe("deepresearch tool recommend_resume action", () => {
  /** Create a run with a given status and synthetic artifacts. */
  function createRunWithArtifacts(
    workDir: string,
    status: string,
    sourceNoteCount: number = 0,
  ): string {
    initStore(workDir);
    const run = createRun(workDir, "Resumable research");
    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);

    // Set status
    updateStatus(workDir, run.identity.id, status as any);

    // Create source notes directory
    if (sourceNoteCount > 0) {
      const notesDir = join(runDir, "source-notes");
      mkdirSync(notesDir, { recursive: true });
      for (let i = 1; i <= sourceNoteCount; i++) {
        writeFileSync(
          join(notesDir, `note-${i}.md`),
          `# Source Note ${i}\n\nEvidence snippet.`,
        );
      }
    }

    // Create ledger
    writeFileSync(join(runDir, "ledger.jsonl"), `{"round":1,"intent":"budget_approved"}\n`);

    // Create run-summary.md
    writeFileSync(
      join(runDir, "run-summary.md"),
      `# Run Summary\n\nBudget remaining: ...\n`,
    );

    return run.identity.id;
  }

  it("returns resume details for interrupted run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const runId = createRunWithArtifacts(workDir, "interrupted", 3);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-resume-1",
      { action: "recommend_resume", run_id: runId },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    expect(result.details.action).toBe("recommend_resume");
    expect(result.details.resumable).toBe(true);
    expect(result.details.runStatus).toBe("interrupted");
    expect(result.details.sourceNoteCount).toBe(3);
    expect(result.details.ledgerEntryCount).toBe(1);
  });

  it("returns resume details for readiness_failed run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const runId = createRunWithArtifacts(workDir, "readiness_failed", 0);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-resume-2",
      { action: "recommend_resume", run_id: runId },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    expect(result.details.resumable).toBe(true);
    expect(result.details.runStatus).toBe("readiness_failed");
    expect(result.details.sourceNoteCount).toBe(0);
  });

  it("returns resume details for budget_exhausted run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const runId = createRunWithArtifacts(workDir, "budget_exhausted", 5);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-resume-3",
      { action: "recommend_resume", run_id: runId },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    expect(result.details.resumable).toBe(true);
    expect(result.details.runStatus).toBe("budget_exhausted");
    expect(result.details.sourceNoteCount).toBe(5);
  });

  it("rejects completed runs (AC7 — terminal in v1)", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const runId = createRunWithArtifacts(workDir, "completed", 10);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-resume-4",
      { action: "recommend_resume", run_id: runId },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    expect(result.details.resumable).toBe(false);
    expect(result.details.reason).toBe("terminal_in_v1");

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("terminal");
  });

  it("rejects running runs", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const runId = createRunWithArtifacts(workDir, "running", 0);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-resume-5",
      { action: "recommend_resume", run_id: runId },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    expect(result.details.resumable).toBe(false);
    expect(result.details.reason).toBe("not_resumable");
  });

  it("returns error for missing run_id parameter", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-resume-6",
      { action: "recommend_resume" },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("Error");
  });

  it("returns error for unknown run ID", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerToolWithMockBrain(pi);

    const toolDef = pi.registerTool.mock.calls[0][0];
    const result = await toolDef.execute(
      "call-resume-7",
      { action: "recommend_resume", run_id: "nonexistent" },
      new AbortController().signal,
      undefined,
      { cwd: workDir },
    );

    const textContent = result.content.find(
      (c: { type: string }) => c.type === "text",
    );
    expect(textContent.text).toContain("Error");
    expect(textContent.text).toContain("not found");
  });
});

// ── Status via /research command ──────────────────────────────────────────

describe("/research status command", () => {
  it("emits command output via pi.sendMessage when ctx.print is unavailable", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    await cmdOpts.handler("status", { cwd: workDir });

    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const message = pi.sendMessage.mock.calls[0][0];
    expect(message.customType).toBe("deepresearch-command-output");
    expect(message.display).toBe(true);
    expect(message.content).toContain("No active research run");
    expect(message.content).toContain("No research proposals");
  });

  it("prints empty workspace status", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    expect(cmdOpts.handler).toBeTypeOf("function");

    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("status", ctx);
    const output = mockLog.join("\n");
    expect(output).toContain("No active research run");
    expect(output).toContain("No research proposals");
  });

  it("includes progress digest and artifact pointers for an active run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    // Create an active run with a progress digest
    initStore(workDir);
    const run = createRun(workDir, "Active test", {
      mode: "blocking",
      trigger: "Testing command output",
    });
    updateStatus(workDir, run.identity.id, "running");

    // Write a progress-digest.md artifact
    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "progress-digest.md"),
      "## Progress Digest — test\n\n📊 Budget: 1/10 searches\n🎯 Evidence: weak\n",
    );

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("status", ctx);
    const output = mockLog.join("\n");
    expect(output).toContain("Active Run");
    expect(output).toContain(run.identity.id);
    expect(output).toContain("blocking");
    // Progress digest content
    expect(output).toContain("Progress Digest");
    expect(output).toContain("1/10 searches");
    expect(output).toContain("weak");
    // Artifact paths
    expect(output).toContain("Artifact paths");
    expect(output).toContain("progress-digest.md");
  });
});

// ── Propose via /research command ────────────────────────────────────────

describe("/research propose command", () => {
  it("creates a draft proposal and prints confirmation", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(pi, mockBrainFactory());

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler(
      'propose "Is Deno good?" --trigger "Evaluating runtimes"',
      ctx,
    );

    const output = mockLog.join("\n");
    expect(output).toContain("Draft proposal created");
    expect(output).toContain("Is Deno good?");
    expect(output).toContain("draft");

    // Verify persisted
    const proposals = statusModule.getStatus(workDir).proposals;
    expect(proposals.length).toBe(1);
    expect(proposals[0].status).toBe("draft");
  });

  it("prints usage hint when called without arguments", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(pi, mockBrainFactory());

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("propose", ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Usage");
  });

  // ── Quick reachability guard ──────────────────────────────────────────

  it("prints setup-blocked when reachability fails", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(
      pi,
      unreachableBrainFactory("Connection refused"),
    );

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler(
      'propose "Which database?" --trigger "Choosing a database"',
      ctx,
    );

    const output = mockLog.join("\n");
    expect(output).toContain("Setup Blocked");
    expect(output).toContain("Connection refused");
    expect(output).toContain("/research doctor");
    expect(output).not.toContain("Draft proposal created");

    // Verify no proposal was created
    const proposals = statusModule.getStatus(workDir).proposals;
    expect(proposals.length).toBe(0);
  });
});

// ── Doctor command ────────────────────────────────────────────────────────

describe("/research doctor command", () => {
  it("runs diagnostics and displays results", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(pi, mockBrainFactory());

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("doctor", ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Running doctor diagnostics");
    // Summary should be present (even if all probes fail on mock)
    expect(output.length).toBeGreaterThan(0);
  });

  it("does not create a Research Run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(pi, mockBrainFactory());

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("doctor", ctx);

    const status = statusModule.getStatus(workDir);
    expect(status.runs.length).toBe(0);
  });

  it("supports --model override", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(pi, mockBrainFactory());

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler('doctor --model custom-model:latest', ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("custom-model:latest");
  });
});

// ── Approve command ──────────────────────────────────────────────────────

describe("/research approve command", () => {
  it("prints usage when called without proposal ID", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(pi, passingBrainFactory());

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("approve", ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Usage");
    expect(output).toContain("approve");
  });

  it("approves a proposal and activates the run (no active run)", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(
      pi,
      passingBrainFactory(),
      vi.fn().mockResolvedValue({
        briefPath: "",
        sourceNoteCount: 0,
        roundCount: 0,
        ledgerEntryCount: 0,
      }),
    );

    // Create a draft proposal first
    initStore(workDir);
    const proposal = createProposal(workDir, {
      question: "Should we use Rust or Go?",
      trigger: "Choosing a language for a high-performance service",
      mode: "blocking",
    });

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler(`approve ${proposal.identity.id}`, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Proposal approved");
    expect(output).toContain(proposal.identity.id);
    expect(output).toContain("Activated:  yes");
    expect(output).toContain("running");

    // Verify a run was created
    const status = statusModule.getStatus(workDir);
    expect(status.runs.length).toBe(1);
    expect(status.runs[0].status).toBe("running");
  });

  it("approves a proposal and queues when active run exists", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(pi, passingBrainFactory());

    // Create a draft proposal first
    initStore(workDir);

    // Create an active run first
    const activeRun = createRun(workDir, "Already active");
    updateStatus(workDir, activeRun.identity.id, "running");

    // Now create a proposal
    const proposal = createProposal(workDir, {
      question: "Queued proposal?",
      trigger: "A valid trigger",
    });

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler(`approve ${proposal.identity.id}`, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Proposal approved");
    expect(output).toContain("Activated:  no");
    expect(output).toContain("queued behind active run");

    // Verify runs: 1 active + 1 queued
    const status = statusModule.getStatus(workDir);
    expect(status.runs.length).toBe(2);
    expect(status.activeRun).not.toBeNull();
  });

  it("shows error when proposal ID not found", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    registerResearchCommand(pi, mockBrainFactory());

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("approve nonexistent-id", ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Proposal not found");
  });

  it("starts executeRun as background promise for blocking-mode activated run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    const mockRunLoop = vi.fn().mockResolvedValue({
      briefPath: ".pi/research/runs/run-1/brief.md",
      sourceNoteCount: 3,
      roundCount: 5,
      ledgerEntryCount: 12,
    });
    registerResearchCommand(pi, passingBrainFactory(), mockRunLoop as any);

    initStore(workDir);
    const proposal = createProposal(workDir, {
      question: "Test question?",
      trigger: "A valid trigger for testing",
      mode: "blocking",
    });

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler(`approve ${proposal.identity.id}`, ctx);

    // Handler returned — runLoop should have been called
    expect(mockRunLoop).toHaveBeenCalledOnce();

    // Check args passed to runLoop
    const [cwd, runId, brain, budget] = mockRunLoop.mock.calls[0];
    expect(cwd).toBe(workDir);
    expect(runId).toBeTruthy();
    expect(budget).toHaveProperty("limits");
    expect(budget).toHaveProperty("usage");
    expect(budget.limits.maxSearches).toBe(10);
    expect(budget.limits.maxElapsedSeconds).toBe(600);
  });

  it("handler returns before runLoop completes (non-blocking)", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();

    // Create a deferred promise so we can control when runLoop resolves
    let resolveRun: (value: any) => void = () => {};
    const runPromise = new Promise((resolve) => {
      resolveRun = resolve;
    });
    const mockRunLoop = vi.fn().mockReturnValue(runPromise);
    registerResearchCommand(pi, passingBrainFactory(), mockRunLoop as any);

    initStore(workDir);
    const proposal = createProposal(workDir, {
      question: "Non-blocking test?",
      trigger: "A valid trigger",
      mode: "blocking",
    });

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const ctx = { cwd: workDir, print: () => {} };

    // Handler should return even though runLoop hasn't resolved
    await cmdOpts.handler(`approve ${proposal.identity.id}`, ctx);

    expect(mockRunLoop).toHaveBeenCalledOnce();
    expect(pi.sendMessage).not.toHaveBeenCalled();

    // Now resolve the run loop
    resolveRun({
      briefPath: ".pi/research/runs/run-1/brief.md",
      sourceNoteCount: 3,
      roundCount: 5,
      ledgerEntryCount: 12,
    });

    // Wait for the .then() notification to fire
    await vi.waitFor(
      () => {
        expect(pi.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining("completed"),
          }),
        );
      },
      { timeout: 1000, interval: 10 },
    );
  });

  it("sends error notification and marks run interrupted on runLoop rejection", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    const mockRunLoop = vi.fn().mockRejectedValue(new Error("Model API timeout"));
    registerResearchCommand(pi, passingBrainFactory(), mockRunLoop as any);

    initStore(workDir);
    const proposal = createProposal(workDir, {
      question: "Error test?",
      trigger: "A valid trigger",
      mode: "blocking",
    });

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const ctx = { cwd: workDir, print: () => {} };

    await cmdOpts.handler(`approve ${proposal.identity.id}`, ctx);

    expect(mockRunLoop).toHaveBeenCalledOnce();
    const capturedRunId = mockRunLoop.mock.calls[0][1];

    // Wait for the .catch() notification to fire
    await vi.waitFor(
      () => {
        expect(pi.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining("interrupted"),
          }),
        );
      },
      { timeout: 1000, interval: 10 },
    );

    // Run should be marked interrupted
    const run = getRun(workDir, capturedRunId);
    expect(run).toBeTruthy();
    expect(run!.status).toBe("interrupted");
  });

  it("does NOT start runLoop for queued (non-activated) run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    const mockRunLoop = vi.fn();
    registerResearchCommand(pi, passingBrainFactory(), mockRunLoop as any);

    initStore(workDir);

    // Create an active run first so the new run will be queued
    const activeRun = createRun(workDir, "Active run");
    updateStatus(workDir, activeRun.identity.id, "running");

    const proposal = createProposal(workDir, {
      question: "Queued proposal?",
      trigger: "A valid trigger",
      mode: "blocking",
    });

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const ctx = { cwd: workDir, print: () => {} };

    await cmdOpts.handler(`approve ${proposal.identity.id}`, ctx);

    expect(mockRunLoop).not.toHaveBeenCalled();
  });

  it("does NOT start runLoop for background-mode activated run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    const mockRunLoop = vi.fn();
    registerResearchCommand(pi, passingBrainFactory(), mockRunLoop as any);

    initStore(workDir);
    const proposal = createProposal(workDir, {
      question: "Background test?",
      trigger: "A valid trigger",
      mode: "background",
    });

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const ctx = { cwd: workDir, print: () => {} };

    await cmdOpts.handler(`approve ${proposal.identity.id}`, ctx);

    expect(mockRunLoop).not.toHaveBeenCalled();
  });
});

// ── Resume via /research command (Issue 0034, Slice 7) ──────────────────

describe("/research resume command", () => {
  it("prints usage when called without run ID", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("resume", ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Usage");
    expect(output).toContain("run-id");
  });

  it("shows resume state summary for interrupted run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    initStore(workDir);
    const run = createRun(workDir, "Interrupted run");
    updateStatus(workDir, run.identity.id, "interrupted");

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("resume " + run.identity.id, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Resuming");
    expect(output).toContain(run.identity.id);
    expect(output).toContain("interrupted");
  });

  it("shows resume state summary for readiness_failed run", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    initStore(workDir);
    const run = createRun(workDir, "Readiness failed run");
    updateStatus(workDir, run.identity.id, "readiness_failed");

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("resume " + run.identity.id, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Resuming");
    expect(output).toContain("readiness_failed");
  });

  it("shows error for unknown run ID", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("resume nonexistent", ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("not found");
  });
});

// ── Promote via /research command ──────────────────────────────────────

describe("/research promote command", () => {
  it("prints usage when called without arguments", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("promote", ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Usage");
    expect(output).toContain("promote");
  });

  it("promotes a completed Research Brief to a destination", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    // Create a completed run with brief.md and source notes
    const run = createRun(workDir, "Promotion test", {
      mode: "blocking",
      trigger: "Testing promotion",
    });
    updateStatus(workDir, run.identity.id, "completed");

    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });

    // Write a brief.md
    writeFileSync(
      join(runDir, "brief.md"),
      [
        "# Research Brief",
        "",
        "Findings show [1] supports the conclusion.",
        "",
        "## Confidence",
        "Medium",
      ].join("\n"),
    );

    // Write source notes
    const notesDir = join(runDir, "source-notes");
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(
      join(notesDir, "note-001.md"),
      [
        "# Source Note 1",
        "**Source**: https://example.com/doc",
        "**Title**: Example Documentation",
        "",
        "## Snippets",
        "- [1:1] The framework supports async natively",
      ].join("\n"),
    );

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    const destDir = join(workDir, "docs", "research");
    await cmdOpts.handler(`promote ${run.identity.id} --to ${destDir}`, ctx);

    const output = mockLog.join("\n");
    // Verify printed paths
    expect(output).toContain(destDir);
    expect(output).toContain("brief.md");
    expect(output).toContain("appendix.md");

    // Verify files were written
    expect(existsSync(join(destDir, "brief.md"))).toBe(true);
    expect(existsSync(join(destDir, "appendix.md"))).toBe(true);

    // Verify appendix contains source-reference metadata (C6 gap)
    const appendix = readFileSync(join(destDir, "appendix.md"), "utf-8");
    expect(appendix).toContain("https://example.com/doc");
    expect(appendix).toContain("Example Documentation");
    expect(appendix).toContain("The framework supports async natively");
  });

  it("refuses promotion for non-completed/non-budget_exhausted runs", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Running test");
    updateStatus(workDir, run.identity.id, "running");

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler(`promote ${run.identity.id} --to ${workDir}/out`, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Error");
    expect(output).toContain("running");
  });

  it("refuses paths outside the active workspace", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Path safety test");
    updateStatus(workDir, run.identity.id, "completed");

    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "brief.md"), "# Brief\nContent");

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    // Destination outside cwd
    const outsideDir = join(workDir, "..", "outside");
    await cmdOpts.handler(`promote ${run.identity.id} --to ${outsideDir}`, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Error");
    expect(output).toContain("outside");
  });

  it("refuses overwrite of existing files without --force", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Overwrite test");
    updateStatus(workDir, run.identity.id, "completed");

    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "brief.md"), "# Brief\nContent");

    // Pre-create the destination with brief.md
    const destDir = join(workDir, "docs");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "brief.md"), "# Old brief");

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler(`promote ${run.identity.id} --to ${destDir}`, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Error");
    expect(output).toContain("already exist");
  });

  it("promotes a budget-exhausted brief with best-effort labeling", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Budget exhausted test", {
      mode: "blocking",
      trigger: "Testing budget exhaustion",
    });
    updateStatus(workDir, run.identity.id, "budget_exhausted");

    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });

    // Write a budget-exhausted brief.md with caveats, gaps, and continuation recommendation
    writeFileSync(
      join(runDir, "brief.md"),
      [
        "# Research Brief (Best-Effort)",
        "",
        "## Confidence",
        "Low — budget exhausted before complete coverage",
        "",
        "## Caveats",
        "- Only 2 of 5 sources were fully analyzed",
        "- Recent API changes may affect findings",
        "",
        "## Gaps",
        "- No official documentation for library X was located",
        "",
        "## Continuation Recommendation",
        "Extend budget by 5 searches to cover library X docs and latest changelog",
      ].join("\n"),
    );

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    const destDir = join(workDir, "docs", "exhausted-research");
    await cmdOpts.handler(`promote ${run.identity.id} --to ${destDir}`, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain(destDir);
    expect(output).toContain("brief.md");

    // Verify the promoted brief preserves best-effort labeling
    const promoted = readFileSync(join(destDir, "brief.md"), "utf-8");
    expect(promoted).toContain("BEST-EFFORT");
    expect(promoted).toContain("budget_exhausted");
    expect(promoted).toContain("Low — budget exhausted");
    expect(promoted).toContain("Caveats");
    expect(promoted).toContain("Only 2 of 5 sources");
    expect(promoted).toContain("Gaps");
    expect(promoted).toContain("Continuation Recommendation");
  });

  it("excludes raw diagnostics and raw content from promoted package", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Content exclusion test");
    updateStatus(workDir, run.identity.id, "completed");

    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "brief.md"), "# Brief\nContent");

    // Write some diagnostics/raw content that should NOT be promoted
    const rawDir = join(runDir, "diagnostics", "raw");
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, "model-response-1.txt"), "Raw model response");
    writeFileSync(join(rawDir, "fetched-page.html"), "<html>raw fetched content</html>");

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    const destDir = join(workDir, "docs", "clean-promo");
    await cmdOpts.handler(`promote ${run.identity.id} --to ${destDir}`, ctx);

    // Verify only brief.md and appendix.md exist in the promoted package
    const promotedFiles = readdirSync(destDir);
    expect(promotedFiles).toContain("brief.md");
    expect(promotedFiles).toContain("appendix.md");
    expect(promotedFiles).not.toContain("diagnostics");
    expect(promotedFiles).not.toContain("raw");

    // Verify the appendix does not contain raw model response content
    const appendix = readFileSync(join(destDir, "appendix.md"), "utf-8");
    expect(appendix).not.toContain("Raw model response");
    expect(appendix).not.toContain("raw fetched content");
  });

  it("overwrites existing files with --force", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Force overwrite test");
    updateStatus(workDir, run.identity.id, "completed");

    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "brief.md"), "# New content");

    // Pre-create destination with old content
    const destDir = join(workDir, "docs");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "brief.md"), "# Old content");

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler(`promote ${run.identity.id} --to ${destDir} --force`, ctx);

    const output = mockLog.join("\n");
    expect(output).not.toContain("Error");
    expect(output).toContain(destDir);
    expect(output).toContain("brief.md");

    // Verify old content was overwritten with new
    const promoted = readFileSync(join(destDir, "brief.md"), "utf-8");
    expect(promoted).toContain("New content");
    expect(promoted).not.toContain("Old content");
  });

  it("shows error for unknown run ID", async () => {
    const workDir = makeWorkDir();
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    await cmdOpts.handler("promote nonexistent-id --to /tmp/out", ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Error");
    expect(output).toContain("not found");
  });

  it("shows error when brief.md is missing from a promotable run", async () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    const pi = mockExtensionAPI();
    deepresearchEntryPoint(pi as any);

    const run = createRun(workDir, "Missing brief test");
    updateStatus(workDir, run.identity.id, "completed");

    // Don't write brief.md — it's missing
    const runDir = join(workDir, ".pi", "research", "runs", run.identity.id);
    mkdirSync(runDir, { recursive: true });

    const cmdOpts = pi.registerCommand.mock.calls[0][1];
    const mockLog: string[] = [];
    const ctx = {
      cwd: workDir,
      print: (...args: string[]) => {
        mockLog.push(args.join(" "));
      },
    };

    const destDir = join(workDir, "docs");
    await cmdOpts.handler(`promote ${run.identity.id} --to ${destDir}`, ctx);

    const output = mockLog.join("\n");
    expect(output).toContain("Error");
    expect(output).toContain("no brief.md");
  });

});
