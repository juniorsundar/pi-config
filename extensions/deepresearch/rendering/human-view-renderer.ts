/**
 * Human Research View renderer seam.
 *
 * Generates a self-contained index.html from canonical markdown and JSON
 * artifacts. The HTML includes status labels, warnings, source links,
 * budget and coverage summaries, and best-effort/stale banners.
 * No external assets — everything is inline.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface HumanViewInput {
  /** The Research Question. */
  question: string;
  /** The markdown Research Brief content. */
  brief: string;
  /** Run lifecycle status. */
  status: string;
  /** Source notes with citation metadata. */
  sourceNotes: SourceNoteSummary[];
  /** Budget summary for display. */
  budgetSummary: {
    searches: number;
    sourceVisits: number;
    modelCalls: number;
  };
  /** Optional: Continuation recommendation text. */
  continuationRecommendation?: string;
  /** Optional: Evidence mix categories with coverage status. */
  evidenceMixCategories?: Array<{
    category: string;
    status: string;
  }>;
  /** Optional: Caveats from the brief. */
  caveats?: string[];
  /** Optional: Gaps from the brief. */
  gaps?: string[];
  /** Optional: Mark this view as stale (e.g., failed run with previous brief). */
  isStale?: boolean;
}

export interface SourceNoteSummary {
  url: string;
  title: string;
  citationNumber: number;
  snippets: string[];
}

// ── Renderer ───────────────────────────────────────────────────────────────

/**
 * Render a self-contained Human Research View as HTML.
 */
export async function renderHumanView(
  input: HumanViewInput,
): Promise<string> {
  const {
    question,
    brief,
    status,
    sourceNotes,
    budgetSummary,
    continuationRecommendation,
    evidenceMixCategories,
    caveats,
    gaps,
    isStale,
  } = input;

  const statusLabel = status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const isBestEffort = status === "budget_exhausted";
  const statusBanner = isBestEffort
    ? `<div class="banner budget-exhausted">⚠️ Budget Exhausted — Best Effort Brief</div>`
    : "";

  // Stale banner for failed runs with previous brief version
  const staleBlock = isStale
    ? `<div class="banner stale">⚠️ Stale Brief — Last continuation attempt failed</div>`
    : "";

  const continuationBlock = continuationRecommendation
    ? `<div class="continuation"><strong>Continuation Recommendation:</strong> ${escapeHtml(continuationRecommendation)}</div>`
    : "";

  // Caveats from the brief
  const caveatsBlock =
    caveats && caveats.length > 0
      ? `<div class="caveats">
    <h2>Caveats</h2>
    <ul>
${caveats.map((c) => `      <li>${escapeHtml(c)}</li>`).join("\n")}
    </ul>
  </div>`
      : "";

  // Gaps from the brief
  const gapsBlock =
    gaps && gaps.length > 0
      ? `<div class="gaps">
    <h2>Gaps</h2>
    <ul>
${gaps.map((g) => `      <li>${escapeHtml(g)}</li>`).join("\n")}
    </ul>
  </div>`
      : "";

  // Evidence mix coverage block
  const evidenceCoverageBlock =
    evidenceMixCategories && evidenceMixCategories.length > 0
      ? `<div class="coverage">
    <h2>Evidence Coverage</h2>
    <ul class="coverage-list">
${evidenceMixCategories
  .map(
    (c: { category: string; status: string }) =>
      `      <li class="coverage-item coverage-${escapeHtml(c.status)}">
        <span class="coverage-status">${escapeHtml(c.status)}</span>
        ${escapeHtml(c.category)}
      </li>`,
  )
  .join("\n")}
    </ul>
  </div>`
      : "";

  const sourceNotesHtml = sourceNotes
    .map(
      (s) => `
      <li class="source-note">
        <strong>[${s.citationNumber}]</strong>
        <a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a>
        ${s.snippets.map((snip) => `<blockquote>${escapeHtml(snip)}</blockquote>`).join("")}
      </li>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Research: ${escapeHtml(question)}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem 1rem;
      line-height: 1.6;
      color: #1a1a1a;
    }
    .banner {
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-bottom: 1.5rem;
    }
    .budget-exhausted {
      background: #fff3cd;
      border: 1px solid #ffc107;
      color: #664d03;
    }
    .stale {
      background: #f0f0f0;
      border: 1px solid #ccc;
      color: #666;
    .header {
      border-bottom: 2px solid #e5e5e5;
      padding-bottom: 1rem;
      margin-bottom: 1.5rem;
    }
    .header h1 {
      margin: 0 0 0.5rem 0;
    }
    .status {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.875rem;
      background: #e5e5e5;
    }
    .meta {
      display: flex;
      gap: 1rem;
      margin: 1rem 0;
      font-size: 0.875rem;
      color: #666;
    }
    .budget-item {
      background: #f5f5f5;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }
    .sources {
      border-top: 2px solid #e5e5e5;
      margin-top: 2rem;
      padding-top: 1rem;
    }
    .sources h2 {
      margin-top: 0;
    }
    .source-note {
      margin-bottom: 1rem;
      padding: 0.75rem;
      background: #f9f9f9;
      border-radius: 6px;
    }
    .source-note blockquote {
      margin: 0.5rem 0 0 0;
      padding-left: 1rem;
      border-left: 3px solid #ddd;
      color: #555;
    }
    .continuation {
      margin-top: 1rem;
      padding: 0.75rem;
      background: #e7f3ff;
      border-radius: 6px;
    }
    .caveats, .gaps {
      border-top: 2px solid #e5e5e5;
      margin-top: 2rem;
      padding-top: 1rem;
    }
    .caveats ul, .gaps ul {
      padding-left: 1.5rem;
    }
    .caveats li, .gaps li {
      margin-bottom: 0.5rem;
    }
    .coverage {
      border-top: 2px solid #e5e5e5;
      margin-top: 2rem;
      padding-top: 1rem;
    }
    .coverage-list {
      list-style: none;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .coverage-item {
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.875rem;
      background: #f5f5f5;
    }
    .coverage-found {
      background: #d4edda;
      color: #155724;
    }
    .coverage-weak {
      background: #fff3cd;
      color: #856404;
    }
    .coverage-missing {
      background: #f8d7da;
      color: #721c24;
    }
    .coverage-excluded {
      background: #e5e5e5;
      color: #666;
    }
    .coverage-not-searched {
      background: #f0f0f0;
      color: #999;
    }
    .coverage-status {
      font-weight: 600;
      margin-right: 0.25rem;
    }
  </style>
</head>
<body>
  ${statusBanner}
  ${staleBlock}
  <div class="header">
    <h1>${escapeHtml(question)}</h1>
    <span class="status">${escapeHtml(statusLabel)}</span>
  </div>
  <div class="meta">
    <span class="budget-item">Searches: ${budgetSummary.searches}</span>
    <span class="budget-item">Source Visits: ${budgetSummary.sourceVisits}</span>
    <span class="budget-item">Model Calls: ${budgetSummary.modelCalls}</span>
  </div>
  ${continuationBlock}
  ${caveatsBlock}
  ${gapsBlock}
  ${evidenceCoverageBlock}
  <div class="brief">
    ${brief}
  </div>
  ${
    sourceNotes.length > 0
      ? `<div class="sources">
    <h2>Sources</h2>
    <ol>${sourceNotesHtml}</ol>
  </div>`
      : ""
  }
</body>
</html>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
