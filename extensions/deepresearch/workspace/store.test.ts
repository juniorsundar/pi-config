import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initStore, getStorePath } from "./store";

let workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-store-"));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe("Workspace Research Store", () => {
  it("initializes .pi/research under the workspace", () => {
    const workDir = makeWorkDir();
    const storePath = initStore(workDir);

    expect(storePath).toBe(join(workDir, ".pi", "research"));
    expect(existsSync(storePath)).toBe(true);
  });

  it("creates proposals/ subdirectory", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const proposalsPath = join(workDir, ".pi", "research", "proposals");
    expect(existsSync(proposalsPath)).toBe(true);
  });

  it("creates runs/ subdirectory", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const runsPath = join(workDir, ".pi", "research", "runs");
    expect(existsSync(runsPath)).toBe(true);
  });

  it("creates diagnostics/ subdirectory", () => {
    const workDir = makeWorkDir();
    initStore(workDir);

    const diagPath = join(workDir, ".pi", "research", "diagnostics");
    expect(existsSync(diagPath)).toBe(true);
  });

  it("is idempotent — calling initStore twice does not error", () => {
    const workDir = makeWorkDir();
    initStore(workDir);
    expect(() => initStore(workDir)).not.toThrow();
  });

  it("getStorePath returns the store path even if not yet initialized", () => {
    const workDir = makeWorkDir();
    const path = getStorePath(workDir);

    expect(path).toBe(join(workDir, ".pi", "research"));
  });

  it("store path is workspace-scoped (not global)", () => {
    const workDir1 = makeWorkDir();
    const workDir2 = makeWorkDir();

    const path1 = initStore(workDir1);
    const path2 = initStore(workDir2);

    expect(path1).not.toBe(path2);
    expect(path1).toContain(workDir1);
    expect(path2).toContain(workDir2);
  });

  it("getStorePath is pure — does not create directories", () => {
    const workDir = makeWorkDir();
    const storePath = join(workDir, ".pi", "research");

    // Only call getStorePath, not initStore
    const result = getStorePath(workDir);
    expect(result).toBe(storePath);
    expect(existsSync(storePath)).toBe(false);
  });
});
