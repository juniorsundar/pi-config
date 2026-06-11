import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["node"],
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
  },
});
