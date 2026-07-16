import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { isAnalyzeJobRequest, MAIN_TEXT_CAP } from "../models/job";
import type { AuthenticatedUser } from "../models/user";
import { withAuth, type AuthedHandler } from "../services/auth";
import {
  orchestrateJobAnalysis,
  JobSchemaError,
} from "../services/jobExtractionOrchestrator";
import {
  checkAndIncrement,
  refundOnSystemFailure,
  type CheckAndIncrementResult,
} from "../services/meteringService";
import { withRateLimit } from "../services/rateLimiter";

export async function analyzeJobHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  if (request.method === "OPTIONS") {
    return { status: 204, headers: corsHeaders() };
  }

  context.log("analyze-job function triggered");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  }

  if (!isAnalyzeJobRequest(body)) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "Missing or invalid extract: url, title, jsonLd, and mainText are required."
    );
  }

  if (body.extract.mainText.length > MAIN_TEXT_CAP) {
    return errorResponse(
      413,
      "EXTRACT_TOO_LARGE",
      `Page text exceeds the ${MAIN_TEXT_CAP.toLocaleString()}-character limit.`
    );
  }

  try {
    const result = await orchestrateJobAnalysis(body, user.tier, (message) =>
      context.warn(message)
    );
    return { status: 200, headers: corsHeaders(), jsonBody: result };
  } catch (err) {
    if (err instanceof JobSchemaError) {
      context.error("analyze-job schema failure:", err.message);
      return errorResponse(
        502,
        "SCHEMA_PARSE_FAILED",
        "The analysis service returned an unusable result. Please try again."
      );
    }
    context.error("orchestrateJobAnalysis failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Analysis failed. Please try again.");
  }
}

function meteringEnforced(): boolean {
  return process.env.METERING_ENFORCED !== "false";
}

function formatResetDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function usageEcho(usage: CheckAndIncrementResult) {
  return {
    count: usage.count,
    limit: usage.limit,
    resetsAt: usage.resetsAt,
    tier: usage.tier,
  };
}

/**
 * withUsageMetering(handler) — composes as withAuth(withUsageMetering(handler))
 * (contracts/metering.md): increments the caller's monthly counter BEFORE the
 * wrapped handler runs (fail closed — no OpenAI spend on a 429 or a metering
 * outage), echoes usage on 200, and best-effort refunds a system-caused
 * failure. METERING_ENFORCED=false (rollout PR1 shadow mode, plan.md) still
 * counts but never blocks — used to accrue real usage data before the public
 * flag flip.
 */
export function withUsageMetering(handler: AuthedHandler): AuthedHandler {
  return async (
    request: HttpRequest,
    context: InvocationContext,
    user: AuthenticatedUser
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") return handler(request, context, user);

    let usage: CheckAndIncrementResult;
    try {
      usage = await checkAndIncrement(user.sub, user.tier);
    } catch (err) {
      context.error("usage metering check failed:", err);
      return errorResponse(
        503,
        "SERVICE_ERROR",
        "Couldn't verify your usage allowance. Please try again."
      );
    }

    if (!usage.allowed) {
      if (!meteringEnforced()) {
        // Shadow mode: count, never block (rollout PR1).
        return handler(request, context, user);
      }
      const tierLabel = usage.tier === "premium" ? "premium" : "free";
      return {
        status: 429,
        headers: corsHeaders(),
        jsonBody: {
          error: {
            code: "USAGE_LIMIT_REACHED",
            message: `You've used all ${usage.limit} ${tierLabel} analyses this month. Your allowance resets on ${formatResetDate(usage.resetsAt)}.`,
          },
          usage: usageEcho(usage),
        },
      };
    }

    const response = await handler(request, context, user);

    if (response.status !== undefined && response.status >= 500) {
      // System-caused failure after the increment — best-effort refund
      // (FR-007); a lost refund is logged, never surfaced (metering.md).
      refundOnSystemFailure(user.sub, user.tier).catch((err) => {
        context.error("metering.refund_lost:", err);
      });
    } else if (response.status === 200) {
      response.jsonBody = {
        ...(response.jsonBody as Record<string, unknown>),
        usage: usageEcho(usage),
      };
    }

    return response;
  };
}

function errorResponse(status: number, code: string, message: string): HttpResponseInit {
  return {
    status,
    headers: corsHeaders(),
    jsonBody: { error: { code, message } },
  };
}

function corsHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-functions-key, Authorization",
  };
}

app.http("analyze-job", {
  methods: ["POST"],
  authLevel: "function",
  route: "analyze-job",
  handler: withRateLimit("analyze", withAuth(withUsageMetering(analyzeJobHandler))),
});

app.http("analyze-job-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "analyze-job",
  handler: () => ({ status: 204, headers: corsHeaders() }),
});
