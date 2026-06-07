/**
 * Shared helpers for identity generation across the extension.
 */

import type { RunIdentity } from "../domain/types";

/**
 * Convert arbitrary text into a URL-safe slug.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/**
 * Generate a random hex string of the given length.
 */
export function randomHex(length: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

/**
 * Generate a unique RunIdentity from a question string.
 * Format: <date>-<slug>-<8-char-hex-short-id>
 */
export function generateIdentity(question: string): RunIdentity {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(question);
  const shortId = randomHex(8);
  return {
    id: `${date}-${slug}-${shortId}`,
    date,
    slug,
    shortId,
  };
}
