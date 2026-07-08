import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  isAllowed,
  recordSignIn,
} from "../../src/services/allowedUsersStore";
import { ensureTable } from "../../src/services/tablesService";

const PARTITION = "AllowedUser";

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

async function insertAllowedUser(
  email: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const client = await ensureTable("AllowedUsers");
  await client.createEntity({
    partitionKey: PARTITION,
    rowKey: email.toLowerCase(),
    addedAt: new Date().toISOString(),
    ...extra,
  });
}

async function readAllowedUser(
  email: string
): Promise<Record<string, unknown>> {
  const client = await ensureTable("AllowedUsers");
  return client.getEntity(PARTITION, email.toLowerCase());
}

describe("allowedUsersStore.isAllowed", () => {
  it("returns true for an allowlisted email", async () => {
    const email = uniqueEmail();
    await insertAllowedUser(email);
    await expect(isAllowed(email)).resolves.toBe(true);
  });

  it("normalizes case and surrounding whitespace before the lookup", async () => {
    const email = uniqueEmail();
    await insertAllowedUser(email);
    await expect(isAllowed(`  ${email.toUpperCase()}  `)).resolves.toBe(true);
  });

  it("returns false when the row is absent (404)", async () => {
    await expect(isAllowed(uniqueEmail())).resolves.toBe(false);
  });

  it(
    "rethrows non-404 storage errors instead of treating them as denied",
    async () => {
      // Illegal RowKey characters make Table Storage reject the request with
      // a 400 — that must surface, not silently read as "not allowed". The
      // SDK retries the 4xx a few times, so allow extra time under coverage.
      await expect(isAllowed("bad/key#chars?@example.com")).rejects.toThrow();
    },
    30_000
  );
});

describe("allowedUsersStore.recordSignIn", () => {
  it("populates sub on first sign-in via Merge, preserving other columns", async () => {
    const email = uniqueEmail();
    await insertAllowedUser(email, { note: "invited by dev" });
    await recordSignIn(email, "sub-first");
    const row = await readAllowedUser(email);
    expect(row.sub).toBe("sub-first");
    expect(row.note).toBe("invited by dev");
  });

  it("does not overwrite an already-recorded sub", async () => {
    const email = uniqueEmail();
    await insertAllowedUser(email, { sub: "sub-original" });
    await recordSignIn(email, "sub-imposter");
    const row = await readAllowedUser(email);
    expect(row.sub).toBe("sub-original");
  });

  it("no-ops when the allowlist row is absent", async () => {
    const email = uniqueEmail();
    await expect(recordSignIn(email, "sub-x")).resolves.toBeUndefined();
    await expect(isAllowed(email)).resolves.toBe(false);
  });

  it("normalizes the email key like isAllowed does", async () => {
    const email = uniqueEmail();
    await insertAllowedUser(email);
    await recordSignIn(email.toUpperCase(), "sub-normalized");
    const row = await readAllowedUser(email);
    expect(row.sub).toBe("sub-normalized");
  });
});
