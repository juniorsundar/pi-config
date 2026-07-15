import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module-level mocks (hoisted before imports) ─────────────────────
//
// Mock typebox to produce plain JSON schema objects that are easy to
// assert against. We need the real schema shape (type, optionality,
// description) for the web_fetch tool parameters.
vi.mock("typebox", () => {
  const Type = {
    Object: (properties: Record<string, unknown>, options?: Record<string, unknown>) => {
      // Properties with _optional: true are excluded from required (matching TypeBox)
      const allKeys = Object.keys(properties);
      const required = (options?.required as string[]) ??
        allKeys.filter((k) => !(properties[k] as Record<string, unknown>)?._optional);
      return {
        type: "object",
        properties,
        required,
        ...(options?.description && { description: options.description }),
      };
    },
    String: (options?: Record<string, unknown>) => ({
      type: "string",
      ...(options?.description && { description: options.description }),
    }),
    Number: (options?: Record<string, unknown>) => ({
      type: "number",
      ...(options?.description && { description: options.description }),
      ...(options?.minimum !== undefined && { minimum: options.minimum }),
      ...(options?.maximum !== undefined && { maximum: options.maximum }),
    }),
    Boolean: (options?: Record<string, unknown>) => ({
      type: "boolean",
      ...(options?.description && { description: options.description }),
      ...(options?.default !== undefined && { default: options.default }),
    }),
    Optional: (schema: unknown) => ({
      ...(schema as object),
      _optional: true,
    }),
    Unsafe: (schema: unknown) => schema,
  };
  return { Type };
});

// Mock @earendil-works/pi-ai/compat for StringEnum
vi.mock("@earendil-works/pi-ai/compat", () => ({
  StringEnum: (values: readonly string[], options?: Record<string, unknown>) => ({
    type: "string",
    enum: values,
    ...(options?.description && { description: options.description }),
  }),
}));

// ── Import module under test (after mocks are hoisted) ─────────────
// eslint-disable-next-line import/first
import webSearchExtension from "./index";

// ── Helper: create a mock pi that captures tool registrations ──────
interface CapturedTool {
  name: string;
  parameters: unknown;
  description: string;
  [key: string]: unknown;
}

function createMockPi() {
  const tools: CapturedTool[] = [];
  // Collect registrations so the test can assert on them
  const commands: Array<{ name: string; info: unknown }> = [];

  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

  const pi = {
    registerTool: vi.fn((tool: CapturedTool) => {
      tools.push(tool);
      return () => {
        const idx = tools.indexOf(tool);
        if (idx >= 0) tools.splice(idx, 1);
      };
    }),
    registerCommand: vi.fn((name: string, info: unknown) => {
      commands.push({ name, info });
    }),
    sendMessage: vi.fn(),
    exec: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      for (const h of handlers[event] ?? []) h(...args);
    }),
  };
  return { pi, tools, commands, handlers };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("web_fetch tool schema", () => {
  let tools: CapturedTool[];
  let webFetchTool: CapturedTool | undefined;

  beforeEach(() => {
    const mock = createMockPi();
    tools = mock.tools;

    // Call the extension factory
    const cleanup = webSearchExtension(mock.pi as any);
    expect(mock.pi.registerTool).toHaveBeenCalled();

    // Find the web_fetch tool registration
    webFetchTool = tools.find((t) => t.name === "web_fetch");
  });

  it("registers web_fetch tool", () => {
    expect(webFetchTool).toBeDefined();
    expect(webFetchTool!.name).toBe("web_fetch");
  });

  it("declares download as an optional boolean parameter", () => {
    expect(webFetchTool).toBeDefined();
    const params = webFetchTool!.parameters as Record<string, any>;
    expect(params).toBeDefined();
    expect(params.type).toBe("object");
    expect(params.properties).toBeDefined();

    // download must exist as a property
    const download = params.properties.download;
    expect(download).toBeDefined();
    expect(download.type).toBe("boolean");

    // download must be optional (not in required array)
    expect(params.required).not.toContain("download");
  });

  it("gives download a description matching existing documentation", () => {
    expect(webFetchTool).toBeDefined();
    const params = webFetchTool!.parameters as Record<string, any>;
    const download = params.properties.download;

    // The description should reference saving binary files (images, PDFs)
    // to a local temp path, matching the tool's text description
    expect(download.description).toBeTruthy();
    expect(download.description.toLowerCase()).toContain("binary");
    expect(download.description.toLowerCase()).toContain("temp");
  });

  it("includes download as the last property after raw", () => {
    expect(webFetchTool).toBeDefined();
    const params = webFetchTool!.parameters as Record<string, any>;
    const propNames = Object.keys(params.properties);

    // Verify download is declared and appears after raw
    expect(propNames).toContain("download");
    expect(propNames.indexOf("download")).toBe(propNames.length - 1);
  });
});
