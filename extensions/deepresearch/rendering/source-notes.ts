/**
 * Shared utility for parsing source note markdown files.
 *
 * Source notes follow a consistent format:
 *
 * # Source Note N
 * **Source**: <url>
 * **Title**: <title>
 * ...
 * ## Snippets
 * - [N:1] snippet text
 */

import { join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";

export interface ParsedSourceNote {
  url: string;
  title: string;
  citationNumber: number;
  snippets: string[];
}

/**
 * Parse a source note markdown string into structured data.
 * Returns null if the content cannot be parsed (no h1 heading found).
 */
export function parseSourceNote(content: string): ParsedSourceNote | null {
  // Extract citation number from h1
  const h1Match = content.match(/^# Source Note (\d+)/m);
  if (!h1Match) return null;
  const citationNumber = parseInt(h1Match[1], 10);

  // Extract source URL
  const sourceMatch = content.match(/^\*\*Source\*\*:\s*(.+)$/m);
  const url = sourceMatch?.[1]?.trim() ?? "";

  // Extract title
  const titleMatch = content.match(/^\*\*Title\*\*:\s*(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? `Source ${citationNumber}`;

  // Extract snippets
  const snippets: string[] = [];
  const lines = content.split("\n");
  let inSnippets = false;
  for (const line of lines) {
    if (line.startsWith("## Snippets")) {
      inSnippets = true;
      continue;
    }
    if (inSnippets && /^#+\s/.test(line.trim())) {
      if (!line.startsWith("## Snippets")) {
        inSnippets = false;
        continue;
      }
    }
    if (inSnippets && line.startsWith("- [")) {
      const snippetMatch = line.match(/^-\s*\[\d+:\d+\]\s*(.+)$/);
      if (snippetMatch) {
        snippets.push(snippetMatch[1].trim());
      }
    }
  }

  return { url, title, citationNumber, snippets };
}

/**
 * Read and parse all source notes from a run's source-notes directory.
 * Skips unparseable files gracefully. Returns an empty array if the
 * directory doesn't exist or contains no valid notes.
 */
export function readSourceNotes(runDir: string): ParsedSourceNote[] {
  const notesDir = join(runDir, "source-notes");
  if (!existsSync(notesDir)) return [];

  try {
    const files = readdirSync(notesDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .sort();

    const notes: ParsedSourceNote[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(notesDir, file.name), "utf-8");
        const note = parseSourceNote(content);
        if (note) notes.push(note);
      } catch {
        // Skip unparseable source notes
      }
    }

    return notes;
  } catch {
    return [];
  }
}