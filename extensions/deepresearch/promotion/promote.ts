/**
 * Promotion module for Research Briefs.
 *
 * Creates a shareable package (brief.md + appendix.md) from a completed
 * or budget-exhausted Research Brief. Promotion is human-only and refuses
 * unsafe destinations outside the active workspace.
 */

import { join, resolve, basename, dirname } from "path";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from "fs";
import { getStorePath } from "../workspace/store";
import { getRun } from "../lifecycle/run-store";
import { readSourceNotes } from "../rendering/source-notes";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PromoteOptions {
  /** Destination directory path (relative or absolute). Must be inside cwd. */
  to: string;
  /** If true, overwrite existing files silently. */
  force?: boolean;
}

export interface PromotedFile {
  /** Relative path within the promoted package (e.g. "brief.md"). */
  name: string;
  /** Absolute path to the written file. */
  absolutePath: string;
}

export interface PromoteResult {
  /** List of files that were written. */
  files: PromotedFile[];
  /** The destination directory where files were written. */
  destDir: string;
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Promote a Research Brief from a run to the given destination.
 *
 * @returns The list of written files and the destination directory.
 * @throws With a user-facing error message on validation failure.
 */
export function promoteResearchBrief(
  cwd: string,
  runId: string,
  options: PromoteOptions,
): PromoteResult {
  const run = getRun(cwd, runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  // ── Status gate: only completed or budget_exhausted ──────────────────
  const promotableStatuses = new Set(["completed", "budget_exhausted"]);
  if (!promotableStatuses.has(run.status)) {
    throw new Error(
      `Cannot promote run ${runId} with status "${run.status}". ` +
      `Only completed or budget_exhausted runs can be promoted.`,
    );
  }

  const runDir = join(getStorePath(cwd), "runs", runId);

  // ── Verify brief.md exists ───────────────────────────────────────────
  const briefPath = join(runDir, "brief.md");
  if (!existsSync(briefPath)) {
    throw new Error(
      `Run ${runId} has status "${run.status}" but no brief.md found. ` +
      `Cannot promote without a Research Brief.`,
    );
  }

  // ── Resolve and validate destination path ────────────────────────────
  const resolvedDest = resolve(cwd, options.to);
  const resolvedCwd = resolve(cwd);

  // Resolve symlinks so a symlink-to-outside can't escape the workspace
  let realDest: string;
  try {
    realDest = realpathSync(resolvedDest);
  } catch {
    // Path doesn't exist yet — use the unresolved path (parent dir safety still applies)
    const parentResolved = dirname(resolvedDest);
    try {
      const realParent = realpathSync(parentResolved);
      realDest = join(realParent, basename(resolvedDest));
    } catch {
      // Parent also doesn't exist — use resolved path as-is
      realDest = resolvedDest;
    }
  }

  // Ensure destination is inside the active workspace
  if (!realDest.startsWith(resolvedCwd + "/") && realDest !== resolvedCwd) {
    throw new Error(
      `Destination path "${options.to}" resolves to "${realDest}" ` +
      `which is outside the active workspace "${resolvedCwd}". ` +
      `Promotion can only write inside the current working directory.`,
    );
  }

  // ── Check for existing files (unless --force) ────────────────────────
  if (!options.force) {
    // Check if any of the files we intend to write already exist
    const intendedFiles = ["brief.md", "appendix.md"];
    const existing: string[] = [];
    for (const f of intendedFiles) {
      const fp = join(resolvedDest, f);
      if (existsSync(fp)) {
        existing.push(f);
      }
    }
    if (existing.length > 0) {
      throw new Error(
        `Cannot promote: the following files already exist at "${options.to}": ` +
        `${existing.join(", ")}. ` +
        `Use --force to overwrite.`,
      );
    }
  }

  // ── Create destination directory ─────────────────────────────────────
  mkdirSync(resolvedDest, { recursive: true });

  const written: PromotedFile[] = [];

  // ── 1. Copy brief.md ─────────────────────────────────────────────────
  let briefContent = readFileSync(briefPath, "utf-8");

  // For budget-exhausted runs, add a best-effort banner at the top
  if (run.status === "budget_exhausted") {
    briefContent = [
      "> **⚠️ BEST-EFFORT — Budget Exhausted**",
      `> This Research Brief was produced when the Research Budget was exhausted.`,
      `> Coverage may be incomplete. See "Caveats", "Gaps", and "Continuation`,
      `> Recommendation" sections for details.`,
      `> Status: \`budget_exhausted\``,
      "",
      briefContent,
    ].join("\n");
  }

  const destBriefPath = join(resolvedDest, "brief.md");
  writeFileSync(destBriefPath, briefContent, "utf-8");
  written.push({ name: "brief.md", absolutePath: destBriefPath });

  // ── 2. Build and write appendix.md ──────────────────────────────────
  const appendixContent = buildSourceReferenceAppendix(runDir, run.status);
  const destAppendixPath = join(resolvedDest, "appendix.md");
  writeFileSync(destAppendixPath, appendixContent, "utf-8");
  written.push({ name: "appendix.md", absolutePath: destAppendixPath });

  return { files: written, destDir: resolvedDest };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build the source-reference appendix markdown from source notes.
 * Only includes structured metadata and evidence snippets —
 * NOT raw diagnostics, raw model responses, or full raw fetched content.
 */
function buildSourceReferenceAppendix(runDir: string, runStatus: string): string {
  const lines: string[] = [];

  lines.push("# Source References");
  lines.push("");
  lines.push(
    "This appendix contains citation metadata and evidence snippets " +
    "for claims in the accompanying Research Brief. It is intended to " +
    "support auditing and traceability.",
  );
  lines.push("");

  if (runStatus === "budget_exhausted") {
    lines.push("> **⚠️ Budget Exhausted** — Source coverage may be incomplete.");
    lines.push("");
  }

  // Load source notes via the shared utility
  const notes = readSourceNotes(runDir);

  if (notes.length === 0) {
    lines.push("*No source notes found for this run.*");
    lines.push("");
    return lines.join("\n");
  }

  for (const note of notes) {
    lines.push(`## Source ${note.citationNumber}`);
    lines.push("");
    lines.push(`**URL**: ${note.url}`);
    lines.push(`**Title**: ${note.title}`);
    lines.push(`**Citation Number**: ${note.citationNumber}`);
    lines.push("");

    if (note.snippets.length > 0) {
      lines.push("### Evidence Snippets");
      lines.push("");
      for (const snippet of note.snippets) {
        lines.push(`- ${snippet}`);
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "*Raw diagnostics, raw model responses, and full raw fetched content " +
    "are excluded from this promoted package. See the Workspace Research " +
    "Store diagnostics directory for troubleshooting details.*",
  );

  return lines.join("\n");
}