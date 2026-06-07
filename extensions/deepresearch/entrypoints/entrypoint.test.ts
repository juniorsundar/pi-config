import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as statusModule from "../lifecycle/status";

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
    deepresearchEntryPoint(pi as any);

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
    deepresearchEntryPoint(pi as any);

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
    deepresearchEntryPoint(pi as any);

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
    deepresearchEntryPoint(pi as any);

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
    deepresearchEntryPoint(pi as any);

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
    deepresearchEntryPoint(pi as any);

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
});
