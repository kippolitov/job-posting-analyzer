import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getOrCreate,
  getByEmail,
  findByPaddleCustomerId,
  setTier,
  setBlocked,
  applySubscriptionState,
  normalizeEmail,
} from "../../src/services/usersStore";
import { ensureTable } from "../../src/services/tablesService";

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe("usersStore.getOrCreate", () => {
  it("creates {sub, tier:'free', createdAt} on miss", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    const row = await getOrCreate(email, sub);
    expect(row.partitionKey).toBe("User");
    expect(row.rowKey).toBe(normalizeEmail(email));
    expect(row.sub).toBe(sub);
    expect(row.tier).toBe("free");
    expect(Date.parse(row.createdAt)).not.toBeNaN();
  });

  it("returns the existing row on hit without overwriting tier", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    const first = await getOrCreate(email, sub);
    await setTier(email, "premium");

    const second = await getOrCreate(email, sub);
    expect(second.tier).toBe("premium");
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("records sub on a migrated row that has never signed in", async () => {
    const email = uniqueEmail();
    const client = await ensureTable("Users");
    await client.createEntity({
      partitionKey: "User",
      rowKey: normalizeEmail(email),
      tier: "free",
      createdAt: new Date().toISOString(),
      migratedFromAllowlist: true,
    });

    const sub = `sub-${randomUUID()}`;
    const row = await getOrCreate(email, sub);
    expect(row.sub).toBe(sub);
    expect(row.migratedFromAllowlist).toBe(true);

    const stored = await getByEmail(email);
    expect(stored?.sub).toBe(sub);
  });

  it("is race-safe: concurrent creates for the same email settle on one row", async () => {
    const email = uniqueEmail();
    const [a, b] = await Promise.all([
      getOrCreate(email, "sub-a"),
      getOrCreate(email, "sub-b"),
    ]);
    expect(a.createdAt).toBe(b.createdAt);
  });
});

describe("usersStore.getByEmail", () => {
  it("returns null when the row is absent", async () => {
    await expect(getByEmail(uniqueEmail())).resolves.toBeNull();
  });

  it("reads the blocked flag", async () => {
    const email = uniqueEmail();
    await getOrCreate(email, `sub-${randomUUID()}`);
    await setBlocked(email, true);
    const row = await getByEmail(email);
    expect(row?.blocked).toBe(true);
  });

  it("normalizes email case before lookup", async () => {
    const email = uniqueEmail();
    await getOrCreate(email, `sub-${randomUUID()}`);
    const row = await getByEmail(email.toUpperCase());
    expect(row).not.toBeNull();
  });
});

describe("usersStore.setTier / setBlocked", () => {
  it("setTier flips tier without touching other fields", async () => {
    const email = uniqueEmail();
    await getOrCreate(email, `sub-${randomUUID()}`);
    await setTier(email, "premium");
    const row = await getByEmail(email);
    expect(row?.tier).toBe("premium");
  });

  it("setBlocked toggles the admin override", async () => {
    const email = uniqueEmail();
    await getOrCreate(email, `sub-${randomUUID()}`);
    await setBlocked(email, true);
    expect((await getByEmail(email))?.blocked).toBe(true);
    await setBlocked(email, false);
    expect((await getByEmail(email))?.blocked).toBe(false);
  });
});

describe("usersStore.applySubscriptionState", () => {
  it("Merge-upserts subscription fields, preserving tier and sub", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    await getOrCreate(email, sub);

    await applySubscriptionState(email, {
      tier: "premium",
      paddleCustomerId: "ctm_1",
      paddleSubscriptionId: "sub_1",
      subscriptionStatus: "active",
      renewsAt: "2026-08-01T00:00:00Z",
      paddleEventOccurredAt: "2026-07-04T12:00:00Z",
    });

    const row = await getByEmail(email);
    expect(row?.tier).toBe("premium");
    expect(row?.sub).toBe(sub);
    expect(row?.paddleCustomerId).toBe("ctm_1");
    expect(row?.subscriptionStatus).toBe("active");
    expect(row?.renewsAt).toBe("2026-08-01T00:00:00Z");
  });

  it("round-trips paddleEventOccurredAt", async () => {
    const email = uniqueEmail();
    await getOrCreate(email, `sub-${randomUUID()}`);
    await applySubscriptionState(email, {
      paddleEventOccurredAt: "2026-07-04T12:00:00Z",
    });
    const row = await getByEmail(email);
    expect(row?.paddleEventOccurredAt).toBe("2026-07-04T12:00:00Z");

    await applySubscriptionState(email, {
      paddleEventOccurredAt: "2026-07-05T00:00:00Z",
    });
    expect((await getByEmail(email))?.paddleEventOccurredAt).toBe(
      "2026-07-05T00:00:00Z"
    );
  });
});

describe("usersStore.findByPaddleCustomerId", () => {
  it("finds the user row carrying the given paddleCustomerId", async () => {
    const email = uniqueEmail();
    await getOrCreate(email, `sub-${randomUUID()}`);
    const customerId = `ctm_${randomUUID()}`;
    await applySubscriptionState(email, { paddleCustomerId: customerId });

    const found = await findByPaddleCustomerId(customerId);
    expect(found?.rowKey).toBe(normalizeEmail(email));
  });

  it("returns null when no row carries the customer id", async () => {
    await expect(
      findByPaddleCustomerId(`ctm_${randomUUID()}`)
    ).resolves.toBeNull();
  });
});
