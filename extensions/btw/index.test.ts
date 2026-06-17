import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────

function createMockPi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
  };
}

function createMockCtx(overrides = {}) {
  return {
    ui: { notify: vi.fn() },
    cwd: "/tmp/test-cwd",
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
    it("calls the handler with empty args and receives a notification", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    });

    it("no-args response is distinct from the question response", async () => {
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

      const msgNoArgs = ctxNoArgs.ui.notify.mock.calls[0][0];
      const msgWithQuestion = ctxWithQuestion.ui.notify.mock.calls[0][0];

      expect(msgNoArgs).not.toBe(msgWithQuestion);
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

      // Quoted text should be treated as a question (not no-args)
      expect(ctx.ui.notify).toHaveBeenCalledWith("BTW query is not yet implemented.");
    });

    it("passes unquoted text through to the handler", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("what about X", ctx);

      // Unquoted text should be treated as a question (not no-args)
      expect(ctx.ui.notify).toHaveBeenCalledWith("BTW query is not yet implemented.");
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

    it("registers command when PI_BTW_CHILD is 'true' (not '1')", async () => {
      process.env.PI_BTW_CHILD = "true";
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();

      btwExtension(pi);

      // Guard uses strict equality === '1', so 'true' should NOT activate it
      expect(pi.registerCommand).toHaveBeenCalledTimes(1);
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

      expect(ctx.ui.notify).toHaveBeenCalledWith("BTW Review is not yet implemented.");
    });

    it("returns a placeholder for the query path", async () => {
      const { default: btwExtension } = await import("./index");
      const pi = createMockPi();
      const ctx = createMockCtx();

      btwExtension(pi);
      const handler = pi.registerCommand.mock.calls[0][1].handler;

      await handler("what about X?", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith("BTW query is not yet implemented.");
    });

    it("placeholder messages indicate the feature is not yet implemented", async () => {
      const { default: btwExtension } = await import("./index");
      const piReview = createMockPi();
      const piQuery = createMockPi();
      const ctxReview = createMockCtx();
      const ctxQuery = createMockCtx();

      btwExtension(piReview);
      btwExtension(piQuery);

      const handlerReview = piReview.registerCommand.mock.calls[0][1].handler;
      const handlerQuery = piQuery.registerCommand.mock.calls[0][1].handler;

      await handlerReview("", ctxReview);
      await handlerQuery("question", ctxQuery);

      expect(ctxReview.ui.notify.mock.calls[0][0].toLowerCase()).toContain("not yet implemented");
      expect(ctxQuery.ui.notify.mock.calls[0][0].toLowerCase()).toContain("not yet implemented");
    });
  });
});
