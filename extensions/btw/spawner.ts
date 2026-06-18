/**
 * btw — BTW Process spawner.
 *
 * Spawns an isolated child `pi` process with a forked session to resolve
 * side-questions without polluting the parent session's conversation history.
 * Parses the JSON event stream to produce structured results.
 */

// ── Types ───────────────────────────────────────────────────────────

import type { BtwToolTraceEntry, BtwUsage } from "./types.js";

// Re-export shared types for backward compatibility
export type { BtwToolTraceEntry, BtwUsage } from "./types.js";

export interface BtwSpawnOptions {
  /** Session file path to fork. Null for ephemeral (no history). */
  sessionFile: string | null;
  /** The side-question to ask. */
  query: string;
  /** Working directory for the child process. */
  cwd: string;
  /** Timeout in milliseconds. 0 = no timeout. */
  timeoutMs: number;
  /** Optional abort signal to cancel the process. */
  signal?: AbortSignal;
  /** Override pi binary path (for testing). */
  piPath?: string;
  /** Called immediately after spawn with the child process handle. */
  onSpawn?: (child: ChildProcessLike) => void;
}

export type BtwResult =
  | {
      ok: true;
      text: string;
      toolTrace: BtwToolTraceEntry[];
      usage: BtwUsage;
      model?: string;
      stopReason?: string;
    }
  | {
      ok: false;
      errorMessage: string;
      exitCode?: number;
      stderr?: string;
      toolTrace: BtwToolTraceEntry[];
      partialText?: string;
    };

// ── Pure functions (testable without spawning) ──────────────────────

export interface BuildBtwArgsOptions {
  sessionFile: string | null;
  query: string;
}

/**
 * Build the command-line arguments for the child `pi` process.
 *
 * For a real session: `pi --fork <session> --mode json --exclude-tools edit,write -p "query"`
 * For ephemeral:      `pi --no-session --mode json --exclude-tools edit,write -p "query"`
 */
export function buildBtwArgs(options: BuildBtwArgsOptions): string[] {
  const args: string[] = [];

  if (options.sessionFile !== null) {
    args.push("--fork", options.sessionFile);
  } else {
    args.push("--no-session");
  }

  args.push("--mode", "json");
  args.push("--exclude-tools", "edit,write");
  args.push("-p", options.query);

  return args;
}

/**
 * Build the environment variables for the child process.
 * Sets PI_BTW_CHILD=1 as a recursion guard.
 */
export function buildBtwEnv(): Record<string, string> {
  return { PI_BTW_CHILD: "1" };
}

// ── JSON event stream parsing ───────────────────────────────────────

interface ParsedEvent {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost?: number;
    };
    model?: string;
    stopReason?: string;
  };
  toolName?: string;
  toolCallId?: string;
  id?: string;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

/**
 * Parse NDJSON lines from the child process stdout and extract structured data.
 *
 * Extracts:
 * - Final assistant text from message_end events
 * - Tool trace from tool_execution_start / tool_call events
 * - Usage stats, model, and stop reason from message_end events
 */
export function parseBtwOutput(lines: string[]): {
  text: string;
  toolTrace: BtwToolTraceEntry[];
  usage: BtwUsage;
  model?: string;
  stopReason?: string;
} {
  let text = "";
  const toolTrace: BtwToolTraceEntry[] = [];
  const usage: BtwUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let model: string | undefined;
  let stopReason: string | undefined;

  const seenToolIds = new Set<string>();

  for (const line of lines) {
    if (!line.trim()) continue;

    let parsed: ParsedEvent;
    try {
      parsed = JSON.parse(line) as ParsedEvent;
    } catch {
      // Malformed JSON line — skip
      continue;
    }

    const eventType = parsed.type;

    // Extract assistant text from message_end
    if (eventType === "message_end" && parsed.message?.role === "assistant") {
      text = extractTextContent(parsed.message.content);
      model = parsed.message.model ?? undefined;
      stopReason = parsed.message.stopReason ?? undefined;

      // Reset usage on each assistant message_end so stale data from prior
      // events doesn't persist if the final event has no usage block.
      usage.input = parsed.message.usage?.input ?? 0;
      usage.output = parsed.message.usage?.output ?? 0;
      usage.cacheRead = parsed.message.usage?.cacheRead ?? 0;
      usage.cacheWrite = parsed.message.usage?.cacheWrite ?? 0;
      usage.cost = parsed.message.usage?.cost ?? undefined;
    }

    // Extract tool trace from tool_execution_start / tool_call
    if (eventType === "tool_execution_start" || eventType === "tool_call") {
      const toolCallId = (parsed.toolCallId ?? parsed.id ?? "") as string;
      if (toolCallId && seenToolIds.has(toolCallId)) continue;
      if (toolCallId) seenToolIds.add(toolCallId);

      toolTrace.push({
        toolName: (parsed.toolName as string) ?? "unknown",
        args: parsed.args ?? parsed.input ?? {},
      });
    }
  }

  return { text, toolTrace, usage, model, stopReason };
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string",
    )
    .map((block) => (block as { text: string }).text)
    .join("\n");
}

// ── Process spawning ────────────────────────────────────────────────

/** Grace period after SIGTERM before escalating to SIGKILL. */
const SIGTERM_GRACE_MS = 5_000;

interface ChildProcessLike {
  pid?: number;
  stdout: import("stream").Readable | null;
  stderr: import("stream").Readable | null;
  kill(signal?: string): boolean;
  on(event: "close", handler: (code: number | null) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
}

/** Injectable spawn function for testing. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; stdio: [string, string, string] },
) => ChildProcessLike;

/** Default spawn using node:child_process. */
async function defaultSpawnFn(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; stdio: [string, string, string] },
): Promise<ChildProcessLike> {
  const { spawn } = await import("child_process");
  return spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as ChildProcessLike;
}

/**
 * Spawn a BTW child process with timeout and abort signal support.
 *
 * Lifecycle:
 * 1. Build command args and env
 * 2. Spawn child process
 * 3. Register timeout/abort handlers BEFORE stream collection
 * 4. Collect stdout lines (NDJSON) and stderr
 * 5. Wait for process to close
 * 6. Parse collected lines into structured result
 * 7. Return BtwResult
 */
export async function spawnBtwProcess(
  options: BtwSpawnOptions,
  spawnFn: SpawnFn = defaultSpawnFn,
): Promise<BtwResult> {
  const args = buildBtwArgs({ sessionFile: options.sessionFile, query: options.query });
  const env = buildBtwEnv();
  const piPath = options.piPath ?? "pi";

  let child: ChildProcessLike;
  try {
    child = await spawnFn(piPath, args, {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errorMessage: `Failed to spawn BTW process: ${message}`,
      toolTrace: [],
    };
  }

  // ── Notify caller of child process handle ──
  if (options.onSpawn) {
    options.onSpawn(child);
  }

  // ── Register timeout/abort BEFORE stream collection ──
  // Captured flags avoid post-close races with clearTimeout/removeEventListener.
  let timedOut = false;
  let wasAborted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  if (options.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalate to SIGKILL after grace period
      killTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, SIGTERM_GRACE_MS);
    }, options.timeoutMs);
  }

  const abortHandler = () => {
    wasAborted = true;
    child.kill("SIGTERM");
  };
  if (options.signal) {
    if (options.signal.aborted) {
      wasAborted = true;
      child.kill("SIGTERM");
    } else {
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  // ── Collect stdout lines ──
  const stdoutLines: string[] = [];
  let stdoutBuffer = "";
  try {
    if (child.stdout) {
      child.stdout.setEncoding("utf-8");
      for await (const chunk of child.stdout) {
        stdoutBuffer += chunk;
        const parts = stdoutBuffer.split("\n");
        stdoutBuffer = parts.pop() ?? "";
        for (const part of parts) {
          if (part.length > 0) stdoutLines.push(part);
        }
      }
      // Flush remaining buffer
      if (stdoutBuffer.trim().length > 0) {
        stdoutLines.push(stdoutBuffer.trimEnd());
      }
    }
  } catch {
    // Stream error (e.g., pipe broken) — collect partial result
  }

  // ── Collect stderr ──
  let stderr = "";
  try {
    if (child.stderr) {
      child.stderr.setEncoding("utf-8");
      for await (const chunk of child.stderr) {
        stderr += chunk;
      }
    }
  } catch {
    // Stream error — ignore
  }

  // ── Wait for process to close ──
  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  // ── Clean up timers ──
  if (timer) clearTimeout(timer);
  if (killTimer) clearTimeout(killTimer);
  if (options.signal) {
    options.signal.removeEventListener("abort", abortHandler);
  }

  // ── Build result ──
  const parsed = parseBtwOutput(stdoutLines);

  // Timeout takes priority — captured flag avoids post-close race
  if (timedOut) {
    return {
      ok: false,
      errorMessage: `BTW process timed out after ${options.timeoutMs / 1000}s`,
      toolTrace: parsed.toolTrace,
      stderr: stderr || undefined,
    };
  }

  // Abort takes priority — captured flag avoids post-close race
  if (wasAborted) {
    return {
      ok: false,
      errorMessage: "BTW process was aborted",
      toolTrace: parsed.toolTrace,
      stderr: stderr || undefined,
    };
  }

  if (exitCode !== 0) {
    return {
      ok: false,
      errorMessage: `BTW process exited with code ${exitCode}`,
      exitCode,
      stderr: stderr || undefined,
      toolTrace: parsed.toolTrace,
      partialText: parsed.text || undefined,
    };
  }

  if (!parsed.text) {
    return {
      ok: false,
      errorMessage: "BTW process produced no assistant output",
      exitCode,
      stderr: stderr || undefined,
      toolTrace: parsed.toolTrace,
    };
  }

  return {
    ok: true,
    text: parsed.text,
    toolTrace: parsed.toolTrace,
    usage: parsed.usage,
    model: parsed.model,
    stopReason: parsed.stopReason,
  };
}
