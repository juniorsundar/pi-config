import { join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";
import { getStorePath } from "../workspace/store";
import { listRuns, getActiveRun } from "./run-store";
import { listProposals } from "../proposals/proposal-manager";
import type { StatusResult, ArtifactPointers } from "../domain/types";

/**
 * Build artifact pointers for a run directory, returning only relative paths
 * to artifacts that actually exist on disk.
 */
function buildArtifactPointers(
  runDir: string,
  storePath: string,
  sourceNoteCount: number,
): ArtifactPointers {
  const rel = (p: string) => {
    const prefix = storePath.replace(/\/+$/, "") + "/";
    return p.startsWith(prefix) ? p.slice(prefix.length) : p;
  };

  const result: ArtifactPointers = { sourceNoteCount };

  const digestPath = join(runDir, "progress-digest.md");
  if (existsSync(digestPath)) {
    result.progressDigest = rel(digestPath);
  }

  const summaryPath = join(runDir, "run-summary.md");
  if (existsSync(summaryPath)) {
    result.runSummary = rel(summaryPath);
  }

  const briefPath = join(runDir, "brief.md");
  if (existsSync(briefPath)) {
    result.brief = rel(briefPath);
  }

  return result;
}

/**
 * Read the progress-digest.md contents for an active run, if the file exists.
 * Returns undefined on any filesystem error.
 */
function readProgressDigest(runDir: string): string | undefined {
  const path = join(runDir, "progress-digest.md");
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Count source note files in the run's source-notes directory.
 * Returns 0 on any filesystem error (directory missing, unreadable, etc.).
 */
function countSourceNotes(runDir: string): number {
  const notesDir = join(runDir, "source-notes");
  if (!existsSync(notesDir)) return 0;
  try {
    return readdirSync(notesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .length;
  } catch {
    return 0;
  }
}

/**
 * Get the workspace research status.
 * Queries the Workspace Research Store for active run, proposals, and runs.
 * For the active run, also reads the progress-digest.md and derives
 * artifact pointers.
 */
export function getStatus(cwd: string): StatusResult {
  const storePath = getStorePath(cwd);
  const activeRun = getActiveRun(cwd);

  let activeProgressDigest: string | undefined;
  let activeArtifactPointers: ArtifactPointers | undefined;

  if (activeRun) {
    const runDir = join(storePath, "runs", activeRun.id);

    activeProgressDigest = readProgressDigest(runDir);
    activeArtifactPointers = buildArtifactPointers(
      runDir,
      storePath,
      countSourceNotes(runDir),
    );
  }

  return {
    storePath,
    activeRun,
    proposals: listProposals(cwd),
    runs: listRuns(cwd),
    activeProgressDigest,
    activeArtifactPointers,
  };
}
