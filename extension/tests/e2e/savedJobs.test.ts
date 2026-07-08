import http from "node:http";
import { test, expect, e2eEnabled, skipReason } from "./fixtures";
import type { BrowserContext } from "@playwright/test";

/**
 * US2 journey — server-backed saved jobs: stub-authed save → appears in the
 * Saved tab; status/notes edits persist across a panel reload; export
 * downloads JSON. Requires a live backend baked into the build (see
 * skipReason) with the storage endpoints deployed; run the local Functions
 * host with REQUIRE_AUTH=false so the stubbed session's token is not
 * verified (real Google OAuth cannot run in CI — plan.md Complexity
 * Tracking).
 */

test.skip(!e2eEnabled, skipReason);

const POSTING_HTML = `<!doctype html>
<html><head><title>Senior Backend Engineer - Acme</title></head>
<body>
<main>
  <h1>Senior Backend Engineer</h1>
  <p>Acme is hiring a Senior Backend Engineer. Fully remote within the US.</p>
  <p>You will build services in C# and .NET 8 on Azure.
  The salary range is $180,000 to $220,000 per year. Senior level.
  ${"We value ownership, craftsmanship, and collaboration. ".repeat(10)}</p>
</main>
</body></html>`;

function serveFixture(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(POSTING_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${address.port}/jobs/save-e2e` });
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
      sub: "sub-e2e",
      email: "e2e@example.com",
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
      user: { sub: "sub-e2e", email: "e2e@example.com" },
    }
  );
}

test("save → Saved tab → edit persists → export downloads JSON", async ({
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

    // Analysis renders, then save the posting to the server-backed library.
    await expect(sidePanel.getByText(/remote/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await sidePanel.getByRole("button", { name: /^save/i }).click();
    await expect(sidePanel.getByText(/already saved/i)).toBeVisible();

    // Saved tab lists it.
    await sidePanel.getByRole("tab", { name: "Saved" }).click();
    const row = sidePanel.getByRole("listitem").first();
    await expect(row).toContainText("Senior Backend Engineer");

    // Edit status and notes.
    await row.getByRole("combobox").selectOption("applied");
    const notes = row.getByRole("textbox");
    await notes.fill("phone screen Friday");
    await notes.blur();

    // Persisted server-side: a full panel reload shows the same state.
    await sidePanel.reload();
    await sidePanel.getByRole("tab", { name: "Saved" }).click();
    const reloadedRow = sidePanel.getByRole("listitem").first();
    await expect(reloadedRow).toContainText("Senior Backend Engineer");
    await expect(reloadedRow.getByRole("combobox")).toHaveValue("applied");
    await expect(reloadedRow.getByRole("textbox")).toHaveValue(
      "phone screen Friday"
    );

    // Export downloads a JSON file in the legacy format.
    const downloadPromise = sidePanel.waitForEvent("download");
    await sidePanel.getByRole("button", { name: "Export" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^saved-jobs-.*\.json$/);
  } finally {
    server.close();
  }
});
