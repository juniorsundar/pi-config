import { describe, it, expect, beforeEach } from "vitest";
import { createRegistry } from "./registry";

describe("BTW Registry", () => {
  describe("Slice 1: Tracer bullet — addRunning + getRunning", () => {
    it("addRunning() adds an entry visible in getRunning()", () => {
      const registry = createRegistry();
      const mockChild = { pid: 12345 } as any;

      registry.addRunning("btw-1", "What is the capital of France?", mockChild);

      const running = registry.getRunning();
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe("btw-1");
      expect(running[0].query).toBe("What is the capital of France?");
      expect(running[0].childProcess).toBe(mockChild);
      expect(running[0].startedAt).toBeInstanceOf(Date);
    });

    it("getRunning() returns empty array when no entries added", () => {
      const registry = createRegistry();
      expect(registry.getRunning()).toEqual([]);
    });

    it("addRunning() with the same id overwrites the previous entry", () => {
      const registry = createRegistry();
      const child1 = { pid: 111 } as any;
      const child2 = { pid: 222 } as any;

      registry.addRunning("btw-1", "First query", child1);
      registry.addRunning("btw-1", "Second query", child2);

      const running = registry.getRunning();
      expect(running).toHaveLength(1);
      expect(running[0].childProcess).toBe(child2);
    });
  });

  describe("Slice 2: complete — success result moves entry to completed", () => {
    it("complete() removes entry from running", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "What is pi?", { pid: 1 } as any);

      registry.complete("btw-1", { type: "success", text: "3.14159" });

      expect(registry.getRunning()).toHaveLength(0);
    });

    it("complete() adds a success result to completed entries", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "What is pi?", { pid: 1 } as any);

      registry.complete("btw-1", { type: "success", text: "3.14159" });

      const completed = registry.getCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe("btw-1");
      expect(completed[0].query).toBe("What is pi?");
      expect(completed[0].result).toEqual({ type: "success", text: "3.14159" });
      expect(completed[0].completedAt).toBeInstanceOf(Date);
    });

    it("complete() on unknown id is a no-op", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Q1", { pid: 1 } as any);

      registry.complete("btw-999", { type: "success", text: "irrelevant" });

      // Original entry still running
      expect(registry.getRunning()).toHaveLength(1);
      expect(registry.getCompleted()).toHaveLength(0);
    });
  });

  describe("Slice 3: fail — error result moves entry to completed", () => {
    it("fail() removes entry from running", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Question?", { pid: 1 } as any);

      registry.fail("btw-1", "Process timed out");

      expect(registry.getRunning()).toHaveLength(0);
    });

    it("fail() adds an error result to completed entries", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Question?", { pid: 1 } as any);

      registry.fail("btw-1", "Process timed out");

      const completed = registry.getCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe("btw-1");
      expect(completed[0].result).toEqual({ type: "error", error: "Process timed out" });
    });

    it("fail() on unknown id is a no-op", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Q1", { pid: 1 } as any);

      registry.fail("btw-999", "Error");

      expect(registry.getRunning()).toHaveLength(1);
      expect(registry.getCompleted()).toHaveLength(0);
    });
  });

  describe("Slice 4: Multiple concurrent running entries", () => {
    it("multiple entries can coexist without overwriting", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Q1", { pid: 1 } as any);
      registry.addRunning("btw-2", "Q2", { pid: 2 } as any);
      registry.addRunning("btw-3", "Q3", { pid: 3 } as any);

      const running = registry.getRunning();
      expect(running).toHaveLength(3);
      const ids = running.map((e) => e.id).sort();
      expect(ids).toEqual(["btw-1", "btw-2", "btw-3"]);
    });

    it("completing one entry does not affect other running entries", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Q1", { pid: 1 } as any);
      registry.addRunning("btw-2", "Q2", { pid: 2 } as any);

      registry.complete("btw-1", { type: "success", text: "Answer 1" });

      expect(registry.getRunning()).toHaveLength(1);
      expect(registry.getRunning()[0].id).toBe("btw-2");
      expect(registry.getCompleted()).toHaveLength(1);
      expect(registry.getCompleted()[0].id).toBe("btw-1");
    });
  });

  describe("Slice 5: Newest-first ordering of completed entries", () => {
    it("getCompleted() returns newest-first", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Old", { pid: 1 } as any);
      registry.addRunning("btw-2", "Middle", { pid: 2 } as any);
      registry.addRunning("btw-3", "New", { pid: 3 } as any);

      registry.complete("btw-1", { type: "success", text: "A" });
      registry.complete("btw-2", { type: "success", text: "B" });
      registry.complete("btw-3", { type: "success", text: "C" });

      const completed = registry.getCompleted();
      expect(completed).toHaveLength(3);
      expect(completed[0].id).toBe("btw-3"); // most recent first
      expect(completed[1].id).toBe("btw-2");
      expect(completed[2].id).toBe("btw-1"); // oldest last
    });

    it("newest-first ordering holds with mixed success and failure", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "First", { pid: 1 } as any);
      registry.addRunning("btw-2", "Second", { pid: 2 } as any);

      registry.complete("btw-1", { type: "success", text: "OK" });
      registry.fail("btw-2", "Error");

      const completed = registry.getCompleted();
      expect(completed[0].id).toBe("btw-2"); // more recent
      expect(completed[1].id).toBe("btw-1");
    });
  });

  describe("Slice 6: killAll — terminate all running processes", () => {
    it("killAll() terminates all running child processes", () => {
      const registry = createRegistry();
      const killed: number[] = [];
      const child1 = { pid: 1, kill: (sig: string) => { killed.push(1); } } as any;
      const child2 = { pid: 2, kill: (sig: string) => { killed.push(2); } } as any;

      registry.addRunning("btw-1", "Q1", child1);
      registry.addRunning("btw-2", "Q2", child2);

      registry.killAll();

      expect(killed).toEqual(expect.arrayContaining([1, 2]));
    });

    it("killAll() clears the running map", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Q1", { pid: 1, kill: () => {} } as any);

      registry.killAll();

      expect(registry.getRunning()).toHaveLength(0);
    });

    it("killAll() is safe when no entries are running", () => {
      const registry = createRegistry();
      expect(() => registry.killAll()).not.toThrow();
    });
  });

  describe("Slice 7: clear — resets all state", () => {
    it("clear() removes running entries", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Q1", { pid: 1, kill: () => {} } as any);

      registry.clear();

      expect(registry.getRunning()).toHaveLength(0);
    });

    it("clear() removes completed entries", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Q1", { pid: 1 } as any);
      registry.complete("btw-1", { type: "success", text: "OK" });

      registry.clear();

      expect(registry.getCompleted()).toHaveLength(0);
    });

    it("clear() resets both running and completed simultaneously", () => {
      const registry = createRegistry();
      registry.addRunning("btw-1", "Q1", { pid: 1, kill: () => {} } as any);
      registry.addRunning("btw-2", "Q2", { pid: 2 } as any);
      registry.complete("btw-2", { type: "success", text: "OK" });

      registry.clear();

      expect(registry.getRunning()).toHaveLength(0);
      expect(registry.getCompleted()).toHaveLength(0);
    });
  });
});
