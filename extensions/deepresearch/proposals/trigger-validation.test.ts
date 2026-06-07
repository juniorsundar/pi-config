import { describe, it, expect } from "vitest";
import { validateTrigger } from "./trigger-validation";

describe("validateTrigger", () => {
  describe("valid triggers (external decision-relevant uncertainty)", () => {
    it("accepts a technology comparison trigger", () => {
      const result = validateTrigger(
        "Evaluating runtime options for a new CLI project",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts a library/provider comparison trigger", () => {
      const result = validateTrigger(
        "Choosing between PostgreSQL and MySQL for the auth service",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts an API behavior trigger", () => {
      const result = validateTrigger(
        "Need current API behavior for Stripe payment integration",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts a benchmark trigger", () => {
      const result = validateTrigger(
        "Comparing Bun vs Node.js performance for HTTP server workloads",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts a pricing comparison trigger", () => {
      const result = validateTrigger(
        "Evaluating cloud provider pricing for a 3-node Kubernetes cluster",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts an architecture decision trigger", () => {
      const result = validateTrigger(
        "Deciding whether to use event sourcing or CRUD for the order domain",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts a recent-changes trigger", () => {
      const result = validateTrigger(
        "Checking for breaking changes in Next.js 15 before upgrading",
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("type-level guard", () => {
    it("rejects null input from JSON deserialization", () => {
      const result = validateTrigger(null as unknown as string);
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "must be a",
      );
    });

    it("rejects undefined input from JSON deserialization", () => {
      const result = validateTrigger(undefined as unknown as string);
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "must be a",
      );
    });
  });

  describe("routine lookup rejection", () => {
    it("rejects a version-check trigger", () => {
      const result = validateTrigger(
        "What is the current version of React?",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "routine lookup",
      );
    });

    it("rejects a how-does-X-work trigger", () => {
      const result = validateTrigger(
        "How does WebSocket work in the browser?",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "routine lookup",
      );
    });

    it("rejects a what-is-X trigger", () => {
      const result = validateTrigger(
        "What does Promise.all do?",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "routine lookup",
      );
    });

    it("rejects a definition-lookup trigger", () => {
      const result = validateTrigger(
        "What is the syntax for async generators?",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "routine lookup",
      );
    });

    it("rejects a codebase-question that matches routine patterns", () => {
      const result = validateTrigger(
        "What does getStatus return?",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "routine lookup",
      );
    });
  });

  describe("local-codebase exploration rejection", () => {
    it("rejects a find-files trigger", () => {
      const result = validateTrigger(
        "Find all TypeScript files in the project",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "local-codebase",
      );
    });

    it("rejects a where-is-the-code-for trigger", () => {
      const result = validateTrigger(
        "Where is the proposal manager implemented?",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "local-codebase",
      );
    });
  });

  describe("curiosity-only rejection", () => {
    it("rejects an i-wonder trigger", () => {
      const result = validateTrigger(
        "I wonder how Bun compares to Node.js",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "decision context",
      );
    });

    it("rejects an interesting-to-know trigger", () => {
      const result = validateTrigger(
        "Interesting to know about WebAssembly performance",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "decision context",
      );
    });

    it("rejects an i-am-curious trigger", () => {
      const result = validateTrigger(
        "I'm curious about how Rust compares to Go for web servers",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "decision context",
      );
    });

    it("rejects a would-be-nice-to-know trigger", () => {
      const result = validateTrigger(
        "It would be nice to know the latest CSS features",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "decision context",
      );
    });
  });

  describe("rejection priority order", () => {
    it("local-codebase detection beats routine lookup when both match", () => {
      // "Find what is X" — starts with "find" (local-codebase) but also
      // contains a "what is" sub-phrase (routine lookup).
      const result = validateTrigger(
        "Find what is the current version of React",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "local-codebase",
      );
    });

    it("routine lookup beats curiosity when both match", () => {
      // "What is interesting to know about Bun?" — starts with "what is"
      // (routine lookup) but also contains "interesting to know" (curiosity).
      const result = validateTrigger(
        "What is interesting to know about Bun performance?",
      );
      expect(result.valid).toBe(false);
      expect((result as { valid: false; reason: string }).reason).toContain(
        "routine lookup",
      );
    });
  });
});
