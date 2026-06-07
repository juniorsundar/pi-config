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
  } = input;

  const statusLabel = status.replace(/_/g, " ");
  const isBestEffort = status === "budget_exhausted";
  const statusBanner = isBestEffort
    ? `<div class="banner budget-exhausted">⚠️ Budget Exhausted — Best Effort Brief</div>`
    : "";

  const continuationBlock = continuationRecommendation
    ? `<div class="continuation"><strong>Continuation Recommendation:</strong> ${escapeHtml(continuationRecommendation)}</div>`
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
  </style>
</head>
<body>
  ${statusBanner}
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
