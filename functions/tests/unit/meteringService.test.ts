import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { RestError } from "@azure/data-tables";
import {
  checkAndIncrement,
  refundOnSystemFailure,
  peekUsage,
  resetsAt,
  usageRowKey,
  MeteringUnavailableError,
} from "../../src/services/meteringService";
import { MONTHLY_ANALYSES } from "../../src/models/user";
import { ensureTable } from "../../src/services/tablesService";

function uniqueSub(): string {
  return `sub-${randomUUID()}`;
}

async function seed(
  sub: string,
  count: number,
  limit: number
): Promise<void> {
  const client = await ensureTable("Usage");
  await client.createEntity({
    partitionKey: sub,
    rowKey: usageRowKey(),
    count,
    limit,
  });
}

async function readRow(sub: string): Promise<{ count: number; limit: number }> {
  const client = await ensureTable("Usage");
  const row = await client.getEntity<{ count: number; limit: number }>(
    sub,
    usageRowKey()
  );
  return { count: row.count, limit: row.limit };
}

const notFound = () => new RestError("Not Found", { statusCode: 404 });
const preconditionFailed = () =>
  new RestError("Precondition Failed", { statusCode: 412 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resetsAt", () => {
  it("is the first instant of the next UTC month", () => {
    const iso = resetsAt(new Date("2026-07-15T10:00:00Z"));
    expect(iso).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rolls over the year at December", () => {
    expect(resetsAt(new Date("2026-12-20T10:00:00Z"))).toBe(
      "2027-01-01T00:00:00.000Z"
    );
  });
});

describe("checkAndIncrement — first-of-month create", () => {
  it("creates {count:1, limit} when no entity exists for the month", async () => {
    const sub = uniqueSub();
    const result = await checkAndIncrement(sub, "free");
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.limit).toBe(MONTHLY_ANALYSES.free);
    expect(await readRow(sub)).toEqual({ count: 1, limit: 50 });
  });

  it("increments an existing month's counter using a real ETag", async () => {
    const sub = uniqueSub();
    await seed(sub, 5, 50);
    const client = await ensureTable("Usage");
    const updateSpy = vi.spyOn(client, "updateEntity");

    const result = await checkAndIncrement(sub, "free");
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(6);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, mode, options] = updateSpy.mock.calls[0];
    expect(mode).toBe("Replace");
    expect(options).toBeDefined();
    expect((options as { etag?: string }).etag).toBeTruthy();
    expect((options as { etag?: string }).etag).not.toBe("*");
  });
});

describe("checkAndIncrement — 409 create race", () => {
  it("re-reads and continues at step 3 when createEntity 409s", async () => {
    const sub = uniqueSub();
    // The row actually exists (another request won the race) but our first
    // read is forced to observe a 404, so the code attempts createEntity —
    // which really 409s against Azurite — then must re-read and proceed.
    await seed(sub, 3, 50);
    const client = await ensureTable("Usage");
    vi.spyOn(client, "getEntity").mockRejectedValueOnce(notFound());

    const result = await checkAndIncrement(sub, "free");
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(4);
  });
});

describe("checkAndIncrement — limit reached", () => {
  it("returns a limit-reached result with resetsAt and makes no write", async () => {
    const sub = uniqueSub();
    await seed(sub, 50, 50);
    const client = await ensureTable("Usage");
    const updateSpy = vi.spyOn(client, "updateEntity");

    const result = await checkAndIncrement(sub, "free");
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(50);
    expect(result.limit).toBe(50);
    expect(Date.parse(result.resetsAt)).not.toBeNaN();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(await readRow(sub)).toEqual({ count: 50, limit: 50 });
  });

  it("recomputes the limit from the current tier rather than the stored value", async () => {
    const sub = uniqueSub();
    // Stored limit is stale (free, 50) but the caller now passes premium.
    await seed(sub, 50, 50);
    const result = await checkAndIncrement(sub, "premium");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(MONTHLY_ANALYSES.premium);
  });
});

describe("checkAndIncrement — 412 retry loop", () => {
  it("re-reads, re-checks, and retries after a 412, bounded at 4 attempts", async () => {
    const sub = uniqueSub();
    await seed(sub, 10, 50);
    const client = await ensureTable("Usage");
    const updateSpy = vi.spyOn(client, "updateEntity");
    updateSpy
      .mockRejectedValueOnce(preconditionFailed())
      .mockRejectedValueOnce(preconditionFailed());

    const result = await checkAndIncrement(sub, "free");
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(11);
    expect(updateSpy).toHaveBeenCalledTimes(3);
    for (const [, , options] of updateSpy.mock.calls) {
      expect((options as { etag?: string })?.etag).toBeTruthy();
      expect((options as { etag?: string })?.etag).not.toBe("*");
    }
  });

  it("fails closed once the 412 retry budget (4) is exhausted", async () => {
    const sub = uniqueSub();
    await seed(sub, 10, 50);
    const client = await ensureTable("Usage");
    const updateSpy = vi
      .spyOn(client, "updateEntity")
      .mockRejectedValue(preconditionFailed());

    await expect(checkAndIncrement(sub, "free")).rejects.toBeInstanceOf(
      MeteringUnavailableError
    );
    // Initial attempt + 4 retries = 5 update attempts.
    expect(updateSpy).toHaveBeenCalledTimes(5);
    // No unmetered spend: the stored count is unchanged.
    expect((await readRow(sub)).count).toBe(10);
  });
});

describe("checkAndIncrement — storage failure", () => {
  it("fails closed (no unmetered spend) on an unexpected storage error", async () => {
    const sub = uniqueSub();
    const client = await ensureTable("Usage");
    vi.spyOn(client, "getEntity").mockRejectedValue(
      new RestError("Service Unavailable", { statusCode: 503 })
    );

    await expect(checkAndIncrement(sub, "free")).rejects.toBeInstanceOf(
      MeteringUnavailableError
    );
  });
});

describe("refundOnSystemFailure", () => {
  it("conditionally decrements the current month's counter", async () => {
    const sub = uniqueSub();
    await seed(sub, 5, 50);
    await refundOnSystemFailure(sub, "free");
    expect((await readRow(sub)).count).toBe(4);
  });

  it("floors at 0 and never goes negative", async () => {
    const sub = uniqueSub();
    await seed(sub, 0, 50);
    await refundOnSystemFailure(sub, "free");
    expect((await readRow(sub)).count).toBe(0);
  });

  it("is a silent no-op when no usage entity exists for the month", async () => {
    const sub = uniqueSub();
    await expect(refundOnSystemFailure(sub, "free")).resolves.toBeUndefined();
  });

  it("never throws even when every attempt hits a conflict", async () => {
    const sub = uniqueSub();
    await seed(sub, 5, 50);
    const client = await ensureTable("Usage");
    vi.spyOn(client, "updateEntity").mockRejectedValue(preconditionFailed());
    await expect(refundOnSystemFailure(sub, "free")).resolves.toBeUndefined();
  });
});

describe("peekUsage", () => {
  it("returns count 0 with the tier limit when no entity exists yet", async () => {
    const sub = uniqueSub();
    const result = await peekUsage(sub, "free");
    expect(result).toMatchObject({ count: 0, limit: 50 });
  });

  it("reflects the current month's stored count", async () => {
    const sub = uniqueSub();
    await seed(sub, 12, 50);
    const result = await peekUsage(sub, "free");
    expect(result.count).toBe(12);
  });
});
