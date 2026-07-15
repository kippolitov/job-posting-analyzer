import { test, expect, e2eEnabled, skipReason } from "./fixtures";
import type { BrowserContext } from "@playwright/test";

/**
 * P1 self-serve signup / sign-in gate journey (US1, 003-freemium-premium-tier):
 * any verified-email Google account signs in and is unlocked immediately —
 * no allowlist/invitation step. Auth is stubbed by seeding
 * chrome.storage.local with a StoredAuth session because CI cannot drive
 * real Google OAuth (plan.md Complexity Tracking). A manual OAuth smoke
 * test is still required before release tagging.
 */

test.skip(!e2eEnabled, skipReason);

function stubAuth(email: string, sub: string) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64url");
  return {
    idToken: `${header}.${payload}.stub-signature`,
    expiresAt: Date.now() + 3600_000,
    signedInAt: Date.now(),
    user: { sub, email },
  };
}

async function seedStoredAuth(
  context: BrowserContext,
  auth: ReturnType<typeof stubAuth> | null
): Promise<void> {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  await worker.evaluate(async (stored) => {
    if (stored) {
      await chrome.storage.local.set({ "auth:session": stored });
    } else {
      await chrome.storage.local.remove(["auth:session", "auth:notAuthorized"]);
    }
  }, auth);
}

test("side panel is gated when signed out: no analyze/saved/profile UI", async ({
  sidePanel,
}) => {
  await expect(
    sidePanel.getByRole("button", { name: /sign in with google/i })
  ).toBeVisible();
  await expect(
    sidePanel.getByText("Analyze the current page as a job posting")
  ).toHaveCount(0);
  await expect(sidePanel.getByRole("tab")).toHaveCount(0);
  await expect(sidePanel.getByRole("button", { name: /^save/i })).toHaveCount(0);
});

test("options page is gated when signed out: profile editor unreachable", async ({
  context,
  extensionId,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(
    options.getByRole("button", { name: /sign in with google/i })
  ).toBeVisible();
  await expect(options.getByLabel(/your background/i)).toHaveCount(0);
});

test("a fresh stubbed identity signs in with no allowlist step and unlocks the panel; sign-out restores the gate", async ({
  context,
  sidePanel,
}) => {
  await seedStoredAuth(context, stubAuth("new-user@example.com", "sub-new-user"));
  await sidePanel.reload();

  // Signed-in header with the account email; feature UI reachable.
  await expect(sidePanel.getByText("new-user@example.com")).toBeVisible();
  await expect(
    sidePanel.getByRole("button", { name: /sign in with google/i })
  ).toHaveCount(0);

  await sidePanel.getByRole("button", { name: /sign out/i }).click();
  await expect(
    sidePanel.getByRole("button", { name: /sign in with google/i })
  ).toBeVisible();
  await expect(sidePanel.getByText("new-user@example.com")).toHaveCount(0);
});

test("switching accounts shows none of the previous account's session (spec edge case)", async ({
  context,
  sidePanel,
}) => {
  await seedStoredAuth(context, stubAuth("user-a@example.com", "sub-a"));
  await sidePanel.reload();
  await expect(sidePanel.getByText("user-a@example.com")).toBeVisible();

  await sidePanel.getByRole("button", { name: /sign out/i }).click();
  await expect(
    sidePanel.getByRole("button", { name: /sign in with google/i })
  ).toBeVisible();

  await seedStoredAuth(context, stubAuth("user-b@example.com", "sub-b"));
  await sidePanel.reload();
  await expect(sidePanel.getByText("user-b@example.com")).toBeVisible();
  await expect(sidePanel.getByText("user-a@example.com")).toHaveCount(0);
});
