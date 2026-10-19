import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 60_000,
    // All suites share one set of emulators and one database namespace.
    fileParallelism: false,
  },
});
