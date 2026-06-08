import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore } from "../workspace/store";
import { createRun, updateStatus, getActiveRun } from "../lifecycle/run-store";
import { getStatus } from "../lifecycle/status";
import type { RunMeta } from "../domain/types";

let workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-status-"));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

function setupActiveRun(cwd: string): string {
  initStore(cwd);
  const run = createRun(cwd, "Test question", {
    mode: "blocking",
    trigger: "Testing status changes",
    budgetLimits: {
      maxSearches: 10,
      maxFetchAttempts: 20,
      maxSourceVisits: 10,
      maxSynthesisRounds: 3,
      maxModelCalls: 30,
      maxRetryAttempts: 5,
      maxElapsedSeconds: 300,
    },
  });
  updateStatus(cwd, run.identity.id, "running");
  return run.identity.id;
}

function writeProgressDigest(cwd: string, runId: string, content: string): void {
  const runDir = join(cwd, ".pi", "research", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "progress-digest.md"), content);
}

describe("getStatus — progress digest and artifact pointers", () => {
  it("returns progress digest content and artifact pointers for an active run", () => {
    const cwd = makeWorkDir();
    const runId = setupActiveRun(cwd);
    writeProgressDigest(cwd, runId, "## Progress Digest — test\n\n📊 Budget: 2/10 searches\n🎯 Evidence: partial\n");

    const result = getStatus(cwd);

    // Core fields still present
    expect(result.activeRun).not.toBeNull();
    expect(result.activeRun!.id).toBe(runId);
    expect(result.activeRun!.status).toBe("running");
    expect(result.activeRun!.mode).toBe("blocking");

    // New fields
    expect(result.activeProgressDigest).toBeDefined();
    expect(result.activeProgressDigest).toContain("Progress Digest");
    expect(result.activeProgressDigest).toContain("2/10 searches");

    expect(result.activeArtifactPointers).toBeDefined();
    expect(result.activeArtifactPointers!.progressDigest).toContain("progress-digest.md");
    expect(result.activeArtifactPointers!.sourceNoteCount).toBe(0);
  });

  it("returns null active run fields when no run is active", () => {
    const cwd = makeWorkDir();
    initStore(cwd);

    const result = getStatus(cwd);

    expect(result.activeRun).toBeNull();
    expect(result.activeProgressDigest).toBeUndefined();
    expect(result.activeArtifactPointers).toBeUndefined();
  });

  it("returns undefined progress digest when digest file does not exist", () => {
    const cwd = makeWorkDir();
    setupActiveRun(cwd);

    // No progress-digest.md written
    const result = getStatus(cwd);

    expect(result.activeRun).not.toBeNull();
    expect(result.activeProgressDigest).toBeUndefined();
    // Artifact pointers should still show other artifacts
    expect(result.activeArtifactPointers).toBeDefined();
    expect(result.activeArtifactPointers!.progressDigest).toBeUndefined();
  });

  it("includes mode field on RunSummary for background runs", () => {
    const cwd = makeWorkDir();
    initStore(cwd);
    const run = createRun(cwd, "Background task", {
      mode: "background",
      trigger: "Background research",
    });
    updateStatus(cwd, run.identity.id, "running");
    writeProgressDigest(cwd, run.identity.id, "## Progress Digest — background\n");

    const result = getStatus(cwd);

    expect(result.activeRun).not.toBeNull();
    expect(result.activeRun!.mode).toBe("background");
    expect(result.activeRun!.status).toBe("running");
    expect(result.activeProgressDigest).toBeDefined();
  });

  it("derives stored proposal and run lists alongside new fields", () => {
    const cwd = makeWorkDir();
    setupActiveRun(cwd);

    const result = getStatus(cwd);

    // Existing fields still present
    expect(result.proposals).toBeDefined();
    expect(Array.isArray(result.proposals)).toBe(true);
    expect(result.runs).toBeDefined();
    expect(Array.isArray(result.runs)).toBe(true);
    expect(result.storePath).toContain(".pi/research");
  });

  it("surfaces queued runs alongside an active run", () => {
    const cwd = makeWorkDir();
    const runId = setupActiveRun(cwd);
    writeProgressDigest(cwd, runId, "## Progress Digest — active\n");

    // Create a queued run (queued behind the active one)
    const queuedRun = createRun(cwd, "Queued question", {
      mode: "background",
      trigger: "Queued research",
    });
    // queuedRun stays as "queued" by default

    const result = getStatus(cwd);

    // Active run is the running one
    expect(result.activeRun).not.toBeNull();
    expect(result.activeRun!.id).toBe(runId);
    expect(result.activeRun!.status).toBe("running");
    expect(result.activeProgressDigest).toBeDefined();

    // Queued run is in the runs list
    expect(result.runs.length).toBe(2);
    const queued = result.runs.find((r) => r.status === "queued");
    expect(queued).toBeDefined();
    expect(queued!.id).toBe(queuedRun.identity.id);

    // No progress digest for queued run (it hasn't started)
    expect(queued!.status).toBe("queued");
  });
});