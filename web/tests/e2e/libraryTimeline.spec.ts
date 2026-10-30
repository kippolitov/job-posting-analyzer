import { test, expect, type Page } from "@playwright/test";

/**
 * P1 journey (constitution II) for 006 US6 on the web: the Library is a
 * timeline grouped by save day, and Compare is a requirements table in a
 * dialog opened from it. Same stubbing approach as profileFreshness.spec.ts.
 */

function fakeIdToken(): string {
  const base64url = (input: string) => Buffer.from(input).toString("base64url");
  return [
    base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64url(
      JSON.stringify({
        sub: "e2e-user-1",
        email: "e2e@example.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ),
    "fake-signature",
  ].join(".");
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
          prompt: () => storedCallback?.({ credential: token }),
          renderButton: () => {},
          disableAutoSelect: () => {},
        },
      },
    };
  }, idToken);
}

const CURRENT = "c".repeat(64);
const DAY = 86_400_000;

function savedJob(
  title: string,
  daysAgo: number,
  fit: { score: number; matching?: string[]; missing?: string[] }
) {
  const canonicalUrl = `https://example.com/jobs/${title.replace(/\s/g, "-")}`;
  const savedAt = new Date(Date.now() - daysAgo * DAY).toISOString();
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    source: "url",
    filename: "",
    status: "interested",
    notes: "",
    savedAt,
    updatedAt: savedAt,
    analysis: {
      isJobPosting: true,
      title,
      company: "Acme",
      location: "Austin, TX",
      arrangement: "hybrid",
      arrangementConfidence: "explicit",
      arrangementEvidence: null,
      daysInOffice: 2,
      daysRemote: 3,
      remoteRestrictions: null,
      salary: { min: 100000, max: 120000, currency: "USD", period: "year" },
      seniority: "senior",
      techStack: [],
      fit: { rationale: "r", profileFingerprint: CURRENT, ...fit },
      model: "m",
      analyzedAt: savedAt,
    },
  };
}

const PROFILE = {
  text: "Backend engineer.",
  dealbreakers: [],
  updatedAt: "2026-07-01T00:00:00.000Z",
  schemaVersion: 1,
  fingerprint: CURRENT,
};

test.describe("Library timeline and Compare dialog (P1)", () => {
  test("groups by day, shows key facts, and compares two postings in a dialog", async ({ page }) => {
    await stubGoogleIdentity(page, fakeIdToken());
    const jobs = [
      savedJob("Today Role", 0, { score: 90, matching: ["Kubernetes"], missing: ["Go"] }),
      savedJob("Yesterday Role", 1, { score: 70, matching: ["Go"] }),
      savedJob("Old Role", 40, { score: 30 }),
    ];
    await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs } }));
    await page.route("**/api/profile", (route) => route.fulfill({ json: PROFILE }));

    await page.goto("/");

    await expect(page.getByRole("heading", { level: 3, name: "Today" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("heading", { level: 3, name: "Yesterday" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(3);

    const entry = page.getByRole("listitem").filter({ hasText: "Today Role" });
    await expect(entry).toContainText("Strong match");
    await expect(entry).toContainText("USD 100,000 – 120,000/year");
    await expect(entry).toContainText("Hybrid · 2 days in office");
    await expect(entry).toContainText("Austin, TX");

    const compare = page.getByRole("button", { name: "Compare" });
    await expect(compare).toBeDisabled();
    await page.getByLabel("Select Today Role for comparison").check();
    await page.getByLabel("Select Yesterday Role for comparison").check();
    await compare.click();

    const dialog = page.getByRole("dialog", { name: "Compare postings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("columnheader")).toHaveCount(3);
    await expect(dialog.getByRole("row")).toHaveCount(3); // header + Go + Kubernetes
    await expect(dialog.getByRole("rowheader", { name: "Go" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(compare).toBeFocused();
  });
});
