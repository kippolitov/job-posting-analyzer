import type { HttpResponseInit, InvocationContext } from "@azure/functions";
import type { Fit, JobAnalysisResponse } from "../models/job";
import type { AuthenticatedUser } from "../models/user";
import { corsHeaders, errorResponse } from "./http";
import {
  chargeAnalysis,
  grantUnavailableRefund,
  peekUsage,
  refundCharge,
  type ChargeResult,
  type RescoreUsage,
} from "./meteringService";
import { getFingerprintHistory } from "./profileRepository";
import { decideRescoreCharge } from "./rescoreEligibility";
import { getJob } from "./savedJobsRepository";

/**
 * The metering half of both analyze endpoints (contracts/analyze-api.md §2):
 * after validation and before the model call, decide which counter to charge
 * (research R6) and charge it; afterwards, apply the "posting unavailable"
 * refund or the 5xx refund to that same counter.
 */

export type Charged = ChargeResult["charged"] | "none";

export interface ChargeRequest {
  user: AuthenticatedUser;
  /** sha256(canonicalUrl) — the SavedJobs row a rescore would update. */
  saveKey: string;
  intent: { priorFingerprint: string | null } | undefined;
  currentFingerprint: string | undefined;
  /** analyze-job's METERING_ENFORCED=false shadow mode: count, never block. */
  allowShadowMode?: boolean;
}

/** `charge: null` means shadow mode let an over-limit request through uncharged. */
export type ChargeOutcome =
  | { ok: true; charge: ChargeResult | null }
  | { ok: false; response: HttpResponseInit };

function formatResetDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function usageEcho(usage: RescoreUsage, charged: Charged) {
  return {
    count: usage.count,
    limit: usage.limit,
    resetsAt: usage.resetsAt,
    tier: usage.tier,
    charged,
    rescoresUsed: usage.rescoresUsed,
    rescoresLimit: usage.rescoresLimit,
  };
}

function meteringEnforced(): boolean {
  return process.env.METERING_ENFORCED !== "false";
}

export async function chargeForAnalysis(
  req: ChargeRequest,
  context: InvocationContext,
  origin: string | null
): Promise<ChargeOutcome> {
  const { user } = req;
  let charge: ChargeResult;
  try {
    const decision =
      req.intent && req.currentFingerprint ? await decideFor(req) : "analysis";
    charge = await chargeAnalysis(user.sub, user.tier, decision);
  } catch (err) {
    context.error("usage metering check failed:", err);
    return {
      ok: false,
      response: errorResponse(
        503,
        "SERVICE_ERROR",
        "Couldn't verify your usage allowance. Please try again.",
        origin
      ),
    };
  }

  if (charge.allowed) return { ok: true, charge };
  if (req.allowShadowMode && !meteringEnforced())
    return { ok: true, charge: null };

  const tierLabel = user.tier === "premium" ? "premium" : "free";
  return {
    ok: false,
    response: {
      status: 429,
      headers: corsHeaders(origin),
      jsonBody: {
        error: {
          code: "USAGE_LIMIT_REACHED",
          message: `You've used all ${charge.usage.limit} ${tierLabel} analyses this month. Your allowance resets on ${formatResetDate(charge.usage.resetsAt)}.`,
        },
        usage: usageEcho(charge.usage, charge.charged),
      },
    },
  };
}

/** Lookups happen only for rescore intents, and history only without a saved fit. */
async function decideFor(
  req: ChargeRequest
): Promise<ReturnType<typeof decideRescoreCharge>> {
  const { user } = req;
  // The rescore-cap read may be stale; chargeAnalysis re-checks it under the ETag.
  const [saved, usage] = await Promise.all([
    getJob(user.sub, req.saveKey),
    peekUsage(user.sub, user.tier),
  ]);
  const savedFit = saved
    ? ((saved.analysis.fit as Fit | null | undefined) ?? null)
    : undefined;
  const fingerprintHistory =
    savedFit === undefined ? await getFingerprintHistory(user.sub) : [];
  return decideRescoreCharge({
    intent: req.intent,
    currentFingerprint: req.currentFingerprint,
    savedFit,
    fingerprintHistory,
    rescoresUsed: usage.rescoresUsed,
  });
}

/** Best-effort refund of whatever was charged, after a 5xx. */
export function refundAfterFailure(
  user: AuthenticatedUser,
  charge: ChargeResult | null,
  context: InvocationContext
): void {
  if (!charge) return;
  refundCharge(user.sub, user.tier, charge.charged).catch((err) => {
    context.error("metering.refund_lost:", err);
  });
}

/**
 * FR-003a: a rescore whose model call finds no posting (and the user didn't
 * force "treat as a posting") gets `postingUnavailable` and, within the
 * monthly cap, its charge back. Returns the response additions.
 */
export async function settleCharge(
  req: Pick<ChargeRequest, "user" | "intent">,
  charge: ChargeResult | null,
  analysis: JobAnalysisResponse,
  assumeJobPosting: boolean
): Promise<{
  usage?: ReturnType<typeof usageEcho>;
  postingUnavailable?: true;
}> {
  if (!charge) return {};
  const unavailable =
    Boolean(req.intent) && !assumeJobPosting && !analysis.isJobPosting;
  if (!unavailable) return { usage: usageEcho(charge.usage, charge.charged) };

  const granted = await grantUnavailableRefund(
    req.user.sub,
    req.user.tier,
    charge.charged
  );
  if (!granted) {
    return {
      usage: usageEcho(charge.usage, charge.charged),
      postingUnavailable: true,
    };
  }
  const column = charge.charged === "rescore" ? "rescoresUsed" : "count";
  const refunded = {
    ...charge.usage,
    [column]: Math.max(0, charge.usage[column] - 1),
  };
  return { usage: usageEcho(refunded, "none"), postingUnavailable: true };
}
