import { join } from "path";
import { mkdirSync } from "fs";

/**
 * Initialize the Workspace Research Store under the given workspace root.
 * Creates `.pi/research/` with `proposals/`, `runs/`, and `diagnostics/`
 * subdirectories. Idempotent — safe to call multiple times.
 *
 * Returns the store path.
 */
export function initStore(cwd: string): string {
  const storePath = getStorePath(cwd);
  mkdirSync(join(storePath, "proposals"), { recursive: true });
  mkdirSync(join(storePath, "runs"), { recursive: true });
  mkdirSync(join(storePath, "diagnostics"), { recursive: true });
  return storePath;
}

/**
 * Return the canonical Workspace Research Store path for a workspace.
 * Pure — does not create directories or perform I/O.
 */
export function getStorePath(cwd: string): string {
  return join(cwd, ".pi", "research");
}
