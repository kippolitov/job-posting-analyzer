import http from "node:http";
import { test, expect, e2eEnabled, skipReason } from "./fixtures";
import type { BrowserContext } from "@playwright/test";

/**
 * US4 cache-bypass journey (spec T062, SC-008a): analyze a page normally
 * (populating the session cache keyed by canonical URL), then scope a
 * DIFFERENT region on the SAME URL via the panel's keyboard region list.
 * The scoped result must come back — never the stored one — which is only
 * true if `jobFlow.ts`'s `analyzeScopedRegion` sets `bypassCache` on every
 * scoped analysis (T073). Requires a live backend baked into the build (see
 * skipReason) run with REQUIRE_AUTH=false, same as jobAnalyzer.spec.ts.
 */

test.skip(!e2eEnabled, skipReason);

// Two structurally separate regions on one page, scored far enough apart
// that the automatic ladder reliably picks `main` (research R3's scorer:
// text length is the dominant term) while the second stays a discoverable,
// lower-ranked candidate rather than a near-duplicate of it.
const POSTING_HTML = `<!doctype html>
<html><head><title>Senior Backend Engineer - Acme</title></head>
<body>
<main>
  <h1>Senior Backend Engineer</h1>
  <p>Acme is hiring a Senior Backend Engineer. This is an onsite role, five days
  a week in our Austin office.
  ${"We build services in C# and .NET 8 on Azure, using Kubernetes and Terraform. ".repeat(30)}</p>
</main>
<div class="remote-posting">
  <h2>Remote Support Specialist</h2>
  <p>This is a fully remote position, based anywhere in the US.
  ${"You will troubleshoot customer issues and write internal tooling. ".repeat(6)}</p>
</div>
</body></html>`;

function serveFixture(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(POSTING_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${address.port}/jobs/scope-e2e` });
    });
  });
}

async function seedStubAuth(context: BrowserContext): Promise<void> {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: "sub-scope-e2e",
      email: "scope-e2e@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url");
  await worker.evaluate(
    async (stored) => {
      await chrome.storage.local.set({ "auth:session": stored });
    },
    {
      idToken: `${header}.${payload}.stub-signature`,
      expiresAt: Date.now() + 3600_000,
      signedInAt: Date.now(),
      user: { sub: "sub-scope-e2e", email: "scope-e2e@example.com" },
    }
  );
}

test("scoping a different region on the same URL returns the scoped result, never the cached one (SC-008a)", async ({
  context,
  extensionId,
}) => {
  await seedStubAuth(context);
  const { server, url } = await serveFixture();
  try {
    const postingPage = await context.newPage();
    await postingPage.goto(url);

    const sidePanel = await context.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Automatic analysis picks the semantic container (`main`) and populates
    // the session cache for this URL.
    await expect(
      sidePanel.getByText("Senior Backend Engineer").first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(sidePanel.getByText(/onsite/i).first()).toBeVisible();

    // Scope the OTHER region via the keyboard region list.
    await sidePanel
      .getByRole("button", { name: /analyze a region/i })
      .click();
    const remoteOption = sidePanel
      .getByRole("option")
      .filter({ hasText: /remote support specialist/i });
    await expect(remoteOption).toBeVisible({ timeout: 15_000 });
    await remoteOption.click();

    // The scoped result must reflect the newly scoped region, not a replay
    // of the cached automatic result — same URL, deliberately different text.
    await expect(
      sidePanel.getByText("Remote Support Specialist").first()
    ).toBeVisible({ timeout: 60_000 });
    // The region option above also matches the title text, so it does not
    // prove the scoped result arrived: wait for the result itself.
    await expect(sidePanel.getByText(/fully remote/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(sidePanel.getByText("Senior Backend Engineer")).toHaveCount(0);

    // A fresh, bypassed analysis is not the cached one.
    await expect(sidePanel.getByText(/from cache/i)).toHaveCount(0);
  } finally {
    server.close();
  }
});
