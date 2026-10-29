import { test, expect, type Page } from "@playwright/test";

/**
 * P1 journey (constitution II) for 006 US1 on the web: stale scores are
 * marked and filterable, rescore links lead to the right place, and a pasted
 * posting can be analyzed and saved. Same stubbing approach as
 * signin-shared-data.spec.ts: GIS at the browser boundary, the backend at the
 * network layer.
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
const OLDER = "o".repeat(64);

function savedJob(
  title: string,
  extra: { fingerprint?: string; source?: "url" | "document"; canonicalUrl?: string; score?: number }
) {
  const canonicalUrl = extra.canonicalUrl ?? `https://example.com/jobs/${title.replace(/\s/g, "-")}`;
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: extra.source === "document" ? "" : canonicalUrl,
    source: extra.source ?? "url",
    filename: extra.source === "document" ? "posting.pdf" : "",
    status: "interested",
    notes: "",
    savedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    analysis: {
      isJobPosting: true,
      title,
      company: "Acme",
      location: null,
      arrangement: "remote",
      arrangementConfidence: "explicit",
      arrangementEvidence: null,
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "senior",
      techStack: [],
      fit: {
        score: extra.score ?? 60,
        rationale: "r",
        ...(extra.fingerprint ? { profileFingerprint: extra.fingerprint } : {}),
      },
      model: "m",
      analyzedAt: "2026-07-01T00:00:00.000Z",
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

test.describe("Profile freshness on the web (P1)", () => {
  test("marks stale rows, filters to the current profile, and links to the rescore path", async ({
    page,
  }) => {
    await stubGoogleIdentity(page, fakeIdToken());
    const jobs = [
      savedJob("Current Role", { fingerprint: CURRENT, score: 90 }),
      savedJob("Stale Role", { fingerprint: OLDER, score: 80 }),
      savedJob("Unversioned Role", { score: 70 }),
      savedJob("Stale Doc", {
        fingerprint: OLDER,
        source: "document",
        canonicalUrl: "doc:e2e",
        score: 10,
      }),
    ];
    await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs } }));
    await page.route("**/api/profile", (route) => route.fulfill({ json: PROFILE }));

    await page.goto("/");

    await expect(page.getByText("Scored against an older profile").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("May be out of date")).toBeVisible();

    // Stale rows still sort by their number.
    await page.getByLabel("Sort").selectOption("fit-desc");
    const titles = await page.getByRole("listitem").getByRole("link").allInnerTexts();
    expect(titles.filter((t) => /^(\w+ )+(Role|Doc)$/.test(t))).toEqual([
      "Current Role",
      "Stale Role",
      "Unversioned Role",
      "Stale Doc",
    ]);

    await page.getByRole("checkbox", { name: "Current profile only" }).check();
    await expect(page.getByRole("link", { name: "Current Role" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Stale Role" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Unversioned Role" })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Current profile only" }).uncheck();

    // URL-sourced detail: Open posting to rescore -> its source page.
    await page.getByRole("link", { name: "Stale Role" }).click();
    await expect(page.getByRole("link", { name: "Open posting to rescore" })).toHaveAttribute(
      "href",
      "https://example.com/jobs/Stale-Role"
    );

    // Document-sourced detail: Upload again to rescore.
    await page.goto("/library/" + encodeURIComponent("doc:e2e"));
    await expect(page.getByRole("link", { name: "Upload again to rescore" })).toHaveAttribute(
      "href",
      /\/upload\?rescore=[0-9a-f]{64}$/
    );
  });

  test("Paste text analyzes a pasted posting and saves a paste: entry", async ({ page }) => {
    await stubGoogleIdentity(page, fakeIdToken());
    await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
    await page.route("**/api/profile", (route) => route.fulfill({ json: PROFILE }));
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: {
          email: "e2e@example.com",
          tier: "free",
          usage: { count: 1, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z" },
          subscription: null,
        },
      })
    );

    let analyzeBody = "";
    await page.route("**/api/analyze-document", async (route) => {
      analyzeBody = route.request().postData() ?? "";
      await route.fulfill({
        json: {
          analysis: savedJob("Pasted Role", { fingerprint: CURRENT }).analysis,
          source: "paste",
          canonicalUrl: `paste:${"a".repeat(64)}`,
          saveKey: "b".repeat(64),
          usage: { count: 2, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z", tier: "free" },
        },
      });
    });
    let savedBody: Record<string, unknown> | null = null;
    await page.route("**/api/jobs/*", async (route) => {
      if (route.request().method() === "PUT") {
        savedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ json: savedBody });
      } else {
        await route.fallback();
      }
    });

    await page.goto("/upload?mode=paste");
    await expect(page.getByRole("heading", { name: "Analyze a posting" })).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByLabel("Pasted job posting")
      .fill("We are hiring a Software Engineer in Austin. ".repeat(12));
    await page.getByRole("button", { name: "Analyze" }).click();

    await expect(page.getByText("From pasted text")).toBeVisible();
    expect(analyzeBody).toContain('name="text"');
    expect(analyzeBody).not.toContain('name="file"');
    expect(analyzeBody).toContain('name="profileData"');

    await page.getByRole("button", { name: "Save to library" }).click();
    await expect(page.getByText("Saved to your library.")).toBeVisible();
    expect(savedBody).toMatchObject({
      source: "paste",
      sourceUrl: "",
      filename: "",
      canonicalUrl: `paste:${"a".repeat(64)}`,
    });
  });
});
