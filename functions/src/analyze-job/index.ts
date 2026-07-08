import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { isAnalyzeJobRequest, MAIN_TEXT_CAP } from "../models/job";
import type { AuthenticatedUser } from "../models/user";
import { withAuth } from "../services/auth";
import {
  orchestrateJobAnalysis,
  JobSchemaError,
} from "../services/jobExtractionOrchestrator";

export async function analyzeJobHandler(
  request: HttpRequest,
  context: InvocationContext,
  _user: AuthenticatedUser
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
    const result = await orchestrateJobAnalysis(body, (message) =>
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
  handler: withAuth(analyzeJobHandler),
});

app.http("analyze-job-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "analyze-job",
  handler: () => ({ status: 204, headers: corsHeaders() }),
});
