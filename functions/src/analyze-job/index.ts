import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { isAnalyzeJobRequest, MAIN_TEXT_CAP } from "../models/job";
import type { AuthenticatedUser } from "../models/user";
import { withAuth } from "../services/auth";
import {
  corsHeaders,
  errorResponse as httpErrorResponse,
  requestOrigin,
} from "../services/http";
import {
  orchestrateJobAnalysis,
  JobSchemaError,
} from "../services/jobExtractionOrchestrator";
import {
  chargeForAnalysis,
  refundAfterFailure,
  settleCharge,
} from "../services/analysisMetering";
import { fingerprintForRequest } from "../services/profileFingerprint";
import { sha256Hex } from "../services/savedJobsRepository";
import { withRateLimit } from "../services/rateLimiter";

/**
 * POST /api/analyze-job (contracts/analyze-api.md §2): validate (400/413, no
 * charge) → charge the counter research R6 picks (429 when exhausted) →
 * model → posting-unavailable refund → 200. Any 5xx after the charge
 * refunds the charged counter. Charging after validation is 006's side fix:
 * an invalid request used to cost an analysis (§4).
 */
export async function analyzeJobHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") {
    return { status: 204, headers: corsHeaders(origin) };
  }

  context.log("analyze-job function triggered");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return httpErrorResponse(
      400,
      "INVALID_REQUEST",
      "Request body must be valid JSON.",
      origin
    );
  }

  if (!isAnalyzeJobRequest(body)) {
    return httpErrorResponse(
      400,
      "INVALID_REQUEST",
      "Missing or invalid extract: url, title, jsonLd, and mainText are required, and profileData and rescore must be well formed.",
      origin
    );
  }

  if (body.extract.mainText.length > MAIN_TEXT_CAP) {
    return httpErrorResponse(
      413,
      "EXTRACT_TOO_LARGE",
      `Page text exceeds the ${MAIN_TEXT_CAP.toLocaleString()}-character limit.`,
      origin
    );
  }

  const outcome = await chargeForAnalysis(
    {
      user,
      saveKey: sha256Hex(body.extract.canonicalUrl || body.extract.url),
      intent: body.rescore,
      currentFingerprint: fingerprintForRequest(body),
      allowShadowMode: true,
    },
    context,
    origin
  );
  if (!outcome.ok) return outcome.response;
  const { charge } = outcome;

  try {
    const result = await orchestrateJobAnalysis(
      body,
      user.tier,
      (message) => context.warn(message),
      (usage) => context.log("model.usage", JSON.stringify(usage))
    );
    const settled = await settleCharge(
      { user, intent: body.rescore },
      charge,
      result,
      Boolean(body.assumeJobPosting)
    );
    return {
      status: 200,
      headers: corsHeaders(origin),
      jsonBody: { ...result, ...settled },
    };
  } catch (err) {
    refundAfterFailure(user, charge, context);
    if (err instanceof JobSchemaError) {
      context.error("analyze-job schema failure:", err.message);
      return httpErrorResponse(
        502,
        "SCHEMA_PARSE_FAILED",
        "The analysis service returned an unusable result. Please try again.",
        origin
      );
    }
    // Includes ModelConfigError: a misconfigured app setting is a 500, refunded
    // like any other system failure (contracts/model-config.md).
    context.error("orchestrateJobAnalysis failed:", err);
    return httpErrorResponse(
      500,
      "SERVICE_ERROR",
      "Analysis failed. Please try again.",
      origin
    );
  }
}

app.http("analyze-job", {
  methods: ["POST"],
  authLevel: "function",
  route: "analyze-job",
  handler: withRateLimit("analyze", withAuth(analyzeJobHandler)),
});

app.http("analyze-job-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "analyze-job",
  handler: (request: HttpRequest) => ({
    status: 204,
    headers: corsHeaders(requestOrigin(request)),
  }),
});
