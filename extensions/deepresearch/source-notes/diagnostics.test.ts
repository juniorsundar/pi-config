import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeRawContentToDiagnostics } from "./diagnostics";

describe("writeRawContentToDiagnostics", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("writes raw content to a diagnostics subdirectory", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "diag-test-"));
    tmpDirs.push(tmpDir);
    const runDir = join(tmpDir, "runs", "test-run-001");
    const content = "Raw fetched content with full body text.";

    const resultPath = writeRawContentToDiagnostics(runDir, "https://example.com/doc", content);

    expect(resultPath).toBe(join(runDir, "diagnostics", "raw", "https%3A%2F%2Fexample.com%2Fdoc.md"));
    expect(existsSync(resultPath)).toBe(true);
    expect(readFileSync(resultPath, "utf-8")).toBe(content);
  });

  it("overwrites existing diagnostics file for the same source", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "diag-test-"));
    tmpDirs.push(tmpDir);
    const runDir = join(tmpDir, "runs", "test-run-002");

    const path1 = writeRawContentToDiagnostics(runDir, "https://example.com/doc", "version 1");
    const path2 = writeRawContentToDiagnostics(runDir, "https://example.com/doc", "version 2");

    expect(path1).toBe(path2);
    expect(readFileSync(path1, "utf-8")).toBe("version 2");
  });

  it("creates intermediate directories", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "diag-test-"));
    tmpDirs.push(tmpDir);
    const deepPath = join(tmpDir, "deep", "nested", "run");

    const resultPath = writeRawContentToDiagnostics(deepPath, "/tmp/local-file.txt", "local content");

    expect(existsSync(resultPath)).toBe(true);
    expect(readFileSync(resultPath, "utf-8")).toBe("local content");
  });
});