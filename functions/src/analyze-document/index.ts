import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { MAIN_TEXT_CAP, type AnalyzeJobRequest } from "../models/job";
import type { AuthenticatedUser } from "../models/user";
import { withAuth } from "../services/auth";
import {
  DocumentRejectedError,
  extractDocument,
  type DocumentRejectionCode,
} from "../services/documentExtraction";
import { corsHeaders, errorResponse, requestOrigin } from "../services/http";
import {
  orchestrateJobAnalysis,
  JobSchemaError,
} from "../services/jobExtractionOrchestrator";
import {
  checkAndIncrement,
  MeteringUnavailableError,
  refundOnSystemFailure,
  type CheckAndIncrementResult,
} from "../services/meteringService";
import { sha256Hex } from "../services/savedJobsRepository";
import { withRateLimit } from "../services/rateLimiter";

const REJECTION_STATUS: Record<DocumentRejectionCode, number> = {
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  FILE_PASSWORD_PROTECTED: 422,
  FILE_UNREADABLE: 422,
  FILE_NO_TEXT: 422,
};

function formatResetDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function usageEcho(usage: CheckAndIncrementResult) {
  return { count: usage.count, limit: usage.limit, resetsAt: usage.resetsAt, tier: usage.tier };
}

/**
 * POST /api/analyze-document (contracts/analyze-document.md): multipart →
 * size/sniff/extract (research R7 — reject-before-increment, no
 * withUsageMetering wrapper here) → checkAndIncrement → synthetic
 * AnalyzeJobRequest → orchestrateJobAnalysis → response with saveKey.
 */
export async function analyzeDocumentHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") {
    return { status: 204, headers: corsHeaders(origin) };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Request must be multipart/form-data.", origin);
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return errorResponse(400, "INVALID_REQUEST", "Missing required file part.", origin);
  }
  const filename = "name" in file && typeof file.name === "string" ? file.name : "document";
  const profileField = formData.get("profile");
  const profile = typeof profileField === "string" ? profileField : undefined;
  const assumeJobPosting = formData.get("assumeJobPosting") === "true";

  const bytes = Buffer.from(await file.arrayBuffer());

  let extracted: Awaited<ReturnType<typeof extractDocument>>;
  try {
    extracted = await extractDocument(bytes);
  } catch (err) {
    if (err instanceof DocumentRejectedError) {
      return errorResponse(REJECTION_STATUS[err.code], err.code, err.message, origin);
    }
    context.error("document extraction failed unexpectedly:", err);
    return errorResponse(
      422,
      "FILE_UNREADABLE",
      "This document could not be read. It may be corrupt.",
      origin
    );
  }

  // Only now — after every validation rejection has already returned —
  // does the request touch the caller's monthly allowance (research R7).
  let usage: CheckAndIncrementResult;
  try {
    usage = await checkAndIncrement(user.sub, user.tier);
  } catch (err) {
    if (err instanceof MeteringUnavailableError) {
      return errorResponse(503, "SERVICE_ERROR", err.message, origin);
    }
    context.error("usage metering check failed:", err);
    return errorResponse(
      503,
      "SERVICE_ERROR",
      "Couldn't verify your usage allowance. Please try again.",
      origin
    );
  }

  if (!usage.allowed) {
    const tierLabel = usage.tier === "premium" ? "premium" : "free";
    return {
      status: 429,
      headers: corsHeaders(origin),
      jsonBody: {
        error: {
          code: "USAGE_LIMIT_REACHED",
          message: `You've used all ${usage.limit} ${tierLabel} analyses this month. Your allowance resets on ${formatResetDate(usage.resetsAt)}.`,
        },
        usage: usageEcho(usage),
      },
    };
  }

  const syntheticRequest: AnalyzeJobRequest = {
    extract: {
      url: "",
      canonicalUrl: "",
      title: filename,
      jsonLd: [],
      mainText: extracted.text.slice(0, MAIN_TEXT_CAP),
      extractedAt: new Date().toISOString(),
    },
    profile,
    assumeJobPosting,
  };

  try {
    const analysis = await orchestrateJobAnalysis(syntheticRequest, user.tier, (message) =>
      context.warn(message)
    );
    const canonicalUrl = `doc:${sha256Hex(extracted.text)}`;
    const saveKey = sha256Hex(canonicalUrl);
    return {
      status: 200,
      headers: corsHeaders(origin),
      jsonBody: {
        analysis,
        source: "document",
        filename,
        // The client cannot derive `doc:<hash>` itself (it never sees the
        // extracted text) — canonicalUrl must round-trip so PUT
        // /api/jobs/{saveKey} can pass saveJob's sha256Hex(canonicalUrl)
        // === key check (data-model.md §2).
        canonicalUrl,
        saveKey,
        usage: usageEcho(usage),
      },
    };
  } catch (err) {
    refundOnSystemFailure(user.sub, user.tier).catch((refundErr) => {
      context.error("metering.refund_lost:", refundErr);
    });
    if (err instanceof JobSchemaError) {
      context.error("analyze-document schema failure:", err.message);
      return errorResponse(
        502,
        "SCHEMA_PARSE_FAILED",
        "The analysis service returned an unusable result. Please try again.",
        origin
      );
    }
    context.error("orchestrateJobAnalysis failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Analysis failed. Please try again.", origin);
  }
}

app.http("analyze-document", {
  methods: ["POST"],
  // withAuth (Google ID token) is the real gate; anonymous so the public
  // web SPA (whose bundle can never safely hold a function key) can call
  // this route too (contracts/web-auth.md).
  authLevel: "anonymous",
  route: "analyze-document",
  handler: withRateLimit("analyze", withAuth(analyzeDocumentHandler)),
});

app.http("analyze-document-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "analyze-document",
  handler: (request: HttpRequest) => ({
    status: 204,
    headers: corsHeaders(requestOrigin(request)),
  }),
});
