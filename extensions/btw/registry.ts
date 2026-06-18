import type { ChildProcess } from "child_process";

// ── Types ───────────────────────────────────────────────────────────

export interface RunningEntry {
  id: string;
  query: string;
  childProcess: ChildProcess;
  startedAt: Date;
  abortController?: AbortController;
}

export interface CompletedSuccessResult {
  type: "success";
  text: string;
  toolTrace: Array<{ toolName: string; args: Record<string, unknown> }>;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: number };
  model?: string;
  stopReason?: string;
}

export interface CompletedErrorResult {
  type: "error";
  error: string;
  exitCode?: number;
  stderr?: string;
  toolTrace: Array<{ toolName: string; args: Record<string, unknown> }>;
  partialText?: string;
}

export type CompletedResult = CompletedSuccessResult | CompletedErrorResult;

export interface CompletedEntry {
  id: string;
  query: string;
  result: CompletedResult;
  completedAt: Date;
}

// ── Registry ────────────────────────────────────────────────────────

export interface BtwRegistry {
  addRunning(id: string, query: string, childProcess: ChildProcess, abortController?: AbortController): void;
  complete(id: string, result: CompletedSuccessResult): void;
  fail(id: string, error: string, details?: { exitCode?: number; stderr?: string; toolTrace?: Array<{ toolName: string; args: Record<string, unknown> }>; partialText?: string }): void;
  abort(id: string): void;
  getRunning(): readonly RunningEntry[];
  getCompleted(): readonly CompletedEntry[];
  killAll(): void;
  clear(): void;
}

// ── Factory ─────────────────────────────────────────────────────────

export function createRegistry(): BtwRegistry {
  const running = new Map<string, RunningEntry>();
  const completed: CompletedEntry[] = [];

  return {
    addRunning(id: string, query: string, childProcess: ChildProcess, abortController?: AbortController): void {
      running.set(id, { id, query, childProcess, startedAt: new Date(), abortController });
    },

    abort(id: string): void {
      const entry = running.get(id);
      if (entry?.abortController) {
        entry.abortController.abort();
      }
    },

    complete(id: string, result: CompletedSuccessResult): void {
      const entry = running.get(id);
      if (!entry) return;
      running.delete(id);
      completed.push({ id, query: entry.query, result, completedAt: new Date() });
    },

    fail(id: string, error: string, details?: { exitCode?: number; stderr?: string; toolTrace?: Array<{ toolName: string; args: Record<string, unknown> }>; partialText?: string }): void {
      const entry = running.get(id);
      if (!entry) return;
      running.delete(id);
      completed.push({
        id,
        query: entry.query,
        result: {
          type: "error",
          error,
          toolTrace: details?.toolTrace ?? [],
          exitCode: details?.exitCode,
          stderr: details?.stderr,
          partialText: details?.partialText,
        },
        completedAt: new Date(),
      });
    },

    getRunning(): readonly RunningEntry[] {
      return Array.from(running.values());
    },

    getCompleted(): readonly CompletedEntry[] {
      // Newest-first (reverse chronological)
      return [...completed].reverse();
    },

    killAll(): void {
      for (const [, entry] of running) {
        // Signal abort first so the spawner returns an abort error result
        try {
          entry.abortController?.abort();
        } catch {
          // Controller may already be aborted
        }
        try {
          entry.childProcess.kill("SIGTERM");
        } catch {
          // Process may already be dead
        }
      }
      running.clear();
    },

    clear(): void {
      running.clear();
      completed.length = 0;
    },
  };
}
