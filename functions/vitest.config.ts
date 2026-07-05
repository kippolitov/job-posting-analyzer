import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary", "json"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      include: ["src/**"],
      exclude: ["node_modules", "tests", "dist"],
    },
  },
});
