import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary", "json"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      include: ["services/**", "components/**", "entrypoints/**", "types/**", "lib/**"],
      exclude: ["node_modules", "tests", "output"],
    },
  },
});
