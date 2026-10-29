import http from "node:http";
import { test, expect, e2eEnabled, skipReason } from "./fixtures";
import type { BrowserContext } from "@playwright/test";

/**
 * P1 journey for 006 US1 on the extension: a saved score goes out of date when
 * the profile changes, Rescore clears the notice, and a rescore on a page that
 * has since gone thin keeps the stored score, notes the posting is gone and
 * makes no analyze-job call. Requires a live backend baked into the build and
 * REQUIRE_AUTH=false on the local Functions host, like savedJobs.test.ts.
 */

test.skip(!e2eEnabled, skipReason);

const POSTING_HTML = `<!doctype html>
<html><head><title>Senior Backend Engineer - Acme</title></head>
<body><main>
  <h1>Senior Backend Engineer</h1>
  <p>Acme is hiring a Senior Backend Engineer. Fully remote within the US.</p>
  <p>You will build services in C# and .NET 8 on Azure. Senior level.
  ${"We value ownership, craftsmanship, and collaboration. ".repeat(10)}</p>
</main></body></html>`;

const THIN_HTML = `<!doctype html><html><head><title>Gone</title></head>
<body><main><p>This posting has been removed.</p></main></body></html>`;

function serveFixture(): Promise<{
  server: http.Server;
  url: string;
  setThin: (thin: boolean) => void;
}> {
  let thin = false;
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(thin ? THIN_HTML : POSTING_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/jobs/freshness-e2e`,
        setThin: (next) => {
          thin = next;
        },
      });
    });
  });
}

async function seedStubAuth(context: BrowserContext): Promise<void> {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "sub-freshness-e2e",
      email: "freshness@example.com",
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
      user: { sub: "sub-freshness-e2e", email: "freshness@example.com" },
    }
  );
}

test("profile change marks the score out of date; Rescore clears it; a gone posting keeps the score", async ({
  context,
  extensionId,
}) => {
  await seedStubAuth(context);
  const fixture = await serveFixture();
  const analyzeCalls: string[] = [];
  context.on("request", (request) => {
    if (request.url().includes("analyze-job") && request.method() === "POST") {
      analyzeCalls.push(request.url());
    }
  });

  async function saveProfile(text: string): Promise<void> {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByLabel(/Your background/).fill(text);
    await options.getByRole("button", { name: "Save profile" }).click();
    await expect(options.getByRole("status")).toBeVisible();
    await options.close();
  }

  try {
    // 1. Analyze a posting and save it, scored against the first profile.
    await saveProfile("Senior .NET engineer, Azure, 10 years.");
    const postingPage = await context.newPage();
    await postingPage.goto(fixture.url);
    const sidePanel = await context.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(sidePanel.getByLabel(/fit \d+ out of 100/)).toBeVisible({
      timeout: 60_000,
    });
    await sidePanel.getByRole("button", { name: /^save/i }).click();
    await expect(sidePanel.getByText(/already saved/i)).toBeVisible();

    // 2-3. Change the profile; the visible result is marked out of date, with the cost line.
    await saveProfile("Staff Go engineer, Kubernetes, 12 years.");
    await expect(sidePanel.getByText("Scored against an older profile")).toBeVisible({
      timeout: 15_000,
    });
    await expect(sidePanel.getByText(/free rescores left this month|Uses 1 analysis/)).toBeVisible();

    // 4. Rescore clears the notice.
    await sidePanel.getByRole("button", { name: "Rescore" }).click();
    await expect(sidePanel.getByText("Scored against an older profile")).toHaveCount(0, {
      timeout: 60_000,
    });

    // 5. Change the profile again, take the posting down, and Rescore: the
    //    stored score stays, the note appears, and nothing is sent to analyze-job.
    await saveProfile("Principal data engineer, Spark, 15 years.");
    await expect(sidePanel.getByText("Scored against an older profile")).toBeVisible({
      timeout: 15_000,
    });
    fixture.setThin(true);
    await postingPage.reload();
    const before = analyzeCalls.length;
    await sidePanel.getByRole("button", { name: "Rescore" }).click();
    await expect(
      sidePanel.getByText("Posting no longer available — score can’t be updated")
    ).toBeVisible({ timeout: 30_000 });
    await expect(sidePanel.getByLabel(/fit \d+ out of 100/)).toBeVisible();
    expect(analyzeCalls.length).toBe(before);
  } finally {
    fixture.server.close();
  }
});
