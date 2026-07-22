import { defineConfig } from "@playwright/test";

const PORT = 5183;

// P1-journey E2E (constitution II) against the real Vite dev build. The
// Google Identity Services script is stubbed at the browser boundary
// (tests/e2e fixtures) — never at the API-client layer — so the real
// auth/api-client/route-guard code runs; the backend API is stubbed at the
// network layer via Playwright route interception (extension/ mirrors this
// pattern for its own e2e suite).
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_API_BASE_URL: "http://localhost:7071/api",
      VITE_GOOGLE_OAUTH_CLIENT_ID: "e2e-test-client-id.apps.googleusercontent.com",
    },
  },
});
