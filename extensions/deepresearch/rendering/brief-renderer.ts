/**
 * Research Brief Renderer.
 *
 * Composes structured inputs into canonical markdown Research Briefs.
 * The renderer is a pure function — no side effects, no I/O.
 * All validation (citation checking, budget-aware repair) is owned
 * by the brief-pipeline orchestration layer.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A section of evidence with citation references.
 */
export interface BriefSection {
  /** Section heading (e.g., "Documentation"). */
  heading: string;
  /** Section content / evidence text. */
  content: string;
  /** Citation numbers referenced in this section. */
  citationRefs: number[];
}

/**
 * A source note reference for the brief's source list.
 */
export interface BriefSourceNoteRef {
  /** Sequential citation number (matches SourceNoteData.citationNumber). */
  citationNumber: number;
  /** URL or local file path (maps from SourceNoteData.source). */
  source: string;
  /** Source title. */
  title: string;
  /** Evidence snippets from the source note. */
  snippets: string[];
}

/**
 * All inputs needed to render a Research Brief.
 */
export interface BriefInput {
  /** The Research Question. */
  question: string;
  /** The bottom-line finding. */
  bottomLine: string;
  /** Overall confidence level. */
  confidence: "low" | "medium" | "high";
  /** Rationale explaining the confidence level. */
  confidenceRationale: string;
  /** Evidence sections, each with citation references. */
  evidence: BriefSection[];
  /** Synthesis / interpretation section. May contain cited claims. */
  interpretation: string;
  /** Citation numbers referenced in the interpretation section. */
  interpretationCitationRefs?: number[];
  /** Tradeoffs to report. */
  tradeoffs?: string[];
  /** Caveats to report. */
  caveats?: string[];
  /** Source notes available for citation. */
  sourceNotes: BriefSourceNoteRef[];
  /** Unresolved gaps. */
  gaps?: string[];
  /** Optional continuation recommendation. */
  continuationRecommendation?: string;
  /** What triggered this research run. */
  triggerType: "human" | "agent" | "task";
  /** Implications for Pi or the current task (only for agent/task triggers). */
  taskImplications?: string;
  /** Optional Evidence Mix coverage block appended to the brief. */
  evidenceMixCoverage?: string;
}

/**
 * The rendered brief result.
 */
export interface RenderedBrief {
  /** Full markdown content ready to write to brief.md. */
  markdown: string;
  /** Ordered list of section identifiers present. */
  sections: string[];
  /** Citation numbers referenced across the brief. */
  citations: number[];
}

// ── Renderer ───────────────────────────────────────────────────────────────

/**
 * Render a structured Research Brief to canonical markdown.
 *
 * Pure function — no side effects, no I/O. Use the brief-pipeline
 * orchestration layer when you need citation validation, budget-aware
 * repair, or run-loop integration.
 */
export function renderBrief(input: BriefInput): RenderedBrief {
  const lines: string[] = [];
  const sections: string[] = [];
  const allCitations: Set<number> = new Set();

  // ── Question ─────────────────────────────────────────────────────────
  lines.push(`# Research Brief`, "");
  lines.push(`**Question**: ${input.question}`, "");

  // ── Bottom Line ──────────────────────────────────────────────────────
  sections.push("bottom-line");
  lines.push(`## Bottom Line`, "");
  lines.push(input.bottomLine, "");

  // ── Confidence ───────────────────────────────────────────────────────
  sections.push("confidence");
  lines.push(`## Confidence`, "");
  lines.push(`**Level**: ${input.confidence}`, "");
  lines.push(`**Rationale**: ${input.confidenceRationale}`, "");

  // ── Evidence sections ────────────────────────────────────────────────
  if (input.evidence.length > 0) {
    sections.push("evidence");
    for (const section of input.evidence) {
      lines.push(`## Evidence: ${section.heading}`, "");
      lines.push(section.content, "");
      for (const ref of section.citationRefs) {
        allCitations.add(ref);
      }
    }
  }

  // ── Interpretation ───────────────────────────────────────────────────
  if (input.interpretation.trim().length > 0) {
    sections.push("interpretation");
    lines.push(`## Interpretation`, "");
    lines.push(input.interpretation, "");
  }

  // Collect interpretation citation refs
  if (input.interpretation.trim().length > 0 && input.interpretationCitationRefs) {
    for (const ref of input.interpretationCitationRefs) {
      allCitations.add(ref);
    }
  }

  // ── Tradeoffs ────────────────────────────────────────────────────────
  if (input.tradeoffs && input.tradeoffs.length > 0) {
    sections.push("tradeoffs");
    lines.push(`## Tradeoffs`, "");
    for (const t of input.tradeoffs) {
      lines.push(`- ${t}`);
    }
    lines.push("");
  }

  // ── Caveats ──────────────────────────────────────────────────────────
  if (input.caveats && input.caveats.length > 0) {
    sections.push("caveats");
    lines.push(`## Caveats`, "");
    for (const c of input.caveats) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  // ── Gaps ─────────────────────────────────────────────────────────────
  if (input.gaps && input.gaps.length > 0) {
    sections.push("gaps");
    lines.push(`## Gaps`, "");
    for (const g of input.gaps) {
      lines.push(`- ${g}`);
    }
    lines.push("");
  }

  // ── Task Implications (agent/task triggered only) ────────────────────
  if (
    (input.triggerType === "agent" || input.triggerType === "task") &&
    input.taskImplications &&
    input.taskImplications.trim().length > 0
  ) {
    sections.push("task-implications");
    lines.push(`## Implications for Current Task`, "");
    lines.push(input.taskImplications, "");
  }

  // ── Sources ──────────────────────────────────────────────────────────
  if (input.sourceNotes.length > 0) {
    sections.push("sources");
    lines.push(`## Sources`, "");
    for (const note of input.sourceNotes) {
      allCitations.add(note.citationNumber);
      lines.push(
        `[${note.citationNumber}] ${note.title} — ${note.source}`,
      );
      if (note.snippets.length > 0) {
        for (const snip of note.snippets) {
          lines.push(`  > ${snip}`);
        }
      }
      lines.push("");
    }
  }

  // ── Continuation Recommendation ──────────────────────────────────────
  if (
    input.continuationRecommendation &&
    input.continuationRecommendation.trim().length > 0
  ) {
    sections.push("continuation-recommendation");
    lines.push(`## Continuation Recommendation`, "");
    lines.push(input.continuationRecommendation, "");
  }

  // ── Evidence Mix Coverage ────────────────────────────────────────────
  if (
    input.evidenceMixCoverage &&
    input.evidenceMixCoverage.trim().length > 0
  ) {
    sections.push("evidence-coverage");
    lines.push(input.evidenceMixCoverage, "");
  }

  return {
    markdown: lines.join("\n").trim() + "\n",
    sections,
    citations: Array.from(allCitations).sort((a, b) => a - b),
  };
}