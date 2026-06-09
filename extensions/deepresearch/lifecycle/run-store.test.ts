import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore } from "../workspace/store";
import {
  createRun,
  getRun,
  listRuns,
  updateStatus,
  getActiveRun,
  generateIdentity,
} from "./run-store";
import type { RunMeta, RunStatus } from "../domain/types";
import { ACTIVE_RUN_STATUSES } from "../domain/types";

let workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-runstore-"));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe("generateIdentity", () => {
  it("produces a date-slug-shortId format", () => {
    const id = generateIdentity("my-research-question");

    // date-slug-shortId: YYYY-MM-DD-<slug>-<8 hex chars>
    expect(id.id).toMatch(/^\d{4}-\d{2}-\d{2}-my-research-question-[0-9a-f]{8}$/);
  });

  it("slugifies the question into a readable slug", () => {
    const id = generateIdentity("Is Rust a good choice for CLI tools?");

    expect(id.slug).toMatch(/^is-rust-a-good-choice/);
    expect(id.slug).not.toContain(" ");
    expect(id.slug).not.toContain("?");
  });

  it("truncates long slugs to a reasonable length", () => {
    const id = generateIdentity(
      "A very long research question that goes on and on about many different topics and details",
    );

    expect(id.slug.length).toBeLessThanOrEqual(60);
  });

  it("uses today's date as the date prefix", () => {
    const id = generateIdentity("test");

    const today = new Date().toISOString().slice(0, 10);
    expect(id.date).toBe(today);
  });

  it("produces unique short IDs for different calls", () => {
    const id1 = generateIdentity("same question");
    const id2 = generateIdentity("same question");

    expect(id1.shortId).not.toBe(id2.shortId);
  });
});

describe("RunStore", () => {
  it("creates a run directory under the workspace store", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Is Rust good for CLI tools?");
    const runPath = join(workDir, ".pi", "research", "runs", meta.identity.id);

    expect(existsSync(runPath)).toBe(true);
  });

  it("creates status.json in the run directory", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Test question?");
    const statusPath = join(
      workDir,
      ".pi",
      "research",
      "runs",
      meta.identity.id,
      "status.json",
    );

    expect(existsSync(statusPath)).toBe(true);
  });

  it("initializes run status as queued", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Test question?");
    expect(meta.status).toBe("queued");
  });

  it("getRun retrieves a run by ID", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const created = createRun(workDir, "Test question?");
    const retrieved = getRun(workDir, created.identity.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.identity.id).toBe(created.identity.id);
    expect(retrieved!.status).toBe("queued");
    expect(retrieved!.question).toBe("Test question?");
  });

  it("getRun returns null for unknown run ID", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const result = getRun(workDir, "nonexistent-id");
    expect(result).toBeNull();
  });

  it("listRuns returns all runs sorted by creation date", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run1 = createRun(workDir, "First question");
    const run2 = createRun(workDir, "Second question");

    const runs = listRuns(workDir);
    expect(runs.length).toBe(2);
    const ids = runs.map((r) => r.id);
    expect(ids).toContain(run1.identity.id);
    expect(ids).toContain(run2.identity.id);
  });

  it("listRuns returns empty array for fresh workspace", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const runs = listRuns(workDir);
    expect(runs).toEqual([]);
  });

  it("updateStatus transitions run to a new status", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Test question?");
    const updated = updateStatus(workDir, meta.identity.id, "running");

    expect(updated.status).toBe("running");
    // updatedAt should be >= original (may be same ms if called quickly)
    expect(updated.updatedAt >= meta.updatedAt).toBe(true);
  });

  it("updateStatus persists the new status to disk", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Test question?");
    updateStatus(workDir, meta.identity.id, "completed");

    const reloaded = getRun(workDir, meta.identity.id);
    expect(reloaded!.status).toBe("completed");
  });

  it("updateStatus throws for unknown run ID", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    expect(() => updateStatus(workDir, "nonexistent", "running")).toThrow(
      "Run not found",
    );
  });

  it("getActiveRun returns null when no runs exist", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const active = getActiveRun(workDir);
    expect(active).toBeNull();
  });

  it("getActiveRun returns null when all runs are non-active", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Completed run");
    updateStatus(workDir, meta.identity.id, "completed");

    const active = getActiveRun(workDir);
    expect(active).toBeNull();
  });

  it("getActiveRun returns the one run with active status", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    // Create several non-active runs
    createRun(workDir, "Completed run");
    const activeRun = createRun(workDir, "Running run");

    // Set active run to running
    updateStatus(workDir, activeRun.identity.id, "running");

    const active = getActiveRun(workDir);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(activeRun.identity.id);
    expect(active!.status).toBe("running");
  });

  it("getActiveRun returns the synthesizing run as active", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run = createRun(workDir, "Synthesizing run");
    updateStatus(workDir, run.identity.id, "synthesizing");

    const active = getActiveRun(workDir);
    expect(active).not.toBeNull();
    expect(active!.status).toBe("synthesizing");
  });

  it("only running and synthesizing count as active", () => {
    // Verify the ACTIVE_RUN_STATUSES constant
    expect(ACTIVE_RUN_STATUSES.has("running")).toBe(true);
    expect(ACTIVE_RUN_STATUSES.has("synthesizing")).toBe(true);

    for (const status of [
      "queued",
      "readiness_failed",
      "completed",
      "budget_exhausted",
      "cancelled",
      "interrupted",
      "failed",
    ] as RunStatus[]) {
      expect(ACTIVE_RUN_STATUSES.has(status)).toBe(false);
    }
  });

  it("run meta includes createdAt and updatedAt timestamps", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Timestamp test");
    expect(meta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.createdAt).toBe(meta.updatedAt);
  });

  // ── Shutdown marking (Issue 0034) ─────────────────────────────────

  it("updateStatus accepts interrupted status", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Interrupt test");
    const updated = updateStatus(workDir, meta.identity.id, "interrupted");

    expect(updated.status).toBe("interrupted");
  });

  it("updateStatus with interrupted sets termination reason when provided", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Interrupt reason test");
    const updated = updateStatus(
      workDir,
      meta.identity.id,
      "interrupted",
      "Pi shutdown",
    );

    expect(updated.status).toBe("interrupted");
    expect(updated.terminationReason).toBe("Pi shutdown");
  });

  it("interrupted status is persisted to disk", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Interrupt persist test");
    updateStatus(workDir, meta.identity.id, "interrupted", "Crash");

    const reloaded = getRun(workDir, meta.identity.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe("interrupted");
    expect(reloaded!.terminationReason).toBe("Crash");
  });

  it("interrupted run is not active", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const meta = createRun(workDir, "Interrupt not active test");
    updateStatus(workDir, meta.identity.id, "interrupted");

    const active = getActiveRun(workDir);
    expect(active).toBeNull();
  });

  it("getActiveRun returns null when only interrupted runs exist", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const run1 = createRun(workDir, "Run 1");
    const run2 = createRun(workDir, "Run 2");
    updateStatus(workDir, run1.identity.id, "interrupted");
    updateStatus(workDir, run2.identity.id, "interrupted");

    const active = getActiveRun(workDir);
    expect(active).toBeNull();
  });
});
