import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeReachabilityDiagnostic, writeDoctorDiagnostic, writeRunReadinessDiagnostic } from "./diagnostics.js";
import type { QuickReachabilityResult } from "./setup-policy.js";
import type { HarnessResult } from "../harness/types.js";

let dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deepresearch-diag-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe("writeReachabilityDiagnostic", () => {
  it("writes a JSON artifact to .pi/research/diagnostics/ when reachability fails", async () => {
    const cwd = makeDir();
    const result: QuickReachabilityResult = {
      reachable: false,
      error: "model 'bad-model' not found",
    };

    const artifactPath = await writeReachabilityDiagnostic(cwd, "bad-model", result);

    expect(artifactPath).toContain(".pi/research/diagnostics/reachability-");
    expect(artifactPath).toContain(".json");
    expect(existsSync(artifactPath)).toBe(true);

    const raw = readFileSync(artifactPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.model).toBe("bad-model");
    expect(parsed.reachable).toBe(false);
    expect(parsed.error).toContain("not found");
    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("returns a stable timestamp-based filename", async () => {
    const cwd = makeDir();
    const result: QuickReachabilityResult = { reachable: false, error: "fail" };

    const path1 = await writeReachabilityDiagnostic(cwd, "model-a", result);

    // Wait to ensure a different timestamp
    await new Promise((r) => setTimeout(r, 10));

    const path2 = await writeReachabilityDiagnostic(cwd, "model-b", result);

    expect(path1).not.toBe(path2);
    expect(path1).toContain("reachability-");
    expect(path2).toContain("reachability-");
  });

  it("does not throw when the cwd is unwritable — returns a fallback path", async () => {
    const cwd = "/nonexistent/deepresearch-test";
    const result: QuickReachabilityResult = { reachable: false, error: "fail" };

    // Should not throw
    const artifactPath = await writeReachabilityDiagnostic(cwd, "some-model", result);
    expect(typeof artifactPath).toBe("string");
  });

  it("records the provider as ollama", async () => {
    const cwd = makeDir();
    const result: QuickReachabilityResult = { reachable: false, error: "fail" };

    const artifactPath = await writeReachabilityDiagnostic(cwd, "test-model", result);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(parsed.provider).toBe("ollama");
  });

  it("does NOT create a Research Proposal or Research Run", async () => {
    const cwd = makeDir();
    const result: QuickReachabilityResult = { reachable: false, error: "fail" };

    const artifactPath = await writeReachabilityDiagnostic(cwd, "model", result);

    // Only the diagnostic file should exist, not proposals or runs
    const diagDir = join(cwd, ".pi", "research", "diagnostics");
    const proposalsDir = join(cwd, ".pi", "research", "proposals");
    const runsDir = join(cwd, ".pi", "research", "runs");

    expect(existsSync(artifactPath)).toBe(true);
    // proposals/ and runs/ directories should NOT exist (no initStore called)
    expect(existsSync(join(proposalsDir))).toBe(false);
    expect(existsSync(join(runsDir))).toBe(false);
  });
});

describe("writeDoctorDiagnostic", () => {
  function mockHarness(overrides: Partial<HarnessResult> = {}): HarnessResult {
    return {
      results: [],
      summary: "All probes passed.",
      diagnostics: [],
      passed: 6,
      recoverable: 0,
      failed: 0,
      ...overrides,
    };
  }

  it("writes a JSON artifact with harness results", async () => {
    const cwd = makeDir();
    const harness = mockHarness();

    const artifactPath = await writeDoctorDiagnostic(cwd, "tongyi-deepresearch:30b", harness);

    expect(artifactPath).toContain(".pi/research/diagnostics/doctor-");
    expect(existsSync(artifactPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(parsed.model).toBe("tongyi-deepresearch:30b");
    expect(parsed.provider).toBe("ollama");
    expect(parsed.harness.passed).toBe(6);
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.type).toBe("doctor");
  });

  it("includes probe results in the artifact", async () => {
    const cwd = makeDir();
    const harness = mockHarness({
      results: [
        { status: "pass", probe: "structured-intents", detail: "ok" },
        { status: "failure", probe: "stop-behavior", detail: "no reasoning" },
      ],
      passed: 5,
      failed: 1,
    });

    const artifactPath = await writeDoctorDiagnostic(cwd, "test-model", harness);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));

    expect(parsed.harness.results.length).toBe(2);
    expect(parsed.harness.failed).toBe(1);
  });

  it("does not throw on write failure", async () => {
    const cwd = "/nonexistent/deepresearch-test";
    const harness = mockHarness();

    const artifactPath = await writeDoctorDiagnostic(cwd, "model", harness);
    expect(typeof artifactPath).toBe("string");
  });
});

describe("writeRunReadinessDiagnostic", () => {
  function mockHarness(overrides: Partial<HarnessResult> = {}): HarnessResult {
    return {
      results: [],
      summary: "All probes passed.",
      diagnostics: [],
      passed: 6,
      recoverable: 0,
      failed: 0,
      ...overrides,
    };
  }

  it("writes diagnostic under the run's diagnostics directory", async () => {
    const cwd = makeDir();
    const harness = mockHarness({
      failed: 2,
      passed: 4,
    });

    const artifactPath = await writeRunReadinessDiagnostic(
      cwd,
      "2026-01-15-foo-a1b2c3d4",
      harness,
    );

    expect(artifactPath).toContain(
      ".pi/research/runs/2026-01-15-foo-a1b2c3d4/diagnostics/readiness-",
    );
    expect(existsSync(artifactPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(parsed.type).toBe("readiness");
    expect(parsed.harness.passed).toBe(4);
    expect(parsed.harness.failed).toBe(2);
  });

  it("stores full probe results in the run diagnostic", async () => {
    const cwd = makeDir();
    const harness = mockHarness({
      results: [
        { status: "failure" as const, probe: "structured-intents", detail: "bad json" },
        { status: "pass" as const, probe: "stop-behavior", detail: "ok" },
      ],
      passed: 1,
      failed: 1,
    });

    const artifactPath = await writeRunReadinessDiagnostic(cwd, "run-123", harness);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));

    expect(parsed.harness.results.length).toBe(2);
    expect(parsed.harness.results[0].probe).toBe("structured-intents");
    expect(parsed.harness.results[0].status).toBe("failure");
  });

  it("does not throw on write failure", async () => {
    const cwd = "/nonexistent/deepresearch-test";
    const harness = mockHarness();

    const artifactPath = await writeRunReadinessDiagnostic(cwd, "run-xyz", harness);
    expect(typeof artifactPath).toBe("string");
  });

  it("includes timestamp in the artifact", async () => {
    const cwd = makeDir();
    const harness = mockHarness();

    const artifactPath = await writeRunReadinessDiagnostic(cwd, "run-abc", harness);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));

    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe("string");
  });
});
