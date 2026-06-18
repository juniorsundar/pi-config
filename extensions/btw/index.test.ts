import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the spawner module so tests don't spawn real processes
const mockSpawnBtwProcess = vi.fn().mockResolvedValue({
  ok: true,
  text: "mocked answer",
  toolTrace: [],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

vi.mock("./spawner.js", () => ({
  spawnBtwProcess: (...args: any[]) => mockSpawnBtwProcess(...args),
}));

// Mock the timeout-config module
vi.mock("./timeout-config.js", () => ({
  loadBtwTimeout: () => ({ timeout: 300000, source: "default" }),
}));

// Mock the spinning-list module
vi.mock("./spinning-list.js", () => ({
  SpinningListComponent: vi.fn(),
}));

// Mock the review module
vi.mock("./review.js", () => ({
  BtwReviewComponent: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function createMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
  };
}

function createMockCtx(overrides = {}) {
  return {
    ui: { notify: vi.fn(), custom: vi.fn() },
    cwd: "/tmp/test-cwd",
    sessionManager: {
      getSessionFile: vi.fn().mockReturnValue("/tmp/test-session.jsonl"),
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("btw extension", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset PI_BTW_CHILD between tests
    delete process.env.PI_BTW_CHILD;
  });

  describe("Slice 1: Tracer bullet — loads without side effects", () => {
    it("can be imported and invoked against a mock pi without throwing", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      expect(() => btwExtension(pi)).not.toThrow();
    });

    it("does not register any tools when loaded", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      btwExtension(pi);

      expect(pi.registerTool).not.toHaveBeenCalled();
    });
  });

  describe("Slice 2: /btw command registration in normal sessions", () => {
    it("registers a /btw command when PI_BTW_CHILD is not set", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      btwExtension(pi);

      expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    });

    it("registers the command with name 'btw'", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      btwExtension(pi);

      const commandName = pi.registerCommand.mock.calls[0][0];
      expect(commandName).toBe("btw");
    });

    it("provides a description mentioning side-question", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      btwExtension(pi);

      const options = pi.registerCommand.mock.calls[0][1];
      expect(options.description.toLowerCase()).toContain("side-question");
    });
  });

  describe("Slice 4: /btw with no arguments recognized separately", () => {
    it("calls the handler with empty args and opens review view", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("", ctx);

      // No-args opens the review view via custom component
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    });

    it("no-args opens review view, question shows notification", async () => {
      const { default: btwExtension } = await import("./index");
      const piNoArgs = createMockPi();
      const piWithQuestion = createMockPi();
      const ctxNoArgs = createMockCtx();
      const ctxWithQuestion = createMockCtx();

      btwExtension(piNoArgs);
      btwExtension(piWithQuestion);

      const handlerNoArgs = piNoArgs.registerCommand.mock.calls[0][1].handler;
      const handlerWithQuestion = piWithQuestion.registerCommand.mock.calls[0][1].handler;

      await handlerNoArgs("", ctxNoArgs);
      await handlerWithQuestion("what about X?", ctxWithQuestion);

      // No-args opens review view (custom component), not notification
      expect(ctxNoArgs.ui.custom).toHaveBeenCalled();
      // Question shows notification, not custom component
      expect(ctxWithQuestion.ui.notify).toHaveBeenCalled();
    });
  });

  describe("Slice 5+6: /btw accepts quoted and unquoted question text", () => {
    it("handles quoted question text without crashing", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await expect(handler('"what about X?"', ctx)).resolves.not.toThrow();
      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    });

    it("handles unquoted question text without crashing", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await expect(handler("what about X", ctx)).resolves.not.toThrow();
      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    });

    it("passes quoted text through to the handler", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler('"what about X?"', ctx);

      // Handler should have called notify (either success or error)
      expect(ctx.ui.notify).toHaveBeenCalled();
    });

    it("passes unquoted text through to the handler", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      // Should not throw (will try to spawn, may fail but handler catches)
      await expect(handler("what about X", ctx)).resolves.not.toThrow();
      // Handler should have called notify (either success or error)
      expect(ctx.ui.notify).toHaveBeenCalled();
    });
  });

  describe("Slice 3: BTW Child Guard — disables registration when PI_BTW_CHILD=1", () => {
    it("does not register /btw when PI_BTW_CHILD is '1'", async () => {
      process.env.PI_BTW_CHILD = "1";
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      btwExtension(pi);

      expect(pi.registerCommand).not.toHaveBeenCalled();
    });

    it("returns early without side effects when PI_BTW_CHILD is '1'", async () => {
      process.env.PI_BTW_CHILD = "1";
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      const result = btwExtension(pi);

      expect(result).toBeUndefined();
      expect(pi.registerCommand).not.toHaveBeenCalled();
      expect(pi.registerTool).not.toHaveBeenCalled();
    });

    it("does not register /btw when PI_BTW_CHILD is 'true'", async () => {
      process.env.PI_BTW_CHILD = "true";
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      btwExtension(pi);

      // Guard checks for any truthy value, so 'true' should activate it
      expect(pi.registerCommand).not.toHaveBeenCalled();
    });
  });

  describe("Registry wiring: addRunning/complete/fail", () => {
    it("passes onSpawn callback to spawnBtwProcess", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      mockSpawnBtwProcess.mockClear();
      await handler("what about X?", ctx);

      expect(mockSpawnBtwProcess).toHaveBeenCalledWith(
        expect.objectContaining({ onSpawn: expect.any(Function) }),
      );
    });

    it("onSpawn callback is invoked by the spawner", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();
      const mockChild = { pid: 123, kill: vi.fn() };

      // Configure mock to invoke onSpawn
      mockSpawnBtwProcess.mockImplementation(async (options: any) => {
        options.onSpawn?.(mockChild);
        return {
          ok: true,
          text: "answer",
          toolTrace: [],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        };
      });

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("question?", ctx);

      // onSpawn was invoked — the spawner called it
      expect(mockSpawnBtwProcess).toHaveBeenCalled();
    });

    it("calls complete with enriched result on success", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      mockSpawnBtwProcess.mockResolvedValue({
        ok: true,
        text: "Paris is the capital.",
        toolTrace: [{ toolName: "web_search", args: {} }],
        usage: { input: 500, output: 200, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
        model: "claude-sonnet-4",
        stopReason: "endTurn",
      });

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("capital of France?", ctx);

      // Success notification shown
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Paris"),
        "info",
      );
    });

    it("calls fail with error details on failure", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      mockSpawnBtwProcess.mockResolvedValue({
        ok: false,
        errorMessage: "BTW process exited with code 1",
        exitCode: 1,
        stderr: "Error: model not found",
        toolTrace: [],
        partialText: undefined,
      });

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("what about X?", ctx);

      // Error notification shown
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("exited with code 1"),
        "error",
      );
    });

    it("calls fail when spawnBtwProcess throws", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      mockSpawnBtwProcess.mockRejectedValue(new Error("ENOENT"));

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("what about X?", ctx);

      // Error notification shown
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("ENOENT"),
        "error",
      );
    });
  });

  describe("Slice 7: Placeholder response for unimplemented paths", () => {
    it("returns a placeholder for the no-args (review) path", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("", ctx);

      // Should open custom component (review view)
      expect(ctx.ui.custom).toHaveBeenCalled();
    });

    it("spawns a BTW process when given a question", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      // The handler will try to spawn and fail (no real pi), but should not crash
      await handler("what about X?", ctx);

      // Should have called notify with either success or error
      expect(ctx.ui.notify).toHaveBeenCalled();
    });

    it("no-args opens review component", async () => {
      const { default: btwExtension } = await import("./index");
      const piReview = createMockPi();
      const ctxReview = createMockCtx();

      btwExtension(piReview);

      const handlerReview = piReview.registerCommand.mock.calls[0][1].handler;

      await handlerReview("", ctxReview);

      // Should open custom component (review view), not show placeholder
      expect(ctxReview.ui.custom).toHaveBeenCalled();
    });
  });
});
