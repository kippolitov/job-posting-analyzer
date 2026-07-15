import { RestError } from "@azure/data-tables";
import { MONTHLY_ANALYSES, type Tier, type UsageEntity } from "../models/user";
import { ensureTable } from "./tablesService";

/**
 * Usage metering (contracts/metering.md, data-model.md `Usage`): one entity
 * per user per UTC month, incremented BEFORE the OpenAI call so exhaustion
 * never costs a token (fail closed). Optimistic concurrency via real ETags
 * only — never `If-Match: *`, never an unconditional write — so N parallel
 * requests at the cap yield exactly one winner (SC-002).
 */

const TABLE = "Usage";
/** Bounded retry budget for both the create-race and the 412 update loop. */
const MAX_RETRIES = 4;

export class MeteringUnavailableError extends Error {
  constructor(message = "Couldn't verify your usage allowance. Please try again.") {
    super(message);
    this.name = "MeteringUnavailableError";
  }
}

export interface UsageResult {
  count: number;
  limit: number;
  resetsAt: string;
  tier: Tier;
}

export interface CheckAndIncrementResult extends UsageResult {
  allowed: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `"usage-" + YYYY-MM` for the given (default: current) UTC month. */
export function usageRowKey(date: Date = new Date()): string {
  return `usage-${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

/** First instant of the next UTC month (FR-008) — no reset write ever happens. */
export function resetsAt(date: Date = new Date()): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  ).toISOString();
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 404;
}
function isConflict(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 409;
}
function isPreconditionFailed(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 412;
}

/**
 * Check-and-increment algorithm (contracts/metering.md, normative). `limit`
 * is always recomputed from the current `tier` — mid-month upgrades unblock
 * immediately (FR-019); the stored `limit` column is refreshed but never the
 * enforcement input.
 */
export async function checkAndIncrement(
  sub: string,
  tier: Tier
): Promise<CheckAndIncrementResult> {
  const limit = MONTHLY_ANALYSES[tier];
  const rowKey = usageRowKey();
  const reset = resetsAt();
  const client = await ensureTable(TABLE);

  let createRetries = 0;
  let updateRetries = 0;

  for (;;) {
    let existing: (UsageEntity & { etag?: string }) | null;
    try {
      existing = await client.getEntity<UsageEntity>(sub, rowKey);
    } catch (err) {
      if (!isNotFound(err)) throw new MeteringUnavailableError();
      existing = null;
    }

    if (!existing) {
      try {
        await client.createEntity({ partitionKey: sub, rowKey, count: 1, limit });
        return { allowed: true, count: 1, limit, resetsAt: reset, tier };
      } catch (err) {
        if (isConflict(err) && createRetries < MAX_RETRIES) {
          createRetries++;
          continue;
        }
        throw new MeteringUnavailableError();
      }
    }

    if (existing.count >= limit) {
      return { allowed: false, count: existing.count, limit, resetsAt: reset, tier };
    }

    try {
      await client.updateEntity(
        { partitionKey: sub, rowKey, count: existing.count + 1, limit },
        "Replace",
        { etag: existing.etag }
      );
      return {
        allowed: true,
        count: existing.count + 1,
        limit,
        resetsAt: reset,
        tier,
      };
    } catch (err) {
      if (isPreconditionFailed(err) && updateRetries < MAX_RETRIES) {
        updateRetries++;
        continue;
      }
      throw new MeteringUnavailableError();
    }
  }
}

/**
 * Best-effort conditional decrement on a system-caused analysis failure
 * (FR-007): same ETag discipline, floor at 0, max 2 attempts. Never throws —
 * a lost refund over-counts by one and is accepted (contracts/metering.md).
 */
export async function refundOnSystemFailure(sub: string, tier: Tier): Promise<void> {
  const limit = MONTHLY_ANALYSES[tier];
  const rowKey = usageRowKey();
  const client = await ensureTable(TABLE);

  for (let attempt = 0; attempt < 2; attempt++) {
    let existing: (UsageEntity & { etag?: string }) | null;
    try {
      existing = await client.getEntity<UsageEntity>(sub, rowKey);
    } catch {
      return;
    }
    if (existing.count <= 0) return;
    try {
      await client.updateEntity(
        {
          partitionKey: sub,
          rowKey,
          count: Math.max(0, existing.count - 1),
          limit,
        },
        "Replace",
        { etag: existing.etag }
      );
      return;
    } catch {
      // Retry once on conflict; otherwise give up silently (best-effort).
    }
  }
}

/** Read-only usage view for GET /api/account — never increments. */
export async function peekUsage(sub: string, tier: Tier): Promise<UsageResult> {
  const limit = MONTHLY_ANALYSES[tier];
  const rowKey = usageRowKey();
  const reset = resetsAt();
  const client = await ensureTable(TABLE);
  try {
    const existing = await client.getEntity<UsageEntity>(sub, rowKey);
    return { count: existing.count, limit, resetsAt: reset, tier };
  } catch (err) {
    if (isNotFound(err)) return { count: 0, limit, resetsAt: reset, tier };
    throw new MeteringUnavailableError();
  }
}
