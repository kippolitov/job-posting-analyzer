import { test, expect, e2eEnabled, skipReason } from "./fixtures";
import type { BrowserContext, Worker } from "@playwright/test";

/**
 * US3 journey — one-time migration of pre-002 local data. Auth is stubbed by
 * seeding chrome.storage.local (see signIn.test.ts). The accept path needs
 * the storage API: run the local Functions host with REQUIRE_AUTH=false
 * (quickstart.md) so the stub token is accepted. The decline path is fully
 * client-side.
 */

test.skip(!e2eEnabled, skipReason);

const LEGACY_JOB = {
  schemaVersion: 1,
  canonicalUrl: "https://legacy.example/jobs/1",
  sourceUrl: "https://legacy.example/jobs/1",
  analysis: {
    isJobPosting: true,
    title: "Legacy Saved Role",
    company: "Legacy Co",
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
    fit: null,
    model: "gpt-4o-mini",
    analyzedAt: "2026-06-01T00:00:00Z",
  },
  status: "interested",
  notes: "from before sign-in existed",
  savedAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

async function getWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
}

async function seedLegacyAndAuth(context: BrowserContext): Promise<void> {
  const worker = await getWorker(context);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: "sub-migration-e2e",
      email: "migrate@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url");
  // sha256 of the canonical URL, computed in the worker (same digest the
  // legacy jobStorage used for its job:<hash> keys).
  await worker.evaluate(
    async ({ job, auth }) => {
      const bytes = new TextEncoder().encode(job.canonicalUrl);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      await chrome.storage.local.set({
        [`job:${hash}`]: job,
        "job:index": {},
        "auth:session": auth,
      });
    },
    {
      job: LEGACY_JOB,
      auth: {
        idToken: `${header}.${payload}.stub-signature`,
        expiresAt: Date.now() + 3600_000,
        signedInAt: Date.now(),
        user: { sub: "sub-migration-e2e", email: "migrate@example.com" },
      },
    }
  );
}

test("decline: offer appears once, never re-offers across panel reloads", async ({
  context,
  sidePanel,
}) => {
  await seedLegacyAndAuth(context);
  await sidePanel.reload();

  const dialog = sidePanel.getByRole("dialog", { name: /migrate/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /don't migrate/i }).click();

  // Features unlock and the offer is gone.
  await expect(dialog).toHaveCount(0);

  // Marker written; local data untouched.
  const worker = await getWorker(context);
  const state = await worker.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return {
      marker: all["migration:v2"] as { status: string } | undefined,
      legacyKeys: Object.keys(all).filter(
        (k) => k.startsWith("job:") && k !== "job:index"
      ).length,
    };
  });
  expect(state.marker?.status).toBe("declined");
  expect(state.legacyKeys).toBe(1);

  // Never re-offered on this device, including after reloads.
  await sidePanel.reload();
  await expect(sidePanel.getByRole("dialog", { name: /migrate/i })).toHaveCount(0);
});

test("accept: legacy data lands server-side and shows in the Saved tab", async ({
  context,
  sidePanel,
}) => {
  await seedLegacyAndAuth(context);
  await sidePanel.reload();

  const dialog = sidePanel.getByRole("dialog", { name: /migrate/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /migrate to my account/i }).click();

  // Completion summary, then continue into the app.
  await expect(sidePanel.getByText(/moved to your account/i)).toBeVisible({
    timeout: 30_000,
  });
  await sidePanel.getByRole("button", { name: /continue/i }).click();

  // The migrated posting is in the (server-backed) library.
  await sidePanel.getByRole("tab", { name: "Saved" }).click();
  await expect(sidePanel.getByText("Legacy Saved Role")).toBeVisible();

  // Legacy keys deleted, marker completed.
  const worker = await getWorker(context);
  const state = await worker.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return {
      marker: all["migration:v2"] as { status: string } | undefined,
      legacyKeys: Object.keys(all).filter((k) => k.startsWith("job:")).length,
    };
  });
  expect(state.marker?.status).toBe("completed");
  expect(state.legacyKeys).toBe(0);
});
