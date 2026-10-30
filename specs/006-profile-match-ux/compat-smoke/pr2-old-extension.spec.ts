// PR2/PR3 compatibility smoke (T088, T098): the published v0.0.36 extension against the
// PR2 backend on :7072 (REQUIRE_AUTH=false). Kept for reference, not part of any
// suite: copy into a v0.0.36 checkout's extension/tests/e2e/ to run it (see
// handoff-pr2.md, "T088 state").
import http from "node:http";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, e2eEnabled, skipReason } from "./fixtures";

const API = "http://localhost:7072/api";

async function seedStoredAuth(context: BrowserContext): Promise<void> {
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sub = "sub-compat-smoke";
  const email = "compat-smoke@example.com";
  await worker.evaluate(
    async (auth) => {
      await chrome.storage.local.set({ "auth:session": auth });
    },
    {
      idToken: `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600 })}.stub`,
      expiresAt: Date.now() + 3600_000,
      signedInAt: Date.now(),
      user: { sub, email },
    }
  );
}

const ONSITE_HTML = `<!doctype html><html><head><title>Plant Software Engineer - Initech</title></head>
<body><main><h1>Plant Software Engineer</h1>
<p>Initech is hiring a Senior Software Engineer for our Dallas plant.</p>
<p>This role is fully on-site at our Dallas office, five days a week.</p>
<p>You will build C# and .NET 8 services on Azure, with Kubernetes and PostgreSQL.
${"We value ownership, craftsmanship, and collaboration. ".repeat(10)}</p>
</main></body></html>`;

function serve(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(ONSITE_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${port}/jobs/compat-smoke` });
    });
  });
}

function trackErrors(page: Page, errors: string[]): void {
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
}

test.skip(!e2eEnabled, skipReason);

test("old extension: profile save keeps PR2 fields; PR2-shaped saved fit renders", async ({
  context,
  extensionId,
}) => {
  const errors: string[] = [];
  await seedStoredAuth(context);

  // 1. A new client stores fields v0.0.36 doesn't know about.
  const seeded = await fetch(`${API}/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Senior .NET engineer, ten years of C#, Azure and Kubernetes.",
      dealbreakers: ["No fully on-site roles"],
      preferences: { arrangements: ["remote", "hybrid"] },
      confirmedSkills: ["PostgreSQL"],
    }),
  });
  expect(seeded.status).toBe(200);

  // 2. The old options page loads it, edits the text and saves {text, dealbreakers}.
  const options = await context.newPage();
  trackErrors(options, errors);
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const textArea = options.locator("#profile-text");
  await expect(textArea).toHaveValue(/Senior \.NET engineer/, { timeout: 30_000 });
  await expect(options.locator("#profile-dealbreakers")).toHaveValue("No fully on-site roles");
  await textArea.fill("Senior .NET engineer, ten years of C#, Azure and Kubernetes. Led a platform team.");
  await options.getByRole("button", { name: "Save profile" }).click();
  await expect
    .poll(async () => ((await (await fetch(`${API}/profile`)).json()) as { text: string }).text, {
      timeout: 15_000,
    })
    .toContain("Led a platform team.");
  const afterSave = (await (await fetch(`${API}/profile`)).json()) as Record<string, unknown>;
  console.log("profile after old-extension save:", JSON.stringify(afterSave));
  expect(afterSave.dealbreakers).toEqual(["No fully on-site roles"]);
  expect(afterSave.preferences).toEqual({ arrangements: ["remote", "hybrid"] });
  expect(afterSave.confirmedSkills).toEqual(["PostgreSQL"]);

  // 3. The old panel analyzes and saves an on-site posting (live model call).
  const { server, url } = await serve();
  try {
    const posting = await context.newPage();
    await posting.goto(url);
    const panel = await context.newPage();
    trackErrors(panel, errors);
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.getByText(/on-?site/i).first()).toBeVisible({ timeout: 60_000 });
    // The old panel has no banner, so the rationale must name the violation.
    await expect(
      panel.getByText(/Violates your dealbreaker: No fully on-site roles\./).first()
    ).toBeVisible({ timeout: 60_000 });
    await panel.getByRole("button", { name: /^save/i }).click();
    await panel.getByRole("tab", { name: "Saved" }).click();
    await expect(panel.getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });

    // The stored fit is PR2-shaped.
    const jobs = (await (await fetch(`${API}/jobs`)).json()) as {
      jobs?: { analysis: { fit?: Record<string, unknown> } }[];
    };
    const list = jobs.jobs ?? (jobs as unknown as { analysis: { fit?: Record<string, unknown> } }[]);
    const fit = list.map((j) => j.analysis.fit).find(Boolean)!;
    console.log("stored fit keys:", Object.keys(fit), "violated:", fit.dealbreakersViolated, "score:", fit.score);
    expect(fit.profileFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(fit.dealbreakersViolated)).toBe(true);
    // PR3: the lists stay plain label arrays for old clients; quotes live in fit.evidence.
    for (const list of ["matching", "missing", "desired"] as const) {
      expect((fit[list] as unknown[]).every((item) => typeof item === "string")).toBe(true);
    }
    expect(fit.evidence).toBeTruthy();
    console.log("stored evidence lists:", Object.keys(fit.evidence as object));

    // 4. A fresh panel renders the saved PR2 fit from the backend.
    await panel.reload();
    await panel.getByRole("tab", { name: "Saved" }).click();
    const row = panel.getByRole("listitem").first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(/Plant Software Engineer|Initech/);
    await row.getByRole("link").first().click().catch(() => {});
    await panel.waitForTimeout(2_000);
  } finally {
    server.close();
  }

  console.log("errors:", JSON.stringify(errors));
  expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
});
