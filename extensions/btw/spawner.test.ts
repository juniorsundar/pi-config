import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { Readable } from "stream";

// ── Slices 1–3: Command and environment construction ─────────────────

describe("btw spawner", () => {
  describe("Slice 1: Command construction — buildBtwArgs()", () => {
    it("builds correct args for a session with session file", async () => {
      const { buildBtwArgs } = await import("./spawner");

      const args = buildBtwArgs({
        sessionFile: "/home/user/.pi/sessions/abc123.jsonl",
        query: "What is the capital of France?",
      });

      expect(args).toEqual([
        "--fork", "/home/user/.pi/sessions/abc123.jsonl",
        "--mode", "json",
        "--exclude-tools", "edit,write",
        "-p", "What is the capital of France?",
      ]);
    });

    it("includes --mode json", async () => {
      const { buildBtwArgs } = await import("./spawner");

      const args = buildBtwArgs({ sessionFile: "/s.jsonl", query: "Q" });

      expect(args).toContain("--mode");
      expect(args).toContain("json");
    });

    it("includes --exclude-tools edit,write", async () => {
      const { buildBtwArgs } = await import("./spawner");

      const args = buildBtwArgs({ sessionFile: "/s.jsonl", query: "Q" });

      expect(args).toContain("--exclude-tools");
      const idx = args.indexOf("--exclude-tools");
      expect(args[idx + 1]).toBe("edit,write");
    });

    it("includes -p with the query text", async () => {
      const { buildBtwArgs } = await import("./spawner");

      const args = buildBtwArgs({ sessionFile: "/s.jsonl", query: "Why is the sky blue?" });

      expect(args).toContain("-p");
      const idx = args.indexOf("-p");
      expect(args[idx + 1]).toBe("Why is the sky blue?");
    });
  });

  describe("Slice 2: Environment construction — buildBtwEnv()", () => {
    it("returns PI_BTW_CHILD=1", async () => {
      const { buildBtwEnv } = await import("./spawner");

      const env = buildBtwEnv();

      expect(env).toEqual({ PI_BTW_CHILD: "1" });
    });

    it("returns a new object each call (no shared mutation)", async () => {
      const { buildBtwEnv } = await import("./spawner");

      const env1 = buildBtwEnv();
      const env2 = buildBtwEnv();

      expect(env1).not.toBe(env2);
      expect(env1).toEqual(env2);
    });
  });

  describe("Slice 3: Ephemeral session fallback — --no-session", () => {
    it("uses --no-session when sessionFile is null", async () => {
      const { buildBtwArgs } = await import("./spawner");

      const args = buildBtwArgs({ sessionFile: null, query: "Q" });

      expect(args).toContain("--no-session");
      expect(args).not.toContain("--fork");
    });

    it("still includes --mode json and -p for ephemeral sessions", async () => {
      const { buildBtwArgs } = await import("./spawner");

      const args = buildBtwArgs({ sessionFile: null, query: "Hello" });

      expect(args).toContain("--mode");
      expect(args).toContain("json");
      expect(args).toContain("-p");
    });
  });

  // ── Slices 4–6: JSON event stream parsing ──────────────────────────

  describe("Slice 4: JSON event parsing — assistant text extraction", () => {
    it("extracts final assistant text from message_end with text content blocks", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [
          { type: "text", text: "Paris is the capital of France." },
        ] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("Paris is the capital of France.");
    });

    it("extracts text from string content (not array)", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: "Simple string answer." } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("Simple string answer.");
    });

    it("joins multiple text blocks with newlines", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [
          { type: "text", text: "First paragraph." },
          { type: "text", text: "Second paragraph." },
        ] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("First paragraph.\nSecond paragraph.");
    });

    it("ignores non-assistant message_end events", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "user msg" }] } }),
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "actual answer" }] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("actual answer");
    });

    it("takes the last assistant message_end when multiple exist", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "first answer" }] } }),
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "final answer" }] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("final answer");
    });

    it("returns empty text when no message_end events present", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "agent_start" }),
        JSON.stringify({ type: "turn_start", turnIndex: 0 }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("");
    });
  });

  describe("Slice 5: Tool trace parsing", () => {
    it("extracts tool calls from tool_execution_start events", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "tool_execution_start", toolCallId: "tc-1", toolName: "web_search", input: { query: "capital of France" } }),
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.toolTrace).toHaveLength(1);
      expect(result.toolTrace[0].toolName).toBe("web_search");
      expect(result.toolTrace[0].args).toEqual({ query: "capital of France" });
    });

    it("extracts tool calls from tool_call events", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "tool_call", toolCallId: "tc-2", toolName: "read", args: { path: "/foo.ts" } }),
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.toolTrace).toHaveLength(1);
      expect(result.toolTrace[0].toolName).toBe("read");
      expect(result.toolTrace[0].args).toEqual({ path: "/foo.ts" });
    });

    it("deduplicates tool calls by toolCallId", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "tool_execution_start", toolCallId: "tc-1", toolName: "web_search", input: { query: "Q1" } }),
        JSON.stringify({ type: "tool_call", toolCallId: "tc-1", toolName: "web_search", args: { query: "Q1" } }),
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.toolTrace).toHaveLength(1);
    });

    it("preserves multiple distinct tool calls in order", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "tool_execution_start", toolCallId: "tc-1", toolName: "web_search", input: {} }),
        JSON.stringify({ type: "tool_execution_start", toolCallId: "tc-2", toolName: "read", input: {} }),
        JSON.stringify({ type: "tool_execution_start", toolCallId: "tc-3", toolName: "bash", input: {} }),
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.toolTrace).toHaveLength(3);
      expect(result.toolTrace.map(t => t.toolName)).toEqual(["web_search", "read", "bash"]);
    });

    it("returns empty toolTrace when no tool events present", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.toolTrace).toEqual([]);
    });
  });

  describe("Slice 6: Usage stats, model, stop reason parsing", () => {
    it("extracts usage stats from message_end", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "answer" }],
          usage: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 0 },
        } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.usage).toEqual({ input: 1000, output: 500, cacheRead: 200, cacheWrite: 0 });
    });

    it("extracts model from message_end", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "answer" }],
          model: "anthropic/claude-sonnet-4-20250514",
        } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.model).toBe("anthropic/claude-sonnet-4-20250514");
    });

    it("extracts stopReason from message_end", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "answer" }],
          stopReason: "endTurn",
        } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.stopReason).toBe("endTurn");
    });

    it("returns default usage when no usage in event", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "answer" }],
        } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    });

    it("handles missing model and stopReason gracefully", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "answer" }],
        } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.model).toBeUndefined();
      expect(result.stopReason).toBeUndefined();
    });

    it("extracts cost from usage when present", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "answer" }],
          usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05 },
        } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.usage.cost).toBe(0.05);
    });

    it("resets usage to zeros when final message_end has no usage block", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "first" }],
          usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
        } }),
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "final" }],
          // No usage block on final event
        } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("final");
      expect(result.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: undefined });
    });

    it("handles content blocks with non-string text field", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [
            { type: "text", text: 123 },  // number, not string
            { type: "text", text: "valid answer" },
          ],
        } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("valid answer");
    });
  });

  describe("Edge cases: malformed output and empty input", () => {
    it("returns empty results for empty lines array", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const result = parseBtwOutput([]);
      expect(result.text).toBe("");
      expect(result.toolTrace).toEqual([]);
      expect(result.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    });

    it("skips malformed JSON lines without throwing", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        "not json at all",
        "",  // empty line
        "{broken json",
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "valid answer" }] } }),
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("valid answer");
    });

    it("handles empty lines between valid events", async () => {
      const { parseBtwOutput } = await import("./spawner");

      const lines = [
        "",
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }),
        "",
      ];

      const result = parseBtwOutput(lines);
      expect(result.text).toBe("answer");
    });
  });

  // ── Slices 7–10: Process lifecycle (error, timeout, abort) ─────────

  describe("Slice 7: Error result — non-zero exit code", () => {
    it("returns error result when child exits with non-zero code", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ exitCode: 1 });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toContain("exited with code 1");
        expect(result.exitCode).toBe(1);
      }
    });

    it("includes stderr in error result when available", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ exitCode: 1, stderrText: "Error: model not found" });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.stderr).toBe("Error: model not found");
      }
    });

    it("includes partial tool trace from child before exit", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = [
        JSON.stringify({ type: "tool_execution_start", toolCallId: "tc-1", toolName: "read", input: { path: "/foo" } }),
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial" }] } }),
      ].join("\n");

      const mockChild = createMockChild({ exitCode: 1, stdoutText: output });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.toolTrace).toHaveLength(1);
        expect(result.toolTrace[0].toolName).toBe("read");
        expect(result.partialText).toBe("partial");
      }
    });
  });

  describe("Slice 8: Error result — malformed output / stream truncation", () => {
    it("returns error when no message_end received (stream truncated)", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = [
        JSON.stringify({ type: "agent_start" }),
        JSON.stringify({ type: "turn_start", turnIndex: 0 }),
      ].join("\n");

      const mockChild = createMockChild({ exitCode: 0, stdoutText: output });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toContain("no assistant output");
      }
    });

    it("returns error when stdout is empty", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ exitCode: 0, stdoutText: "" });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toContain("no assistant output");
      }
    });

    it("handles mixed valid and invalid JSON lines gracefully", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = [
        "not json",
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "valid" }] } }),
      ].join("\n");

      const mockChild = createMockChild({ exitCode: 0, stdoutText: output });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe("valid");
      }
    });
  });

  describe("Slice 9: Timeout handling", () => {
    it("returns error result when process times out", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      // Mock child that never closes on its own
      const mockChild = createMockChild({ neverCloses: true });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 50 },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toContain("timed out");
        expect(result.errorMessage).toContain("0.05s");
      }
    });

    it("sends SIGTERM to the child process on timeout", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ neverCloses: true });
      const killSpy = vi.spyOn(mockChild, "kill");
      const mockSpawn: any = () => mockChild;

      await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 50 },
        mockSpawn,
      );

      expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    });

    it("does not timeout when timeoutMs is 0", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
      const mockChild = createMockChild({ exitCode: 0, stdoutText: output, delayMs: 30 });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe("ok");
      }
    });
  });

  describe("Slice 10: Abort signal handling", () => {
    it("returns error result when abort signal fires", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ neverCloses: true });
      const mockSpawn: any = () => mockChild;
      const controller = new AbortController();

      // Fire abort after a short delay
      setTimeout(() => controller.abort(), 30);

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0, signal: controller.signal },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toContain("aborted");
      }
    });

    it("sends SIGTERM to the child process on abort", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ neverCloses: true });
      const killSpy = vi.spyOn(mockChild, "kill");
      const mockSpawn: any = () => mockChild;
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 30);

      await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0, signal: controller.signal },
        mockSpawn,
      );

      expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    });

    it("kills immediately if signal is already aborted", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ neverCloses: true });
      const killSpy = vi.spyOn(mockChild, "kill");
      const mockSpawn: any = () => mockChild;
      const controller = new AbortController();
      controller.abort(); // Already aborted

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0, signal: controller.signal },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    });
  });

  describe("onSpawn callback", () => {
    it("calls onSpawn with child process handle immediately after spawn", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
      const mockChild = createMockChild({ exitCode: 0, stdoutText: output });
      const mockSpawn: any = () => mockChild;
      const onSpawn = vi.fn();

      await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0, onSpawn },
        mockSpawn,
      );

      expect(onSpawn).toHaveBeenCalledTimes(1);
      expect(onSpawn).toHaveBeenCalledWith(mockChild);
    });

    it("calls onSpawn even when spawn later fails", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ exitCode: 1 });
      const mockSpawn: any = () => mockChild;
      const onSpawn = vi.fn();

      await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0, onSpawn },
        mockSpawn,
      );

      expect(onSpawn).toHaveBeenCalledTimes(1);
      expect(onSpawn).toHaveBeenCalledWith(mockChild);
    });

    it("does not crash when onSpawn is not provided", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
      const mockChild = createMockChild({ exitCode: 0, stdoutText: output });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("Slice 11: Spawn failure handling", () => {
    it("returns error when spawn throws", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockSpawn: any = () => {
        throw new Error("ENOENT: no such file or directory 'pi'");
      };

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toContain("Failed to spawn");
        expect(result.errorMessage).toContain("ENOENT");
      }
    });
  });

  describe("Slice 11: Happy path — successful spawn", () => {
    it("returns ok result with text, toolTrace, usage, model, stopReason", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = [
        JSON.stringify({ type: "tool_execution_start", toolCallId: "tc-1", toolName: "web_search", input: { query: "capital of France" } }),
        JSON.stringify({ type: "message_end", message: { role: "assistant",
          content: [{ type: "text", text: "Paris is the capital of France." }],
          usage: { input: 500, output: 200, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
          model: "anthropic/claude-sonnet-4-20250514",
          stopReason: "endTurn",
        } }),
      ].join("\n");

      const mockChild = createMockChild({ exitCode: 0, stdoutText: output });
      const mockSpawn: any = () => mockChild;

      const result = await spawnBtwProcess(
        { sessionFile: "/tmp/session.jsonl", query: "What is the capital of France?", cwd: "/tmp", timeoutMs: 0 },
        mockSpawn,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe("Paris is the capital of France.");
        expect(result.toolTrace).toHaveLength(1);
        expect(result.toolTrace[0].toolName).toBe("web_search");
        expect(result.usage.input).toBe(500);
        expect(result.usage.cost).toBe(0.01);
        expect(result.model).toBe("anthropic/claude-sonnet-4-20250514");
        expect(result.stopReason).toBe("endTurn");
      }
    });
  });

  // ── Slice 12: Force-kill escalation — SIGKILL after SIGTERM grace period ──

  // ── Fake-timer lifecycle tests (Slices 12–13) ──
  // These share fake-timer setup; each slice focuses on a different aspect.

  describe("Slice 12: Force-kill escalation — SIGKILL after SIGTERM grace period", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("escalates to SIGKILL after grace period when process ignores SIGTERM", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      // Mock child that ignores SIGTERM but closes on SIGKILL
      const emitter = new EventEmitter() as any;
      emitter.pid = 12345;
      const stdoutReadable = new Readable({ read() {} });
      const stderrReadable = new Readable({ read() {} });
      emitter.stdout = stdoutReadable;
      emitter.stderr = stderrReadable;
      process.nextTick(() => {
        stdoutReadable.push(null);
        stderrReadable.push(null);
      });

      const killSpy = vi.fn((signal?: string) => {
        if (signal === "SIGKILL") {
          setImmediate(() => emitter.emit("close", 137)); // 128 + 9
        }
        // SIGTERM is ignored — no close
        return true;
      });
      emitter.kill = killSpy;
      const mockSpawn: any = () => emitter;

      const timeoutMs = 100;
      const spawnPromise = spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs },
        mockSpawn,
      );

      // Advance past timeout — SIGTERM fires (process ignores it)
      await vi.advanceTimersByTimeAsync(timeoutMs + 1);
      expect(killSpy).toHaveBeenCalledWith("SIGTERM");
      expect(killSpy).toHaveBeenCalledTimes(1);

      // Advance past SIGTERM_GRACE_MS (5000ms) — SIGKILL fires
      await vi.advanceTimersByTimeAsync(6000);
      expect(killSpy).toHaveBeenCalledWith("SIGKILL");
      expect(killSpy).toHaveBeenCalledTimes(2);

      const result = await spawnPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toContain("timed out");
      }
    });
  });

  describe("Slice 13: Timer cleanup — no stale callbacks after process close", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not fire stale timeout kill after successful completion", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      });
      const mockChild = createMockChild({ exitCode: 0, stdoutText: output });
      const killSpy = vi.fn();
      (mockChild as any).kill = killSpy;
      const mockSpawn: any = () => mockChild;

      const spawnPromise = spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 100 },
        mockSpawn,
      );

      // Advance past the auto-close delay (10ms) to complete the process
      await vi.advanceTimersByTimeAsync(20);
      const result = await spawnPromise;
      expect(result.ok).toBe(true);

      // Advance well past the timeout — stale timer should have been cleared
      await vi.advanceTimersByTimeAsync(200);
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("does not fire stale timeout kill after failure exit", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ exitCode: 1, stderrText: "error" });
      const killSpy = vi.fn();
      (mockChild as any).kill = killSpy;
      const mockSpawn: any = () => mockChild;

      const spawnPromise = spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 100 },
        mockSpawn,
      );

      await vi.advanceTimersByTimeAsync(20);
      const result = await spawnPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorMessage).toContain("exited with code");

      await vi.advanceTimersByTimeAsync(200);
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("does not fire stale timeout kill after abort-triggered close", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const controller = new AbortController();
      // neverCloses: true — no auto-close, abort's SIGTERM will close it
      const mockChild = createMockChild({ exitCode: 0, neverCloses: true });
      const killSpy = vi.fn((signal?: string) => {
        setImmediate(() => (mockChild as any).emit("close", signal === "SIGTERM" ? 143 : 1));
        return true;
      });
      (mockChild as any).kill = killSpy;
      const mockSpawn: any = () => mockChild;

      // Abort before the 100ms timeout
      setTimeout(() => controller.abort(), 5);

      const spawnPromise = spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 100, signal: controller.signal },
        mockSpawn,
      );

      await vi.advanceTimersByTimeAsync(20);
      const result = await spawnPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorMessage).toContain("aborted");

      // Advance well past the timeout — stale timer should have been cleared
      await vi.advanceTimersByTimeAsync(200);
      expect(killSpy).toHaveBeenCalledWith("SIGTERM"); // only the abort SIGTERM
      expect(killSpy).toHaveBeenCalledTimes(1); // no timeout SIGTERM
    });
  });

  describe("Slice 14: Listener cleanup — removeEventListener after process close", () => {
    it("removes abort listener after successful completion", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const output = JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      });
      const mockChild = createMockChild({ exitCode: 0, stdoutText: output });
      const mockSpawn: any = () => mockChild;

      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0, signal: controller.signal },
        mockSpawn,
      );

      expect(result.ok).toBe(true);
      expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("removes abort listener after failure exit", async () => {
      const { spawnBtwProcess } = await import("./spawner");

      const mockChild = createMockChild({ exitCode: 1 });
      const mockSpawn: any = () => mockChild;

      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

      const result = await spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 0, signal: controller.signal },
        mockSpawn,
      );

      expect(result.ok).toBe(false);
      expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("removes abort listener after timeout-triggered close (process exits on SIGTERM)", async () => {
      vi.useFakeTimers();
      const { spawnBtwProcess } = await import("./spawner");

      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

      // Mock that exits immediately on SIGTERM (well-behaved process)
      const emitter = new EventEmitter() as any;
      emitter.pid = 12345;
      const stdoutReadable = new Readable({ read() {} });
      const stderrReadable = new Readable({ read() {} });
      emitter.stdout = stdoutReadable;
      emitter.stderr = stderrReadable;
      process.nextTick(() => {
        stdoutReadable.push(null);
        stderrReadable.push(null);
      });
      emitter.kill = vi.fn((signal?: string) => {
        setImmediate(() => emitter.emit("close", signal === "SIGTERM" ? 143 : 1));
        return true;
      });
      const mockSpawn: any = () => emitter;

      const spawnPromise = spawnBtwProcess(
        { sessionFile: null, query: "Q", cwd: "/tmp", timeoutMs: 100, signal: controller.signal },
        mockSpawn,
      );

      await vi.advanceTimersByTimeAsync(150);
      const result = await spawnPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorMessage).toContain("timed out");

      expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
      vi.useRealTimers();
    });
  });
});

// ── Test helpers ────────────────────────────────────────────────────

interface MockChildOptions {
  exitCode?: number;
  stdoutText?: string;
  stderrText?: string;
  delayMs?: number;
  neverCloses?: boolean;
}

function createMockChild(options: MockChildOptions) {
  const { exitCode = 0, stdoutText = "", stderrText = "", delayMs = 0, neverCloses = false } = options;

  const emitter = new EventEmitter() as any;
  emitter.pid = 12345;

  // Always create Readable streams (real child_process always has them)
  const stdoutReadable = new Readable({ read() {} });
  const stderrReadable = new Readable({ read() {} });
  emitter.stdout = stdoutReadable;
  emitter.stderr = stderrReadable;

  // Push data on next tick so for-await loops start reading
  process.nextTick(() => {
    if (stdoutText) stdoutReadable.push(stdoutText);
    stdoutReadable.push(null); // End stdout
    if (stderrText) stderrReadable.push(stderrText);
    stderrReadable.push(null); // End stderr
  });

  // When kill is called, end streams and emit close
  emitter.kill = vi.fn((signal?: string) => {
    const exitCode = signal === "SIGTERM" ? 143 : 1;
    // End streams so for-await loops complete, then emit close
    setImmediate(() => {
      if (!stdoutReadable.destroyed) stdoutReadable.push(null);
      if (!stderrReadable.destroyed) stderrReadable.push(null);
      process.nextTick(() => emitter.emit("close", exitCode));
    });
    return true;
  });

  // Emit close event on normal schedule (when not neverCloses)
  if (!neverCloses) {
    const closeDelay = delayMs > 0 ? delayMs : 10;
    setTimeout(() => {
      emitter.emit("close", exitCode);
    }, closeDelay);
  }

  return emitter;
}
