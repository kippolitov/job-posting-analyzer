import { RestError } from "@azure/data-tables";
import {
  FREE_RESCORES_PER_MONTH,
  MONTHLY_ANALYSES,
  UNAVAILABLE_REFUNDS_PER_MONTH,
  type Tier,
  type UsageEntity,
} from "../models/user";
import type { ChargeKind } from "./rescoreEligibility";
import { ensureTable } from "./tablesService";

/**
 * Usage metering (contracts/metering.md, data-model.md `Usage`): one entity
 * per user per UTC month, incremented BEFORE the OpenAI call so exhaustion
 * never costs a token (fail closed). Optimistic concurrency via real ETags
 * only — never `If-Match: *`, never an unconditional write — so N parallel
 * requests at the cap yield exactly one winner (SC-002).
 *
 * Every update is an ETag-conditional `Merge` (006 research R6): `Replace`
 * would drop the columns a write doesn't name, so an ordinary analysis would
 * erase `rescoresUsed`.
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

/** UsageResult plus the free-rescore counters (006 contracts/analyze-api.md §3). */
export interface RescoreUsage extends UsageResult {
  rescoresUsed: number;
  rescoresLimit: number;
}

export interface ChargeResult {
  allowed: boolean;
  /** The counter actually charged; a rescore falls back to "analysis" past its cap. */
  charged: ChargeKind;
  usage: RescoreUsage;
}

type StoredUsage = UsageEntity & { etag?: string };

/** The Usage column a charge of this kind increments. */
const COUNTER: Record<ChargeKind, "count" | "rescoresUsed"> = {
  analysis: "count",
  rescore: "rescoresUsed",
};

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

function usageView(row: StoredUsage | null, tier: Tier): RescoreUsage {
  return {
    count: row?.count ?? 0,
    limit: MONTHLY_ANALYSES[tier],
    resetsAt: resetsAt(),
    tier,
    rescoresUsed: row?.rescoresUsed ?? 0,
    rescoresLimit: FREE_RESCORES_PER_MONTH,
  };
}

async function readUsageRow(sub: string): Promise<StoredUsage | null> {
  const client = await ensureTable(TABLE);
  try {
    return await client.getEntity<UsageEntity>(sub, usageRowKey());
  } catch (err) {
    if (isNotFound(err)) return null;
    throw new MeteringUnavailableError();
  }
}

/**
 * Charges one request against the counter `decision` names (006 research R6),
 * before the model call, failing closed. A rescore past
 * FREE_RESCORES_PER_MONTH falls back to the analysis counter; the analysis
 * counter refuses at the tier's limit, which is always recomputed from the
 * current tier so mid-month upgrades unblock immediately (FR-019).
 */
export async function chargeAnalysis(
  sub: string,
  tier: Tier,
  decision: ChargeKind
): Promise<ChargeResult> {
  const limit = MONTHLY_ANALYSES[tier];
  const rowKey = usageRowKey();
  const client = await ensureTable(TABLE);

  let createRetries = 0;
  let updateRetries = 0;

  for (;;) {
    const existing = await readUsageRow(sub);
    const view = usageView(existing, tier);
    const charged: ChargeKind =
      decision === "rescore" && view.rescoresUsed < FREE_RESCORES_PER_MONTH
        ? "rescore"
        : "analysis";
    if (charged === "analysis" && view.count >= limit) {
      return { allowed: false, charged, usage: view };
    }

    const column = COUNTER[charged];
    const next = { ...view, [column]: view[column] + 1 };

    if (!existing) {
      try {
        await client.createEntity({
          partitionKey: sub,
          rowKey,
          count: next.count,
          limit,
          rescoresUsed: next.rescoresUsed,
        });
        return { allowed: true, charged, usage: next };
      } catch (err) {
        if (isConflict(err) && createRetries < MAX_RETRIES) {
          createRetries++;
          continue;
        }
        throw new MeteringUnavailableError();
      }
    }

    try {
      await client.updateEntity(
        { partitionKey: sub, rowKey, [column]: next[column], limit },
        "Merge",
        { etag: existing.etag }
      );
      return { allowed: true, charged, usage: next };
    } catch (err) {
      if (isPreconditionFailed(err) && updateRetries < MAX_RETRIES) {
        updateRetries++;
        continue;
      }
      throw new MeteringUnavailableError();
    }
  }
}

/** Charges an ordinary analysis (contracts/metering.md, normative). */
export async function checkAndIncrement(
  sub: string,
  tier: Tier
): Promise<CheckAndIncrementResult> {
  const { allowed, usage } = await chargeAnalysis(sub, tier, "analysis");
  return {
    allowed,
    count: usage.count,
    limit: usage.limit,
    resetsAt: usage.resetsAt,
    tier: usage.tier,
  };
}

/**
 * Best-effort conditional decrement of the counter that was charged, on a
 * system-caused analysis failure (FR-007, 006 FR-004a): same ETag
 * discipline, floor at 0, max 2 attempts. Never throws — a lost refund
 * over-counts by one and is accepted (contracts/metering.md).
 */
export async function refundCharge(sub: string, tier: Tier, charged: ChargeKind): Promise<void> {
  const column = COUNTER[charged];
  const client = await ensureTable(TABLE);

  for (let attempt = 0; attempt < 2; attempt++) {
    let existing: StoredUsage | null;
    try {
      existing = await readUsageRow(sub);
    } catch {
      return;
    }
    const current = existing?.[column] ?? 0;
    if (!existing || current <= 0) return;
    try {
      await client.updateEntity(
        {
          partitionKey: sub,
          rowKey: usageRowKey(),
          [column]: current - 1,
          limit: MONTHLY_ANALYSES[tier],
        },
        "Merge",
        { etag: existing.etag }
      );
      return;
    } catch {
      // Retry once on conflict; otherwise give up silently (best-effort).
    }
  }
}

/** Refund of an ordinary analysis; the pre-006 name for refundCharge(…, "analysis"). */
export function refundOnSystemFailure(sub: string, tier: Tier): Promise<void> {
  return refundCharge(sub, tier, "analysis");
}

/**
 * FR-003a: a rescore that finds no posting consumes nothing — the charged
 * counter is decremented — but at most UNAVAILABLE_REFUNDS_PER_MONTH times,
 * so it can't become an unbounded free-call path (research R6). Returns
 * whether the refund was granted; past the cap, or on a storage failure,
 * the charge stands.
 */
export async function grantUnavailableRefund(
  sub: string,
  tier: Tier,
  charged: ChargeKind
): Promise<boolean> {
  const column = COUNTER[charged];
  const client = await ensureTable(TABLE);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let existing: StoredUsage | null;
    try {
      existing = await readUsageRow(sub);
    } catch {
      return false;
    }
    const refunds = existing?.unavailableRefunds ?? 0;
    if (!existing || refunds >= UNAVAILABLE_REFUNDS_PER_MONTH) return false;
    try {
      await client.updateEntity(
        {
          partitionKey: sub,
          rowKey: usageRowKey(),
          [column]: Math.max(0, (existing[column] ?? 0) - 1),
          unavailableRefunds: refunds + 1,
          limit: MONTHLY_ANALYSES[tier],
        },
        "Merge",
        { etag: existing.etag }
      );
      return true;
    } catch (err) {
      if (!isPreconditionFailed(err)) return false;
    }
  }
  return false;
}

/** Read-only usage view for GET /api/account — never increments. */
export async function peekUsage(sub: string, tier: Tier): Promise<RescoreUsage> {
  return usageView(await readUsageRow(sub), tier);
}
