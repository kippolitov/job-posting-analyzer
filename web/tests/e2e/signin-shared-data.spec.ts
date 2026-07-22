import { test, expect, type Page } from "@playwright/test";

/**
 * P1 journey (constitution II — E2E MUST cover every P1 journey): sign in
 * on the web and see the same shared library + profile, and a signed-out
 * visitor reaches zero account data (spec US1, SC-010).
 *
 * The Google Identity Services script is stubbed at the browser boundary
 * (window.google, via addInitScript, installed before any page script
 * runs) — never inside the app's own auth/api-client code, which executes
 * for real. The backend is stubbed at the network layer (Playwright route
 * interception), mirroring how extension/tests/e2e stubs chrome.identity
 * rather than the extension's own auth module.
 */

function fakeIdToken(claims: { sub?: string; email?: string; exp?: number } = {}): string {
  const base64url = (input: string) => Buffer.from(input).toString("base64url");
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: "e2e-user-1",
      email: "e2e@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    })
  );
  return `${header}.${payload}.fake-signature`;
}

async function stubGoogleIdentity(page: Page, idToken: string): Promise<void> {
  await page.addInitScript((token) => {
    let storedCallback: ((response: { credential: string }) => void) | null = null;
    (window as unknown as { google: unknown }).google = {
      accounts: {
        id: {
          initialize: (config: { callback: (response: { credential: string }) => void }) => {
            storedCallback = config.callback;
          },
          prompt: () => {
            storedCallback?.({ credential: token });
          },
          renderButton: () => {},
          disableAutoSelect: () => {},
        },
      },
    };
  }, idToken);
}

const FAKE_JOB = {
  schemaVersion: 1,
  canonicalUrl: "https://example.com/jobs/e2e",
  sourceUrl: "https://example.com/jobs/e2e",
  source: "url",
  filename: "",
  status: "interested",
  notes: "",
  savedAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  analysis: {
    isJobPosting: true,
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    location: "Remote (US)",
    arrangement: "hybrid",
    arrangementConfidence: "explicit",
    arrangementEvidence: "3 days per week in our downtown office",
    daysInOffice: 3,
    daysRemote: 2,
    remoteRestrictions: null,
    salary: { min: 150000, max: 190000, currency: "USD", period: "year" },
    seniority: "senior",
    techStack: ["Go", "Postgres"],
    fit: null,
    model: "gpt-4o-mini",
    analyzedAt: "2026-07-01T00:00:00.000Z",
  },
};

const FAKE_PROFILE = {
  text: "Backend engineer, 8 years, Go and distributed systems.",
  dealbreakers: [],
  updatedAt: "2026-07-01T00:00:00.000Z",
  schemaVersion: 1,
};

test.describe("Sign in on the web and see the same data (P1)", () => {
  test("signed-out load shows only the landing page and fires no account API call", async ({ page }) => {
    // Match only the backend API origin — Vite's dev server also serves
    // this app's own src/api/*.ts source modules, whose URLs happen to
    // contain "/api/" too and must not be mistaken for backend calls.
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http://localhost:7071/api/")) {
        apiRequests.push(request.url());
      }
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: /job posting analyzer/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with google/i })).toBeVisible();
    expect(apiRequests).toEqual([]);
  });

  test("signed-in load renders the shared library and profile", async ({ page }) => {
    const token = fakeIdToken();
    await stubGoogleIdentity(page, token);

    await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [FAKE_JOB] } }));
    await page.route("**/api/profile", (route) => route.fulfill({ json: FAKE_PROFILE }));

    await page.goto("/");

    await expect(page.getByRole("link", { name: /senior backend engineer/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Acme Corp")).toBeVisible();

    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page.getByText(/Backend engineer, 8 years/i)).toBeVisible();
  });
});
