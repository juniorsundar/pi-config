import type { ChildProcess } from "child_process";

// ── Types ───────────────────────────────────────────────────────────

export interface RunningEntry {
  id: string;
  query: string;
  childProcess: ChildProcess;
  startedAt: Date;
}

export type CompletedSuccessResult = { type: "success"; text: string };
export type CompletedErrorResult = { type: "error"; error: string };
export type CompletedResult = CompletedSuccessResult | CompletedErrorResult;

export interface CompletedEntry {
  id: string;
  query: string;
  result: CompletedResult;
  completedAt: Date;
}

// ── Registry ────────────────────────────────────────────────────────

export interface BtwRegistry {
  addRunning(id: string, query: string, childProcess: ChildProcess): void;
  complete(id: string, result: CompletedSuccessResult): void;
  fail(id: string, error: string): void;
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
    addRunning(id: string, query: string, childProcess: ChildProcess): void {
      running.set(id, { id, query, childProcess, startedAt: new Date() });
    },

    complete(id: string, result: CompletedSuccessResult): void {
      const entry = running.get(id);
      if (!entry) return;
      running.delete(id);
      completed.push({ id, query: entry.query, result, completedAt: new Date() });
    },

    fail(id: string, error: string): void {
      const entry = running.get(id);
      if (!entry) return;
      running.delete(id);
      completed.push({
        id,
        query: entry.query,
        result: { type: "error", error },
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
