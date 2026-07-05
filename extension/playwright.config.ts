import { defineConfig } from "@playwright/test";

// E2e tests load the built extension (.output/chrome-mv3) into a persistent
// Chromium context via tests/e2e/fixtures.ts. They are opt-in: see the skip
// message in fixtures.ts for the required env vars.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  retries: 0,
  // Each test launches its own persistent browser context with the extension
  // loaded; run serially to avoid contending for the backend and the display.
  workers: 1,
  reporter: "list",
});
