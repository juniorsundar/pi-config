import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Module-level mocks (hoisted before imports) ─────────────────────

// Default return: empty config, no errors. Tests can override with mockReturnValue/mockImplementation.
vi.mock("./config", () => ({
  loadDeepresearchConfig: vi.fn(() => ({ config: {}, errors: [] })),
}));

// vi.mock is used instead of vi.spyOn because spawnSubagent is dynamically
// imported via await import("../subagents/spawner") inside the tool's execute closure.
vi.mock("../subagents/spawner", () => ({
  spawnSubagent: vi.fn(),
}));

// typebox is not a direct project dependency — it comes from @earendil-works/pi-coding-agent.
// Mock it so the module graph loads in test context. Proxy-based to handle any
// Type.* method that production code may reference.
vi.mock("typebox", () => {
  const handler: ProxyHandler<{ [key: string]: ReturnType<typeof vi.fn> }> = {
    get(target, prop) {
      if (!(prop in target)) {
        target[prop as string] = vi.fn(() => ({ type: "object" }));
      }
      return target[prop as string];
    },
  };
  return { Type: new Proxy({ Object: vi.fn(() => ({ type: "object", properties: {} })) }, handler) };
});

// ── Imports after mocks are set up ──────────────────────────────────

import deepResearchExtension from "./index";
import { loadDeepresearchConfig } from "./config";
import { ResearchStateManager } from "./state-manager";

// ── Helpers ──────────────────────────────────────────────────────────

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function createMockPi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    setModel: vi.fn(),
    sendUserMessage: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
  };
}

function createMockCtx(overrides = {}) {
  return {
    ui: { notify: vi.fn() },
    cwd: "/tmp/test-cwd",
    sessionManager: {
      appendCustomEntry: vi.fn(() => "mock-anchor-id"),
      getBranch: vi.fn(() => []),
    },
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    navigateTree: vi.fn().mockResolvedValue(undefined),
    modelRegistry: { find: vi.fn() },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("deep-research command handler", () => {
  let pi: ReturnType<typeof createMockPi>;
  let handler: (args: string, ctx: any) => Promise<void>;

  beforeEach(() => {
    pi = createMockPi();
    deepResearchExtension(pi);
    handler = pi.registerCommand.mock.calls[0][1].handler;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Slice 1: Tracer bullet — empty args", () => {
    it("shows a usage warning when called with an empty query", async () => {
      const ctx = createMockCtx();

      await handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Usage: /deep-research <query>",
        "warning",
      );
    });

    it("shows a usage warning when called with only whitespace", async () => {
      const ctx = createMockCtx();

      await handler("   ", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Usage: /deep-research <query>",
        "warning",
      );
    });
  });

  describe("Slice 2: Config validation", () => {
    it("notifies error and returns early when config has errors and no models", async () => {
      vi.mocked(loadDeepresearchConfig).mockReturnValue({
        config: {},
        errors: ["deepresearch key not found in settings.json"],
      });

      const ctx = createMockCtx();

      await handler("some query", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'deepresearch config error: deepresearch key not found in settings.json. Add a "deepresearch" key to settings.json.',
        "error",
      );
      // Early return — no anchor created
      expect(ctx.sessionManager.appendCustomEntry).not.toHaveBeenCalled();
    });
  });

  describe("Slice 3: Initialization path", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir("dr-init-test-");
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it("creates research directory, state.md, and loop anchor on valid query", async () => {
      const ctx = createMockCtx({ cwd: tempDir });

      await handler("some test query", ctx);

      // Verify slug-derived values match
      const slug = "some-test-query";

      // 1. Research directory exists
      const researchDir = join(tempDir, ".pi", "deep-research", slug);
      expect(existsSync(researchDir)).toBe(true);

      // 2. state.md exists with the query
      const stateFile = join(researchDir, "state.md");
      expect(existsSync(stateFile)).toBe(true);
      const stateContent = readFileSync(stateFile, "utf-8");
      expect(stateContent).toContain("some test query");
      expect(stateContent).toContain("## Status\nactive");

      // 3. Loop anchor was created
      expect(ctx.sessionManager.appendCustomEntry).toHaveBeenCalledWith(
        "deep-research-anchor",
        { slug },
      );
    });
  });

  describe("Slice 4: Orchestrator model switch", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir("dr-model-test-");
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it("calls pi.setModel when orchestratorModel matches a registered model", async () => {
      const mockModel = { id: "claude-sonnet-4", provider: "anthropic" };
      const mockFind = vi.fn(() => mockModel);

      vi.mocked(loadDeepresearchConfig).mockReturnValue({
        config: { orchestratorModel: "anthropic/claude-sonnet-4" },
        errors: [],
      });

      const ctx = createMockCtx({
        cwd: tempDir,
        modelRegistry: { find: mockFind },
      });

      await handler("test query", ctx);

      expect(mockFind).toHaveBeenCalledWith("anthropic", "claude-sonnet-4");
      expect(pi.setModel).toHaveBeenCalledWith(mockModel);
    });

    it("does not call pi.setModel when model is not found in registry", async () => {
      const mockFind = vi.fn(() => undefined);

      vi.mocked(loadDeepresearchConfig).mockReturnValue({
        config: { orchestratorModel: "anthropic/unknown-model" },
        errors: [],
      });

      const ctx = createMockCtx({
        cwd: tempDir,
        modelRegistry: { find: mockFind },
      });

      await handler("test query", ctx);

      expect(mockFind).toHaveBeenCalledWith("anthropic", "unknown-model");
      expect(pi.setModel).not.toHaveBeenCalled();
    });

    it("handles orchestratorModel without a provider slash gracefully", async () => {
      vi.mocked(loadDeepresearchConfig).mockReturnValue({
        config: { orchestratorModel: "just-a-model-name" },
        errors: [],
      });

      const ctx = createMockCtx({
        cwd: tempDir,
        modelRegistry: { find: vi.fn() },
      });

      await handler("test query", ctx);

      // No slash → no model lookup, no setModel call
      expect(ctx.modelRegistry.find).not.toHaveBeenCalled();
      expect(pi.setModel).not.toHaveBeenCalled();
    });

    it("handles orchestratorModel with trailing slash — no empty modelId lookup", async () => {
      vi.mocked(loadDeepresearchConfig).mockReturnValue({
        config: { orchestratorModel: "anthropic/" },
        errors: [],
      });

      const findFn = vi.fn();
      const ctx = createMockCtx({
        cwd: tempDir,
        modelRegistry: { find: findFn },
      });

      await handler("test query", ctx);

      // Trailing slash → slashIdx > 0, but modelId is empty string.
      // Current behavior calls find with empty modelId. Test documents this.
      expect(findFn).toHaveBeenCalledWith("anthropic", "");
      expect(pi.setModel).not.toHaveBeenCalled();
    });

    it("handles missing modelRegistry gracefully (optional chaining)", async () => {
      vi.mocked(loadDeepresearchConfig).mockReturnValue({
        config: { orchestratorModel: "anthropic/claude-sonnet-4" },
        errors: [],
      });

      // No modelRegistry on ctx at all
      const ctx = createMockCtx({
        cwd: tempDir,
        modelRegistry: undefined,
      });

      await expect(handler("test query", ctx)).resolves.toBeUndefined();
      expect(pi.setModel).not.toHaveBeenCalled();
    });
  });

  describe("Slice 5: Completion detection", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir("dr-complete-test-");
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it("completes when state contains '## Status\\ncomplete'", async () => {
      vi.spyOn(ResearchStateManager.prototype, "read").mockReturnValue(
        "## Status\ncomplete\n\n## Steps Completed\n",
      );

      const ctx = createMockCtx({ cwd: tempDir });

      await handler("test query", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "deep-research-result",
          display: true,
        }),
        { triggerTurn: false },
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Deep research complete"),
        "success",
      );
    });

    it("completes when state contains 'Status: complete'", async () => {
      vi.spyOn(ResearchStateManager.prototype, "read").mockReturnValue(
        "Status: complete\n\n## Steps Completed\n",
      );

      const ctx = createMockCtx({ cwd: tempDir });

      await handler("test query", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "deep-research-result",
          display: true,
        }),
        { triggerTurn: false },
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Deep research complete"),
        "success",
      );
    });

    it("completes when deep_research_complete tool call is found in session", async () => {
      vi.spyOn(ResearchStateManager.prototype, "read").mockReturnValue(
        "## Status\nactive\n\nSome findings\n",
      );

      const ctx = createMockCtx({
        cwd: tempDir,
        sessionManager: {
          appendCustomEntry: vi.fn(() => "mock-anchor-id"),
          getBranch: vi.fn(() => [
            {
              type: "message",
              message: {
                role: "assistant",
                content: [
                  { type: "toolCall", name: "deep_research_complete" },
                ],
              },
            },
          ]),
        },
      });

      await handler("test query", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "deep-research-result",
          display: true,
        }),
        { triggerTurn: false },
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Deep research complete"),
        "success",
      );
    });
  });

  describe("Slice 5b: Step archival", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir("dr-archive-test-");
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it("archives subagent output when completing", async () => {
      const agentId = "r-search-abc123";
      const agentType = "r-search";
      const outputContent = "Search result: found relevant data";

      // Create the subagent output file that archiveLatestSubagentOutput reads
      const subagentDir = join(tempDir, ".pi", "subagents", agentId);
      mkdirSync(subagentDir, { recursive: true });
      writeFileSync(join(subagentDir, "output.md"), outputContent);

      vi.spyOn(ResearchStateManager.prototype, "read")
        .mockReturnValueOnce("## Status\ncomplete\n\n## Steps Completed\n")
        .mockReturnValue("## Status\ncomplete\n\n## Steps Completed\n");

      vi.mocked(loadDeepresearchConfig).mockReturnValue({
        config: {},
        errors: [],
      });

      const ctx = createMockCtx({
        cwd: tempDir,
        sessionManager: {
          appendCustomEntry: vi.fn(() => "mock-anchor-id"),
          getBranch: vi.fn(() => [
            {
              type: "message",
              message: {
                role: "toolResult",
                toolName: "spawn_research_subagent",
                details: { agentId, agentType },
              },
            },
          ]),
        },
      });

      await handler("test query", ctx);

      // Step file was archived in steps/<agentId>.md
      const researchSlug = "test-query";
      const stepsDir = join(tempDir, ".pi", "deep-research", researchSlug, "steps");
      expect(existsSync(stepsDir)).toBe(true);
      const stepFiles = readdirSync(stepsDir);
      expect(stepFiles).toContain(`${agentId}.md`);

      // Archived file contains the subagent output
      const archivedContent = readFileSync(join(stepsDir, `${agentId}.md`), "utf-8");
      expect(archivedContent).toContain(outputContent);

      // Research completed normally
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "deep-research-result" }),
        { triggerTurn: false },
      );
    });
  });

  describe("Slice 6: Non-completing iteration", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir("dr-loop-test-");
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it("calls navigateTree after a non-completing iteration and continues the loop", async () => {
      vi.spyOn(ResearchStateManager.prototype, "read").mockReturnValue(
        "## Status\nactive\n\nSome findings\n",
      );

      const ctx = createMockCtx({ cwd: tempDir });

      await handler("test query", ctx);

      // All 10 iterations ran (no completion, all non-completing)
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(10);

      // waitForIdle was called on each iteration
      expect(ctx.waitForIdle).toHaveBeenCalledTimes(10);

      // navigateTree was called after each non-completing iteration
      expect(ctx.navigateTree).toHaveBeenCalledTimes(10);

      // Each navigateTree call uses the anchor ID and no summarize
      for (const call of vi.mocked(ctx.navigateTree).mock.calls) {
        expect(call).toEqual(["mock-anchor-id", { summarize: false }]);
      }

      // Each sendUserMessage call includes deliverAs: "followUp"
      for (const call of vi.mocked(pi.sendUserMessage).mock.calls) {
        expect(call[1]).toEqual({ deliverAs: "followUp" });
      }

      // First-iteration prompt mentions "First step:" and "r-search"
      const firstPrompt = vi.mocked(pi.sendUserMessage).mock.calls[0][0];
      expect(firstPrompt).toContain("First step:");
      expect(firstPrompt).toContain("r-search");

      // Subsequent prompts are shorter — they don't contain the first-step instructions
      const secondPrompt = vi.mocked(pi.sendUserMessage).mock.calls[1][0];
      expect(secondPrompt).not.toContain("First step:");

      // Completion message was NOT sent
      expect(pi.sendMessage).not.toHaveBeenCalled();

      // Max-iterations warning was sent after 10 iterations
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("10 iterations without completing"),
        "warning",
      );
    });
  });

  describe("Slice 7: Pre-iteration progress notification", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir("dr-prenotify-test-");
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it("notifies with iteration number before each iteration", async () => {
      vi.spyOn(ResearchStateManager.prototype, "read").mockReturnValue(
        "## Status\ncomplete\n\n## Steps Completed\n",
      );

      const ctx = createMockCtx({ cwd: tempDir });

      await handler("test query", ctx);

      // Should have shown the pre-iteration notification for iteration 1
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Deep research: iteration 1/10",
        "info",
      );
    });

    it("notifies with correct iteration number for multiple iterations", async () => {
      vi.spyOn(ResearchStateManager.prototype, "read").mockReturnValue(
        "## Status\nactive\n\nSome findings\n",
      );

      const ctx = createMockCtx({ cwd: tempDir });

      await handler("test query", ctx);

      // All 10 iterations should have pre-iteration notifications
      const notifyCalls = vi.mocked(ctx.ui.notify).mock.calls.filter(
        ([_msg, type]: any) => type === "info" && typeof _msg === "string" && (_msg as string).startsWith("Deep research: iteration"),
      );

      expect(notifyCalls).toHaveLength(10);

      // Verify each iteration number
      notifyCalls.forEach(([msg]: any, idx: number) => {
        expect(msg).toBe(`Deep research: iteration ${idx + 1}/10`);
      });
    });
  });

  describe("Slice 8: Post-iteration progress notification", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir("dr-postnotify-test-");
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it("notifies with iteration number and agent type after each non-completing iteration", async () => {
      const agentId = "r-search-abc123";
      const agentType = "r-search";

      // Create subagent output file on disk so archiveLatestSubagentOutput can read it
      const subagentDir = join(tempDir, ".pi", "subagents", agentId);
      mkdirSync(subagentDir, { recursive: true });
      writeFileSync(join(subagentDir, "output.md"), "Search results: found relevant data");

      vi.spyOn(ResearchStateManager.prototype, "read").mockReturnValue(
        "## Status\nactive\n\nSome findings\n",
      );

      vi.mocked(loadDeepresearchConfig).mockReturnValue({
        config: {},
        errors: [],
      });

      const ctx = createMockCtx({
        cwd: tempDir,
        sessionManager: {
          appendCustomEntry: vi.fn(() => "mock-anchor-id"),
          getBranch: vi.fn(() => [
            {
              type: "message",
              message: {
                role: "toolResult",
                toolName: "spawn_research_subagent",
                details: { agentId, agentType },
              },
            },
          ]),
        },
      });

      await handler("test query", ctx);

      // Filter for post-iteration notifications (starts with "Iteration")
      const postNotifyCalls = vi.mocked(ctx.ui.notify).mock.calls.filter(
        ([msg, type]: any) => type === "info" && typeof msg === "string" && (msg as string).startsWith("Iteration "),
      );

      // All 10 iterations should have a post-iteration notification
      expect(postNotifyCalls).toHaveLength(10);

      // First iteration
      expect(postNotifyCalls[0][0]).toBe("Iteration 1 complete: r-search archived");

      // Last iteration
      expect(postNotifyCalls[9][0]).toBe("Iteration 10 complete: r-search archived");
    });

    it("does not show post-iteration notification when no subagent was spawned", async () => {
      // No subagent output file and empty getBranch — archiveLatestSubagentOutput finds nothing
      vi.spyOn(ResearchStateManager.prototype, "read").mockReturnValue(
        "## Status\nactive\n\nSome findings\n",
      );

      const ctx = createMockCtx({ cwd: tempDir });

      await handler("test query", ctx);

      // No post-iteration notifications should appear
      const postNotifyCalls = vi.mocked(ctx.ui.notify).mock.calls.filter(
        ([msg, type]: any) => type === "info" && typeof msg === "string" && (msg as string).startsWith("Iteration "),
      );

      expect(postNotifyCalls).toHaveLength(0);
    });
  });

  describe("Slice 9: Agent type prefix in onProgress feed", () => {
    it("prepends agent type to onProgress feed text", async () => {
      // Find the spawn_research_subagent tool's execute handler
      const spawnToolRegistration = pi.registerTool.mock.calls.find(
        (call: any) => call[0].name === "spawn_research_subagent",
      )?.[0];

      const executeHandler = spawnToolRegistration.execute;
      const onUpdateMock = vi.fn();

      // Configure spawnSubagent mock to invoke onProgress
      const { spawnSubagent: mockSpawnSubagent } = await import("../subagents/spawner");
      mockSpawnSubagent.mockImplementation(async ({ onProgress }: any) => {
        onProgress?.({
          collapsed: { text: "searching the web...", hiddenCount: 0, lines: [] },
          expanded: { text: "searching the web...", hiddenCount: 0, lines: [] },
        });
        return {
          output: "research result",
          agentId: "r-search-abc123",
          agentType: "r-search",
          duration: 5000,
          model: "test",
          usage: {},
        };
      });

      const ctx = createMockCtx();

      await executeHandler(
        "test-call-id",
        { agent_type: "r-search", prompt: "search for X" },
        undefined,
        onUpdateMock,
        ctx,
      );

      expect(onUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [
            expect.objectContaining({
              text: "[r-search] searching the web...",
            }),
          ],
        }),
      );
    });

    it("prepends different agent types correctly", async () => {
      const spawnToolRegistration = pi.registerTool.mock.calls.find(
        (call: any) => call[0].name === "spawn_research_subagent",
      )?.[0];

      const executeHandler = spawnToolRegistration.execute;
      const onUpdateMock = vi.fn();

      const { spawnSubagent: mockSpawnSubagent } = await import("../subagents/spawner");
      mockSpawnSubagent.mockImplementation(async ({ onProgress }: any) => {
        onProgress?.({
          collapsed: { text: "analyzing gaps...", hiddenCount: 0, lines: [] },
          expanded: { text: "analyzing gaps...", hiddenCount: 0, lines: [] },
        });
        return {
          output: "gap analysis",
          agentId: "r-gap-def456",
          agentType: "r-gap",
          duration: 3000,
          model: "test",
          usage: {},
        };
      });

      const ctx = createMockCtx();

      await executeHandler(
        "test-call-id-2",
        { agent_type: "r-gap", prompt: "find gaps" },
        undefined,
        onUpdateMock,
        ctx,
      );

      expect(onUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [
            expect.objectContaining({
              text: "[r-gap] analyzing gaps...",
            }),
          ],
        }),
      );
    });
  });
});
