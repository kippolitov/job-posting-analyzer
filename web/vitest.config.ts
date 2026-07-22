import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      shared: path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/contract/**/*.test.ts",
      "tests/contract/**/*.test.tsx",
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
