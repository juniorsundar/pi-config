/**
 * Evidence Mix — tracks intended evidence categories and their statuses
 * through a Research Run.
 *
 * Each evidence category (e.g., "docs", "benchmarks", "source code") starts
 * as "not-searched" and transitions to one of:
 *   - found:    Sources retrieved for this category
 *   - weak:     Some sources, but insufficient
 *   - missing:  Searched but no relevant sources found
 *   - excluded: User excluded this category
 *   - not-searched: Not yet searched within the run
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type EvidenceStatus =
  | "found"
  | "weak"
  | "missing"
  | "excluded"
  | "not-searched";

export interface CategoryEntry {
  readonly category: string;
  readonly status: EvidenceStatus;
  readonly note?: string;
}

export interface EvidenceMixSnapshot {
  readonly categories: CategoryEntry[];
  readonly found: number;
  readonly weak: number;
  readonly missing: number;
  readonly excluded: number;
  readonly notSearched: number;
  readonly overall: "strong" | "partial" | "weak";
}

// ── EvidenceMix class ────────────────────────────────────────────────────────

export class EvidenceMix {
  private readonly _entries: Map<string, { status: EvidenceStatus; note?: string }>;

  /**
   * Create an EvidenceMix from the intended category names.
   * All categories start as `not-searched`.
   */
  constructor(categories: string[]) {
    this._entries = new Map();
    for (const cat of categories) {
      this._entries.set(cat, { status: "not-searched" });
    }
  }

  /** Return the list of intended category names (read-only). */
  get intendedCategories(): string[] {
    return Array.from(this._entries.keys());
  }

  /** Return a snapshot of all category entries. */
  get categories(): CategoryEntry[] {
    return Array.from(this._entries.entries()).map(([category, entry]) => ({
      category,
      status: entry.status,
      note: entry.note,
    }));
  }

  /**
   * Update the status of a category.
   * Throws if the category is not one of the intended categories.
   */
  update(category: string, status: EvidenceStatus, note?: string): void {
    if (!this._entries.has(category)) {
      throw new Error(
        `Unknown evidence category "${category}". ` +
          `Intended categories: ${this.intendedCategories.join(", ") || "(none)"}`,
      );
    }
    this._entries.set(category, { status, note });
  }

  /**
   * Explicitly mark a specific category as searched.
   * The orchestrator uses this when it knows exactly which category
   * the search was targeting — no heuristic matching needed.
   */
  markCategorySearched(category: string, foundResults: boolean): void {
    if (!this._entries.has(category)) {
      throw new Error(
        `Unknown evidence category "${category}". ` +
          `Intended categories: ${this.intendedCategories.join(", ") || "(none)"}`,
      );
    }
    const entry = this._entries.get(category)!;
    if (entry.status !== "not-searched") return;
    this._entries.set(category, {
      status: foundResults ? "found" : "missing",
      note: foundResults
        ? undefined
        : `No results found for category "${category}".`,
    });
  }

  /**
   * Bulk-update categories from a search query.
   * Matches the query against category names to mark categories as searched.
   */
  markSearched(query: string, foundResults: boolean): void {
    for (const [category, entry] of this._entries.entries()) {
      if (entry.status === "not-searched" && matchesCategory(query, category)) {
        this._entries.set(category, {
          status: foundResults ? "found" : "missing",
          note: foundResults ? undefined : `Search "${query}" returned no results for "${category}"`,
        });
      }
    }
  }

  /**
   * Mark all currently not-searched categories as having been skipped
   * due to budget exhaustion. Appends a budget-related note.
   */
  markNotSearchedDueToBudget(): void {
    for (const [category, entry] of this._entries.entries()) {
      if (entry.status === "not-searched") {
        this._entries.set(category, {
          status: "not-searched",
          note: `Not searched — budget exhausted before "${category}" could be explored.`,
        });
      }
    }
  }

  /**
   * Transform the EvidenceMix into an immutable snapshot for reporting.
   */
  snapshot(): EvidenceMixSnapshot {
    const cats = this.categories;
    const found = cats.filter((c) => c.status === "found").length;
    const weak = cats.filter((c) => c.status === "weak").length;
    const missing = cats.filter((c) => c.status === "missing").length;
    const excluded = cats.filter((c) => c.status === "excluded").length;
    const notSearched = cats.filter((c) => c.status === "not-searched").length;

    let overall: "strong" | "partial" | "weak";
    if (found >= intendedLength(cats) * 0.75 && missing === 0) {
      overall = "strong";
    } else if (found > 0 || weak > 0) {
      overall = "partial";
    } else {
      overall = "weak";
    }

    return { categories: cats, found, weak, missing, excluded, notSearched, overall };
  }

  /**
   * Render a summary of evidence coverage for inclusion in Run Summary or prompt.
   */
  toPromptSection(): string {
    const snap = this.snapshot();
    const lines: string[] = ["## Evidence Coverage", ""];

    for (const cat of snap.categories) {
      const note = cat.note ? ` — ${cat.note}` : "";
      lines.push(`- ${cat.category}: **${cat.status}**${note}`);
      // For not-searched categories, include a suggested search query
      if (cat.status === "not-searched") {
        lines.push(`  Consider searching for: ${cat.category.toLowerCase()}`);
      }
    }

    lines.push(
      "",
      `**Overall**: ${snap.overall}`,
      `Found: ${snap.found} | Weak: ${snap.weak} | Missing: ${snap.missing} | ` +
        `Excluded: ${snap.excluded} | Not searched: ${snap.notSearched}`,
      "",
    );

    return lines.join("\n");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function intendedLength(cats: CategoryEntry[]): number {
  return cats.length || 1; // avoid division by zero
}

/**
 * Heuristic match: returns true if the query contains words from the category
 * name (case-insensitive).
 */
function matchesCategory(query: string, category: string): boolean {
  const queryLower = query.toLowerCase();
  const catWords = category.toLowerCase().split(/[\s_-]+/);
  return catWords.some((word) => word.length > 2 && queryLower.includes(word));
}