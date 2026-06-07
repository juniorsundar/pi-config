import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { QuickReachabilityResult } from "./setup-policy.js";
import type { HarnessResult } from "../harness/types.js";

/**
 * Write a reachability-failure diagnostic to the workspace diagnostics store.
 * Creates `.pi/research/diagnostics/` if it doesn't exist.
 *
 * Returns the written artifact path. Does NOT create a Research Proposal or
 * Research Run. On write failure, returns the intended path without throwing.
 */
export async function writeReachabilityDiagnostic(
  cwd: string,
  model: string,
  result: QuickReachabilityResult,
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `reachability-${ts}.json`;
  const diagPath = join(cwd, ".pi", "research", "diagnostics");
  const filePath = join(diagPath, filename);

  const artifact = {
    type: "reachability",
    timestamp: new Date().toISOString(),
    model,
    provider: "ollama",
    reachable: result.reachable,
    error: result.error ?? null,
  };

  try {
    mkdirSync(diagPath, { recursive: true });
    writeFileSync(filePath, JSON.stringify(artifact, null, 2));
  } catch {
    // Best-effort diagnostics — silently return the path even on write failure
  }

  return filePath;
}

/**
 * Write a doctor diagnostic artifact to the workspace diagnostics store.
 * Creates `.pi/research/diagnostics/` if it doesn't exist.
 *
 * Returns the written artifact path. Does NOT create a Research Run.
 * On write failure, returns the intended path without throwing.
 */
export async function writeDoctorDiagnostic(
  cwd: string,
  model: string,
  harness: HarnessResult,
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `doctor-${ts}.json`;
  const diagPath = join(cwd, ".pi", "research", "diagnostics");
  const filePath = join(diagPath, filename);

  const artifact = {
    type: "doctor",
    timestamp: new Date().toISOString(),
    model,
    provider: "ollama",
    harness: {
      passed: harness.passed,
      recoverable: harness.recoverable,
      failed: harness.failed,
      results: harness.results,
      summary: harness.summary,
      diagnostics: harness.diagnostics,
    },
  };

  try {
    mkdirSync(diagPath, { recursive: true });
    writeFileSync(filePath, JSON.stringify(artifact, null, 2));
  } catch {
    // Best-effort diagnostics
  }

  return filePath;
}

/**
 * Write a readiness-check result to a Research Run's diagnostics directory.
 * Creates `.pi/research/runs/<runId>/diagnostics/` if it doesn't exist.
 *
 * Returns the written artifact path. On write failure, returns the intended
 * path without throwing.
 */
export async function writeRunReadinessDiagnostic(
  cwd: string,
  runId: string,
  harness: HarnessResult,
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `readiness-${ts}.json`;
  const diagPath = join(cwd, ".pi", "research", "runs", runId, "diagnostics");
  const filePath = join(diagPath, filename);

  const artifact = {
    type: "readiness",
    timestamp: new Date().toISOString(),
    harness: {
      passed: harness.passed,
      recoverable: harness.recoverable,
      failed: harness.failed,
      results: harness.results,
      summary: harness.summary,
      diagnostics: harness.diagnostics,
    },
  };

  try {
    mkdirSync(diagPath, { recursive: true });
    writeFileSync(filePath, JSON.stringify(artifact, null, 2));
  } catch {
    // Best-effort diagnostics
  }

  return filePath;
}
