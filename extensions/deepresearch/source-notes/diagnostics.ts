import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

/**
 * Directory within a run's artifacts for raw source content diagnostics.
 */
const DIAG_RAW_DIR = join("diagnostics", "raw");

/**
 * Write raw full source content to the Run Diagnostics directory.
 *
 * Raw content is excluded from normal Source Note artifacts — this helper
 * stores it only when explicitly needed (e.g. for debugging or auditing).
 * The filename encodes the source URI to avoid collisions.
 *
 * @param runDir  - The run artifact directory (e.g. `.pi/research/runs/<run-id>`)
 * @param source  - The source URI (URL or file path) the content was retrieved from
 * @param content - The raw full source content to store
 * @returns The path to the written diagnostics file
 */
export function writeRawContentToDiagnostics(
  runDir: string,
  source: string,
  content: string,
): string {
  const safeName = encodeURIComponent(source) + ".md";
  const filePath = join(runDir, DIAG_RAW_DIR, safeName);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");

  return filePath;
}