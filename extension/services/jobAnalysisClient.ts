import type {
  JobAnalysis,
  JobErrorCode,
  JobPanelError,
  PageExtract,
  UsageInfo,
} from "../types/job";
import {
  getIdToken,
  markNotAuthorized,
  signInSilently,
  signOut,
} from "./auth/authService";

declare const WXT_AZURE_FUNCTION_URL: string;
declare const WXT_AZURE_FUNCTION_KEY: string;

const TIMEOUT_MS = 30_000;

export interface JobAnalysisRequest {
  extract: PageExtract;
  profile?: string;
  assumeJobPosting?: boolean;
}

export async function postJobAnalysis(
  request: JobAnalysisRequest
): Promise<JobAnalysis> {
  if (!WXT_AZURE_FUNCTION_URL) {
    throw makeJobError(
      "not-configured",
      "The analysis service is not configured.",
      "Please reinstall the extension.",
      false
    );
  }

  const endpoint = new URL(WXT_AZURE_FUNCTION_URL);
  if (WXT_AZURE_FUNCTION_KEY) {
    endpoint.searchParams.set("code", WXT_AZURE_FUNCTION_KEY);
  }

  let response = await attemptFetch(endpoint, request, await getIdToken());

  if (response.status === 401) {
    // One silent renewal, then the sign-in gate (auth contract).
    const renewed = await signInSilently();
    if (renewed) {
      response = await attemptFetch(endpoint, request, renewed.idToken);
    }
  }

  if (response.status === 401) {
    await signOut();
    throw makeJobError(
      "no-access",
      "Your session ended.",
      "Sign in to continue.",
      false
    );
  }

  if (response.status === 403) {
    await markNotAuthorized();
    throw makeJobError(
      "no-access",
      "Your account can't sign in right now.",
      "See the sign-in screen for details.",
      false
    );
  }

  if (response.status === 429) {
    throw await mapTooManyRequests(response);
  }

  if (response.ok) {
    const payload = (await response.json()) as unknown;
    if (!isJobAnalysis(payload)) {
      throw makeJobError(
        "service-error",
        "The analysis service returned an unexpected result.",
        "Try again.",
        true
      );
    }
    return payload;
  }

  throw mapHttpError(response.status);
}

/**
 * 429 covers two distinct causes (contracts/metering.md): the monthly usage
 * allowance (USAGE_LIMIT_REACHED, carries `usage` for the exhausted-state
 * card, FR-009) and the per-IP rate limiter (RATE_LIMITED, generic retry
 * friction). Callers must branch on error.code, never on status alone.
 */
async function mapTooManyRequests(response: Response): Promise<JobPanelError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const errorCode = (body as { error?: { code?: string } } | null)?.error?.code;
  const usage = (body as { usage?: UsageInfo } | null)?.usage;

  if (errorCode === "USAGE_LIMIT_REACHED" && usage) {
    const tierLabel = usage.tier === "premium" ? "premium" : "free";
    return makeJobError(
      "usage-limit-reached",
      `You've used all ${usage.limit} ${tierLabel} analyses this month.`,
      "Upgrade for more analyses, or wait for your allowance to reset.",
      false,
      usage
    );
  }

  return makeJobError(
    "service-error",
    "The analysis service encountered an error.",
    "Try again.",
    true
  );
}

async function attemptFetch(
  endpoint: URL,
  request: JobAnalysisRequest,
  idToken: string | null
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        extract: request.extract,
        ...(request.profile ? { profile: request.profile } : {}),
        ...(request.assumeJobPosting ? { assumeJobPosting: true } : {}),
      }),
      signal: controller.signal,
    });
  } catch {
    throw makeJobError(
      "network-error",
      "Could not reach the analysis service.",
      "Check your internet connection and try again.",
      true
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function mapHttpError(status: number): JobPanelError {
  if (status === 413) {
    return makeJobError(
      "extract-too-large",
      "This page is too large to analyze.",
      "Try a page for a single job posting.",
      false
    );
  }
  if (status === 400) {
    return makeJobError(
      "unknown",
      "The page could not be analyzed.",
      "Try re-analyzing from the posting page itself.",
      false
    );
  }
  if (status === 502 || status === 500 || status === 503 || status === 504) {
    return makeJobError(
      "service-error",
      "The analysis service encountered an error.",
      "Try again.",
      true
    );
  }
  return makeJobError("unknown", "An unexpected error occurred.", "Try again.", true);
}

function makeJobError(
  code: JobErrorCode,
  message: string,
  action: string,
  retryable: boolean,
  usage?: UsageInfo
): JobPanelError {
  return { code, message, action, retryable, ...(usage ? { usage } : {}) };
}

function isJobAnalysis(value: unknown): value is JobAnalysis {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.isJobPosting === "boolean" &&
    typeof v.arrangement === "string" &&
    typeof v.arrangementConfidence === "string" &&
    Array.isArray(v.techStack) &&
    typeof v.analyzedAt === "string"
  );
}
