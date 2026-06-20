import { describe, expect, it, afterEach, vi } from "vitest";

const toolFactoryCalls = vi.hoisted(() => ({
  writeCwds: [] as string[],
  editCwds: [] as string[],
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createWriteTool: (cwd: string) => {
    toolFactoryCalls.writeCwds.push(cwd);
    return {
      label: "write",
      description: "builtin write",
      parameters: {},
      execute: async () => ({ content: [{ type: "text", text: "wrote" }], details: undefined }),
    };
  },
  createEditTool: (cwd: string) => {
    toolFactoryCalls.editCwds.push(cwd);
    return {
      label: "edit",
      description: "builtin edit",
      parameters: {},
      prepareArguments: (input: unknown) => input,
      execute: async () => ({ content: [{ type: "text", text: "edited" }], details: undefined }),
    };
  },
}));

vi.mock("@earendil-works/pi-tui", () => ({
  Box: class {
    children: any[] = [];
    addChild(child: any) { this.children.push(child); }
  },
  Container: class {
    children: any[] = [];
    addChild(child: any) { this.children.push(child); }
  },
  Text: class {
    text: string;
    constructor(text = "", ..._args: unknown[]) { this.text = text; }
    setText(text: string) { this.text = text; }
  },
  Key: { ctrlAlt: (key: string) => `ctrl+alt+${key}` },
  matchesKey: () => false,
  truncateToWidth: (value: string) => value,
  visibleWidth: (value: string) => value.length,
}));

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import mutationExtension from "./index";
import confirmMutatingTools from "../confirm-mutating-tools";
import { setCurrentProfile } from "../lib/permission-policy";

function makePi() {
  const handlers: Record<string, Function[]> = {};
  const messages: any[] = [];
  const entries: any[] = [];
  const tools: any[] = [];
  const pi = {
    on: (eventName: string, handler: Function) => {
      handlers[eventName] ??= [];
      handlers[eventName]!.push(handler);
    },
    registerTool: (tool: any) => tools.push(tool),
    registerMessageRenderer: () => undefined,
    registerCommand: () => undefined,
    registerShortcut: () => undefined,
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
    sendMessage: (message: unknown) => messages.push(message),
  };
  return { pi: pi as any, handlers, messages, entries, tools };
}

function makeTheme() {
  return {
    fg: (_name: string, text: string) => text,
    bg: (_name: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function collectText(node: any): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.children)) return node.children.map(collectText).join("\n");
  return "";
}

function makeInteractiveCtx(cwd: string) {
  let terminalHandler: ((data: string) => any) | undefined;
  const ctx = {
    cwd,
    hasUI: true,
    sessionManager: { getBranch: () => [] },
    ui: {
      confirm: async () => {
        throw new Error("unexpected confirm fallback");
      },
      select: async () => undefined,
      notify: () => undefined,
      custom: vi.fn(async () => undefined),
      onTerminalInput: vi.fn((h: Function) => {
        terminalHandler = h as any;
        return () => { terminalHandler = undefined; };
      }),
    },
  };
  return { ctx, press: (key: string) => terminalHandler?.(key) };
}

describe("mutation tool_call approval wiring", () => {
  afterEach(() => {
    setCurrentProfile("ask");
    delete process.env.PI_SUBAGENT_CHILD;
    toolFactoryCalls.writeCwds.length = 0;
    toolFactoryCalls.editCwds.length = 0;
  });

  it("bypasses edit/write diff confirmation in yolo profile", async () => {
    setCurrentProfile("yolo");
    const { pi, handlers } = makePi();
    mutationExtension(pi);

    const result = await handlers.tool_call![0]!(
      { toolName: "write", input: { path: "src/app.ts", content: "ok" } },
      { cwd: process.cwd(), hasUI: false, ui: {} },
    );

    expect(result).toBeUndefined();
  });

  it("blocks edit/write when confirmation is required but no UI is available", async () => {
    setCurrentProfile("ask");
    const { pi, handlers } = makePi();
    mutationExtension(pi);

    const result = await handlers.tool_call![0]!(
      { toolName: "edit", input: { path: "src/app.ts", edits: [] } },
      { cwd: process.cwd(), hasUI: false, ui: {} },
    );

    expect(result).toMatchObject({ block: true });
    expect(result.reason).toContain("diff-preview confirmation");
  });

  it("allows subagent children through without interactive edit/write gates", async () => {
    process.env.PI_SUBAGENT_CHILD = "1";
    setCurrentProfile("ask");
    const { pi, handlers } = makePi();
    mutationExtension(pi);

    const result = await handlers.tool_call![0]!(
      { toolName: "write", input: { path: "src/app.ts", content: "ok" } },
      { cwd: process.cwd(), hasUI: false, ui: {} },
    );

    expect(result).toBeUndefined();
  });

  it("bypasses /tmp edit/write mutations", async () => {
    setCurrentProfile("ask");
    const { pi, handlers } = makePi();
    mutationExtension(pi);

    const result = await handlers.tool_call![0]!(
      { toolName: "write", input: { path: "/tmp/pi-mutation-test.txt", content: "ok" } },
      { cwd: process.cwd(), hasUI: false, ui: {} },
    );

    expect(result).toBeUndefined();
  });

  it("registers write/edit renderCall overrides to replace native previews", () => {
    const { pi, tools } = makePi();
    mutationExtension(pi);

    const writeTool = tools.find((tool) => tool.name === "write");
    const editTool = tools.find((tool) => tool.name === "edit");

    expect(writeTool?.renderCall).toEqual(expect.any(Function));
    expect(editTool?.renderCall).toEqual(expect.any(Function));
    expect(writeTool?.execute).toEqual(expect.any(Function));
    expect(editTool?.execute).toEqual(expect.any(Function));
  });

  it("delegates built-in execution using the tool context cwd", async () => {
    const cwd = mkdtempSync(join(process.cwd(), ".tmp-mutation-test-"));
    try {
      const { pi, tools } = makePi();
      mutationExtension(pi);

      const writeTool = tools.find((tool) => tool.name === "write");
      await writeTool.execute("call-1", { path: "target.txt", content: "ok" }, undefined, undefined, { cwd });

      expect(toolFactoryCalls.writeCwds.at(-1)).toBe(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps edit renderCall preview stable after execution mutates the file", () => {
    const cwd = mkdtempSync(join(process.cwd(), ".tmp-mutation-test-"));
    try {
      const filePath = join(cwd, "target.txt");
      writeFileSync(filePath, "# Project\nold second line\n\nBody\n", "utf8");
      const { pi, tools } = makePi();
      mutationExtension(pi);

      const editTool = tools.find((tool) => tool.name === "edit");
      const args = {
        path: "target.txt",
        edits: [{ oldText: "old second line", newText: "new second line" }],
      };
      const context = { cwd, state: {}, executionStarted: false };

      const before = editTool.renderCall(args, makeTheme(), context);
      expect(collectText(before)).toContain("new second line");
      expect(collectText(before)).not.toContain("Unable to safely preview");

      writeFileSync(filePath, "# Project\nnew second line\n\nBody\n", "utf8");
      context.executionStarted = true;
      const after = editTool.renderCall(args, makeTheme(), context);

      expect(collectText(after)).toContain("new second line");
      expect(collectText(after)).not.toContain("Unable to safely preview");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses inline diff approval via onTerminalInput to unblock write", async () => {
    setCurrentProfile("ask");
    const cwd = mkdtempSync(join(process.cwd(), ".tmp-mutation-test-"));
    try {
      writeFileSync(join(cwd, "target.txt"), "before\n", "utf8");
      const { pi, handlers } = makePi();
      const { ctx, press } = makeInteractiveCtx(cwd);
      mutationExtension(pi);
      await handlers.session_start![0]!({ reason: "startup" }, ctx);

      const toolCallPromise = handlers.tool_call![0]!(
        { toolName: "write", input: { path: "target.txt", content: "after\n" } },
        ctx,
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(ctx.ui.custom).not.toHaveBeenCalled();
      expect(press("a")).toEqual({ consume: true });

      await expect(toolCallPromise).resolves.toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not emit an approved verdict if the file changes before approval", async () => {
    setCurrentProfile("ask");
    const cwd = mkdtempSync(join(process.cwd(), ".tmp-mutation-test-"));
    try {
      writeFileSync(join(cwd, "target.txt"), "before\n", "utf8");
      const { pi, handlers, messages } = makePi();
      const { ctx, press } = makeInteractiveCtx(cwd);
      mutationExtension(pi);
      await handlers.session_start![0]!({ reason: "startup" }, ctx);

      const toolCallPromise = handlers.tool_call![0]!(
        { toolName: "write", input: { path: "target.txt", content: "after\n" } },
        ctx,
      );

      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(join(cwd, "target.txt"), "changed elsewhere\n", "utf8");
      expect(press("a")).toEqual({ consume: true });

      await expect(toolCallPromise).resolves.toMatchObject({ block: true, reason: "Blocked by user" });
      expect(messages.some((m: any) => m.customType === "diff-verdict" && m.details?.verdict === "approved")).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("blocks a second mutation while another approval is pending", async () => {
    setCurrentProfile("ask");
    const cwd = mkdtempSync(join(process.cwd(), ".tmp-mutation-test-"));
    try {
      writeFileSync(join(cwd, "first.txt"), "one\n", "utf8");
      writeFileSync(join(cwd, "second.txt"), "two\n", "utf8");
      const { pi, handlers } = makePi();
      const { ctx, press } = makeInteractiveCtx(cwd);
      mutationExtension(pi);
      await handlers.session_start![0]!({ reason: "startup" }, ctx);

      const first = handlers.tool_call![0]!(
        { toolName: "write", input: { path: "first.txt", content: "one changed\n" } },
        ctx,
      );
      await new Promise((r) => setTimeout(r, 10));

      const second = await handlers.tool_call![0]!(
        { toolName: "write", input: { path: "second.txt", content: "two changed\n" } },
        ctx,
      );
      expect(second).toMatchObject({ block: true, reason: "Blocked by user" });

      expect(press("d")).toEqual({ consume: true });
      await expect(first).resolves.toMatchObject({ block: true, reason: "Blocked by user" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses inline diff denial via onTerminalInput to block write", async () => {
    setCurrentProfile("ask");
    const cwd = mkdtempSync(join(process.cwd(), ".tmp-mutation-test-"));
    try {
      writeFileSync(join(cwd, "target.txt"), "before\n", "utf8");
      const { pi, handlers } = makePi();
      const { ctx, press } = makeInteractiveCtx(cwd);
      mutationExtension(pi);
      await handlers.session_start![0]!({ reason: "startup" }, ctx);

      const toolCallPromise = handlers.tool_call![0]!(
        { toolName: "write", input: { path: "target.txt", content: "after\n" } },
        ctx,
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(ctx.ui.custom).not.toHaveBeenCalled();
      expect(press("d")).toEqual({ consume: true });

      await expect(toolCallPromise).resolves.toMatchObject({ block: true, reason: "Blocked by user" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("leaves edit/write detached from confirm-mutating-tools", async () => {
    const { pi, handlers } = makePi();
    confirmMutatingTools(pi);

    const result = await handlers.tool_call![0]!(
      { toolName: "write", input: { path: "src/app.ts", content: "ok" } },
      { cwd: process.cwd(), hasUI: false, ui: {} },
    );

    expect(result).toBeUndefined();
  });
});
