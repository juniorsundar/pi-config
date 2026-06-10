import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ResearchStateManager } from "./state-manager";

let tempDir: string;
let workDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "dr-state-test-"));
  workDir = join(tempDir, "project");
  const { mkdirSync } = require("fs");
  mkdirSync(workDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("ResearchStateManager", () => {
  describe("slugify", () => {
    it("converts a topic to a URL-safe slug", () => {
      expect(ResearchStateManager.slugify("Why did Rust 2024 change range syntax?")).toBe(
        "why-did-rust-2024-change-range-syntax",
      );
    });

    it("collapses multiple special characters", () => {
      expect(ResearchStateManager.slugify("Hello   World!!!")).toBe("hello-world");
    });

    it("trims leading and trailing dashes", () => {
      expect(ResearchStateManager.slugify("--hello--")).toBe("hello");
    });

    it("truncates to 80 characters", () => {
      const long = "a".repeat(200);
      expect(ResearchStateManager.slugify(long).length).toBeLessThanOrEqual(80);
    });

    it("handles empty string", () => {
      expect(ResearchStateManager.slugify("")).toBe("");
    });
  });

  describe("initialize", () => {
    it("creates the research directory and state.md", () => {
      const mgr = new ResearchStateManager(workDir, "test-topic");
      mgr.initialize("Test Topic", "What is the answer?");

      expect(existsSync(mgr.stateFile)).toBe(true);
      expect(existsSync(join(mgr["baseDir"], "steps"))).toBe(true);
    });

    it("writes initial state with topic and question", () => {
      const mgr = new ResearchStateManager(workDir, "test-topic");
      mgr.initialize("Test Topic", "What is the answer?");

      const content = readFileSync(mgr.stateFile, "utf-8");
      expect(content).toContain("Test Topic");
      expect(content).toContain("What is the answer?");
      expect(content).toContain("## Status\nactive");
    });
  });

  describe("read and write", () => {
    it("reads back written content", () => {
      const mgr = new ResearchStateManager(workDir, "test-topic");
      mgr.initialize("Test", "Q?");
      mgr.write("# Custom content\nHello");
      expect(mgr.read()).toBe("# Custom content\nHello");
    });
  });

  describe("archiveStep", () => {
    it("writes step output to steps/<agent-id>.md and returns a StepRecord", () => {
      const mgr = new ResearchStateManager(workDir, "test-topic");
      mgr.initialize("Test", "Q?");

      const record = mgr.archiveStep("Search result: found X", "r-search", "r-search-abc123");

      expect(record.agentType).toBe("r-search");
      expect(record.agentId).toBe("r-search-abc123");
      expect(record.outputFile).toContain("r-search-abc123.md");

      // Check the file was written
      expect(existsSync(record.outputFile)).toBe(true);
      const stepContent = readFileSync(record.outputFile, "utf-8");
      expect(stepContent).toContain("Search result: found X");
      expect(stepContent).toContain("r-search-abc123");
    });
  });

  describe("appendStepToState", () => {
    it("adds a step record to the Steps Completed section", () => {
      const mgr = new ResearchStateManager(workDir, "test-topic");
      mgr.initialize("Test", "Q?");

      const state = mgr.read();
      const record = {
        agentType: "r-search",
        agentId: "r-search-abc",
        timestamp: 1700000000000,
        summary: "Found relevant results",
        outputFile: "/path/to/step.md",
      };
      const updated = mgr.appendStepToState(state, record);

      expect(updated).toContain("r-search-abc");
      expect(updated).toContain("Found relevant results");
      expect(updated).toContain("## Steps Completed");
    });
  });

  describe("markComplete", () => {
    it("changes status from active to complete", () => {
      const mgr = new ResearchStateManager(workDir, "test-topic");
      mgr.initialize("Test", "Q?");
      const state = mgr.read();
      const updated = mgr.markComplete(state);
      expect(updated).toContain("## Status\ncomplete");
      expect(updated).not.toContain("## Status\nactive");
    });
  });

  describe("exists", () => {
    it("returns false when state.md does not exist", () => {
      const mgr = new ResearchStateManager(workDir, "nonexistent");
      expect(mgr.exists()).toBe(false);
    });

    it("returns true after initialize", () => {
      const mgr = new ResearchStateManager(workDir, "test-topic");
      mgr.initialize("Test", "Q?");
      expect(mgr.exists()).toBe(true);
    });
  });

  describe("full lifecycle", () => {
    it("supports a complete research iteration flow", () => {
      const slug = ResearchStateManager.slugify("What is the meaning of life?");
      const mgr = new ResearchStateManager(workDir, slug);
      mgr.initialize("Meaning of Life", "What is the meaning of life?");

      // Initial state
      let state = mgr.read();
      expect(state).toContain("Meaning of Life");
      expect(state).toContain("## Status\nactive");

      // Simulate r-search step
      const searchRecord = mgr.archiveStep("Found: 42 (source: h2g2)", "r-search", "r-search-42");
      state = mgr.appendStepToState(state, searchRecord);
      mgr.write(state);

      // Simulate r-synth step
      const synthRecord = mgr.archiveStep(
        "The meaning of life is 42, according to Deep Thought.",
        "r-synth", "r-synth-42",
      );
      state = mgr.read();
      state = mgr.appendStepToState(state, synthRecord);
      state = mgr.markComplete(state);
      mgr.write(state);

      // Final state
      const finalState = mgr.read();
      expect(finalState).toContain("## Status\ncomplete");
      expect(finalState).toContain("r-search-42");
      expect(finalState).toContain("r-synth-42");

      // Steps are archived
      const stepsDir = join(mgr["baseDir"], "steps");
      const files = readdirSync(stepsDir);
      expect(files).toContain("r-search-42.md");
      expect(files).toContain("r-synth-42.md");
    });
  });
});
