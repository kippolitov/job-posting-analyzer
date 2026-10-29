import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  chargeAnalysis,
  checkAndIncrement,
  grantUnavailableRefund,
  peekUsage,
  refundCharge,
  refundOnSystemFailure,
  usageRowKey,
} from "../../src/services/meteringService";
import {
  FREE_RESCORES_PER_MONTH,
  MONTHLY_ANALYSES,
  UNAVAILABLE_REFUNDS_PER_MONTH,
} from "../../src/models/user";
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

interface UsageRow {
  count: number;
  rescoresUsed?: number;
  unavailableRefunds?: number;
}

async function readRow(sub: string): Promise<UsageRow> {
  const client = await ensureTable("Usage");
  return client.getEntity<UsageRow>(sub, usageRowKey());
}

describe("metering — free rescores (006 research R6)", () => {
  it("an ordinary analysis after a free rescore keeps rescoresUsed (trap 1: Replace hazard)", async () => {
    const sub = uniqueSub();
    await seed(sub, 3, MONTHLY_ANALYSES.free);

    const rescore = await chargeAnalysis(sub, "free", "rescore");
    expect(rescore).toMatchObject({ allowed: true, charged: "rescore" });

    await checkAndIncrement(sub, "free");
    let row = await readRow(sub);
    expect(row.rescoresUsed).toBe(1);
    expect(row.count).toBe(4);

    // The 5xx refund path writes too; it must not drop the column either.
    await refundOnSystemFailure(sub, "free");
    row = await readRow(sub);
    expect(row.rescoresUsed).toBe(1);
    expect(row.count).toBe(3);
  });

  it("a rescore leaves count alone and an analysis leaves rescoresUsed alone", async () => {
    const sub = uniqueSub();
    await chargeAnalysis(sub, "free", "rescore");
    await chargeAnalysis(sub, "free", "analysis");
    const row = await readRow(sub);
    expect(row).toMatchObject({ count: 1, rescoresUsed: 1 });
  });

  it("a rescore succeeds even when the analysis allowance is used up", async () => {
    const sub = uniqueSub();
    await seed(sub, MONTHLY_ANALYSES.free, MONTHLY_ANALYSES.free);
    const result = await chargeAnalysis(sub, "free", "rescore");
    expect(result).toMatchObject({ allowed: true, charged: "rescore" });
    expect(result.usage).toMatchObject({
      count: MONTHLY_ANALYSES.free,
      rescoresUsed: 1,
      rescoresLimit: FREE_RESCORES_PER_MONTH,
    });
  });

  it("falls back to an analysis once the free rescores are used up", async () => {
    const sub = uniqueSub();
    const client = await ensureTable("Usage");
    await client.createEntity({
      partitionKey: sub,
      rowKey: usageRowKey(),
      count: 2,
      limit: MONTHLY_ANALYSES.free,
      rescoresUsed: FREE_RESCORES_PER_MONTH,
    });
    const result = await chargeAnalysis(sub, "free", "rescore");
    expect(result).toMatchObject({ allowed: true, charged: "analysis" });
    expect(await readRow(sub)).toMatchObject({ count: 3, rescoresUsed: FREE_RESCORES_PER_MONTH });
  });

  it("refuses when both the rescores and the allowance are used up", async () => {
    const sub = uniqueSub();
    const client = await ensureTable("Usage");
    await client.createEntity({
      partitionKey: sub,
      rowKey: usageRowKey(),
      count: MONTHLY_ANALYSES.free,
      limit: MONTHLY_ANALYSES.free,
      rescoresUsed: FREE_RESCORES_PER_MONTH,
    });
    const result = await chargeAnalysis(sub, "free", "rescore");
    expect(result).toMatchObject({ allowed: false, charged: "analysis" });
    expect(result.usage.rescoresUsed).toBe(FREE_RESCORES_PER_MONTH);
  });

  it(
    "parallel rescores at rescoresUsed 9 yield exactly one free rescore; the rest are analyses",
    async () => {
      const sub = uniqueSub();
      const client = await ensureTable("Usage");
      await client.createEntity({
        partitionKey: sub,
        rowKey: usageRowKey(),
        count: 0,
        limit: MONTHLY_ANALYSES.free,
        rescoresUsed: FREE_RESCORES_PER_MONTH - 1,
      });

      const results = await Promise.all(
        Array.from({ length: 8 }, () => chargeAnalysis(sub, "free", "rescore"))
      );
      expect(results.filter((r) => r.charged === "rescore")).toHaveLength(1);
      expect(results.filter((r) => r.charged === "analysis")).toHaveLength(7);
      expect(await readRow(sub)).toMatchObject({
        count: 7,
        rescoresUsed: FREE_RESCORES_PER_MONTH,
      });
    },
    30_000
  );

  it("refundCharge decrements the counter that was charged", async () => {
    const sub = uniqueSub();
    await chargeAnalysis(sub, "premium", "rescore");
    await chargeAnalysis(sub, "premium", "analysis");
    await refundCharge(sub, "premium", "rescore");
    expect(await readRow(sub)).toMatchObject({ count: 1, rescoresUsed: 0 });
    await refundCharge(sub, "premium", "analysis");
    expect(await readRow(sub)).toMatchObject({ count: 0, rescoresUsed: 0 });
  });

  it("grantUnavailableRefund refunds the charge and counts it, at most 10 a month", async () => {
    const sub = uniqueSub();
    await chargeAnalysis(sub, "free", "rescore");
    expect(await grantUnavailableRefund(sub, "free", "rescore")).toBe(true);
    expect(await readRow(sub)).toMatchObject({ rescoresUsed: 0, unavailableRefunds: 1 });

    const client = await ensureTable("Usage");
    const row = await client.getEntity(sub, usageRowKey());
    await client.updateEntity(
      { partitionKey: sub, rowKey: usageRowKey(), unavailableRefunds: UNAVAILABLE_REFUNDS_PER_MONTH },
      "Merge",
      { etag: row.etag }
    );
    await chargeAnalysis(sub, "free", "analysis");
    expect(await grantUnavailableRefund(sub, "free", "analysis")).toBe(false);
    expect(await readRow(sub)).toMatchObject({
      count: 1,
      unavailableRefunds: UNAVAILABLE_REFUNDS_PER_MONTH,
    });
  });

  it("reads a pre-006 row without the new columns as zero", async () => {
    const sub = uniqueSub();
    await seed(sub, 7, MONTHLY_ANALYSES.free);
    expect(await peekUsage(sub, "free")).toMatchObject({
      count: 7,
      rescoresUsed: 0,
      rescoresLimit: FREE_RESCORES_PER_MONTH,
    });
    const result = await chargeAnalysis(sub, "free", "rescore");
    expect(result.usage).toMatchObject({ count: 7, rescoresUsed: 1 });
  });

  it("charges Premium the same way (FR-026)", async () => {
    const sub = uniqueSub();
    const result = await chargeAnalysis(sub, "premium", "rescore");
    expect(result).toMatchObject({ allowed: true, charged: "rescore" });
    expect(result.usage).toMatchObject({ rescoresLimit: FREE_RESCORES_PER_MONTH, tier: "premium" });
  });
});
