/**
 * Human Research View Facade.
 *
 * Reads canonical Research Brief and run state artifacts from disk,
 * assembles them into renderer input, delegates to the pure HTML renderer,
 * and writes the self-contained view/index.html.
 *
 * Policy: Only runs with status "completed" or "budget_exhausted" produce a view.
 * All other statuses (failed, cancelled, interrupted, running, etc.) are refused.
 * "failed" runs are additionally refused even with previousBriefAvailable,
 * unless explicit allowFailed is set.
 */

import { join } from "path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { getStorePath } from "../workspace/store";
import { renderHumanView, type HumanViewInput } from "./human-view-renderer";
import { readSourceNotes } from "./source-notes";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RenderRunOptions {
  /** Override the refusal policy for failed runs (for human inspection). */
  allowFailed?: boolean;
}

export interface RunArtifacts {
  question: string;
  status: string;
  brief: string;
  triggerSource?: string;
  previousBriefAvailable?: boolean;
  budgetUsage?: { searches: number; sourceVisits: number; modelCalls: number };
  evidenceMixCategories?: Array<{ category: string; status: string }>;
  sourceNotes: Array<{
    url: string;
    title: string;
    citationNumber: number;
    snippets: string[];
  }>;
}

// ── Facade ─────────────────────────────────────────────────────────────────

/**
 * Render a Human Research View from canonical run artifacts.
 *
 * Reads status.json, brief.md, budget.json, evidence-mix.json, and
 * source-notes/ from the run directory. Generates view/index.html
 * with all content inline (no external assets).
 *
 * @returns The absolute path to the generated view/index.html.
 * @throws If the run is not found, or if status policy rejects the render.
 */
export async function renderRun(
  cwd: string,
  runId: string,
  options?: RenderRunOptions,
): Promise<string> {
  const runDir = join(getStorePath(cwd), "runs", runId);

  // ── Load status.json ──────────────────────────────────────────────────
  const statusPath = join(runDir, "status.json");
  if (!existsSync(statusPath)) {
    throw new Error(`Run not found: ${runId} (no status.json at ${statusPath})`);
  }

  let statusData: Record<string, any>;
  try {
    statusData = JSON.parse(readFileSync(statusPath, "utf-8"));
  } catch {
    throw new Error(`Failed to parse status.json for run: ${runId}`);
  }

  const status: string = statusData.status ?? "unknown";
  const question: string = statusData.question ?? "Untitled Research";
  const triggerSource: string = statusData.triggerSource ?? "unknown";
  const previousBriefAvailable: boolean = statusData.previousBriefAvailable ?? false;

  // ── Policy: refuse failed runs unless explicitly allowed ──────────────
  const isFailed = status === "failed";
  if (isFailed && !options?.allowFailed) {
    throw new Error(
      `Cannot render view for run "${runId}" with status "failed". ` +
      `This run produced no trustworthy Research Brief. ` +
      `Use status to inspect, or pass allowFailed for explicit human inspection.`,
    );
  }

  // Only completed and budget_exhausted produce a normal view
  const readableStatuses = new Set(["completed", "budget_exhausted"]);
  if (!readableStatuses.has(status) && !options?.allowFailed) {
    throw new Error(
      `Cannot render view for run "${runId}" with status "${status}". ` +
      `Views can only be generated for completed or budget_exhausted runs.`,
    );
  }

  // ── Load brief.md ────────────────────────────────────────────────────
  const briefPath = join(runDir, "brief.md");
  const brief = existsSync(briefPath)
    ? readFileSync(briefPath, "utf-8")
    : "";

  // ── Load budget.json (optional) ───────────────────────────────────────
  let budgetUsage: RunArtifacts["budgetUsage"];
  const budgetPath = join(runDir, "budget.json");
  if (existsSync(budgetPath)) {
    try {
      const budgetData = JSON.parse(readFileSync(budgetPath, "utf-8"));
      const usage = budgetData.usage ?? {};
      budgetUsage = {
        searches: usage.searches ?? 0,
        sourceVisits: usage.sourceVisits ?? 0,
        modelCalls: usage.modelCalls ?? 0,
      };
    } catch {
      budgetUsage = { searches: 0, sourceVisits: 0, modelCalls: 0 };
    }
  } else {
    budgetUsage = { searches: 0, sourceVisits: 0, modelCalls: 0 };
  }

  // ── Load evidence-mix.json (optional) ─────────────────────────────────
  let evidenceMixCategories: RunArtifacts["evidenceMixCategories"];
  const evidenceMixPath = join(runDir, "evidence-mix.json");
  if (existsSync(evidenceMixPath)) {
    try {
      const emData = JSON.parse(readFileSync(evidenceMixPath, "utf-8"));
      evidenceMixCategories = Array.isArray(emData.categories) ? emData.categories : [];
    } catch {
      evidenceMixCategories = [];
    }
  }

  // ── Load source notes (optional) ──────────────────────────────────────
  const sourceNotes = readSourceNotes(runDir);

  // ── Assemble renderer input ───────────────────────────────────────────
  const input: HumanViewInput = {
    question,
    brief,
    status,
    sourceNotes: sourceNotes.map((sn) => ({
      url: sn.url,
      title: sn.title,
      citationNumber: sn.citationNumber,
      snippets: sn.snippets,
    })),
    budgetSummary: {
      searches: budgetUsage.searches,
      sourceVisits: budgetUsage.sourceVisits,
      modelCalls: budgetUsage.modelCalls,
    },
  };

  // Add evidence-mix coverage if available
  if (evidenceMixCategories && evidenceMixCategories.length > 0) {
    input.evidenceMixCategories = evidenceMixCategories;
  }

  // Extract continuation recommendation from brief if present
  const contRec = extractSection(brief, "Continuation Recommendation");
  if (contRec) {
    input.continuationRecommendation = contRec;
  }

  // Extract caveats and gaps from brief if present
  const caveats = extractSection(brief, "Caveats");
  if (caveats) {
    input.caveats = caveats.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  }
  const gaps = extractSection(brief, "Gaps");
  if (gaps) {
    input.gaps = gaps.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  }

  // Mark as stale for failed runs with previous brief version
  if (isFailed && previousBriefAvailable) {
    input.isStale = true;
  }

  // ── Render HTML ───────────────────────────────────────────────────────
  const html = await renderHumanView(input);

  // ── Write to disk ─────────────────────────────────────────────────────
  const viewDir = join(runDir, "view");
  mkdirSync(viewDir, { recursive: true });
  const htmlPath = join(viewDir, "index.html");
  writeFileSync(htmlPath, html, "utf-8");

  return htmlPath;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract a section's content from markdown (between ## Heading and the next heading).
 */
function extractSection(markdown: string, heading: string): string | undefined {
  // Split into lines, find the heading, collect content until the next heading
  const lines = markdown.split("\n");
  const headingPattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`);
  let inSection = false;
  const contentLines: string[] = [];

  for (const line of lines) {
    if (!inSection) {
      if (headingPattern.test(line.trim())) {
        inSection = true;
      }
      continue;
    }

    // Stop at the next heading of any level
    if (/^##+\s/.test(line.trim())) {
      break;
    }

    contentLines.push(line);
  }

  if (!inSection || contentLines.length === 0) return undefined;

  return contentLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(" ");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}