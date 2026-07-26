import { defineConfig } from "@playwright/test";

// Two projects with different requirements:
//
//   e2e       — loads the built extension (output/chrome-mv3) into a persistent
//               Chromium context via tests/e2e/fixtures.ts. Opt-in: see the skip
//               message in fixtures.ts for the required env vars.
//   extractor — evaluates extractPage in a plain Chromium page against the
//               captured corpus and the synthetic hydration fixtures. Needs
//               neither a built extension nor a live backend, so it can run in
//               CI unconditionally. This is the lane research R9 requires: jsdom
//               has no innerText, so extractor assertions in vitest silently
//               exercise the textContent branch.
export default defineConfig({
  timeout: 180_000,
  retries: 0,
  // Each e2e test launches its own persistent browser context with the
  // extension loaded; run serially to avoid contending for the backend and the
  // display. The extractor project inherits this for output legibility.
  workers: 1,
  reporter: "list",
  projects: [
    { name: "extractor", testDir: "./tests/extractor" },
    { name: "e2e", testDir: "./tests/e2e" },
  ],
});
