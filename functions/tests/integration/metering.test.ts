import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  checkAndIncrement,
  usageRowKey,
} from "../../src/services/meteringService";
import { MONTHLY_ANALYSES } from "../../src/models/user";
import { ensureTable } from "../../src/services/tablesService";

function uniqueSub(): string {
  return `sub-${randomUUID()}`;
}

async function seed(sub: string, count: number, limit: number): Promise<void> {
  const client = await ensureTable("Usage");
  await client.createEntity({
    partitionKey: sub,
    rowKey: usageRowKey(),
    count,
    limit,
  });
}

describe("metering race (SC-002)", () => {
  it(
    "20 parallel check-and-increments at limit-1 yield exactly 1 success, final count == limit",
    async () => {
      const sub = uniqueSub();
      const limit = MONTHLY_ANALYSES.free;
      await seed(sub, limit - 1, limit);

      const results = await Promise.all(
        Array.from({ length: 20 }, () => checkAndIncrement(sub, "free"))
      );

      const successes = results.filter((r) => r.allowed);
      const limitReached = results.filter((r) => !r.allowed);
      expect(successes).toHaveLength(1);
      expect(limitReached).toHaveLength(19);

      const client = await ensureTable("Usage");
      const row = await client.getEntity<{ count: number }>(sub, usageRowKey());
      expect(row.count).toBe(limit);
    },
    30_000
  );
});

describe("metering — month rollover", () => {
  it("a new calendar month creates a fresh RowKey rather than resetting", async () => {
    const sub = uniqueSub();
    const client = await ensureTable("Usage");
    // Simulate "last month" already exhausted under a different RowKey.
    await client.createEntity({
      partitionKey: sub,
      rowKey: "usage-2020-01",
      count: 50,
      limit: 50,
    });

    // This month's real key is untouched — a fresh check succeeds.
    const result = await checkAndIncrement(sub, "free");
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);

    const oldRow = await client.getEntity<{ count: number }>(sub, "usage-2020-01");
    expect(oldRow.count).toBe(50);
  });
});

describe("metering — mid-month tier flip", () => {
  it("upgrading mid-month unblocks immediately with count preserved (FR-019)", async () => {
    const sub = uniqueSub();
    await seed(sub, 50, 50);

    const stillBlocked = await checkAndIncrement(sub, "free");
    expect(stillBlocked.allowed).toBe(false);

    const upgraded = await checkAndIncrement(sub, "premium");
    expect(upgraded.allowed).toBe(true);
    expect(upgraded.count).toBe(51);
    expect(upgraded.limit).toBe(MONTHLY_ANALYSES.premium);
  });
});
