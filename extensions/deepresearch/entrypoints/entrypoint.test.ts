import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as statusModule from "../lifecycle/status";
import { registerDeepresearchTool } from "./tool";
import { registerResearchCommand } from "./command";
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
} {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    on: vi.fn(),
  };
}

/** Mock brain factory that returns a reachable brain for tests. */
function mockBrainFactory(): () => Promise<ResearchBrain> {
  return async () => ({
    generate: async (_prompt: string) => "ok",
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

// ── Status via /research command ──────────────────────────────────────────

describe("/research status command", () => {
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
