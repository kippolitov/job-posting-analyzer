import type { JobAnalysis, JobErrorCode, JobPanelError, PageExtract } from "../types/job";

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  if (status === 401 || status === 403) {
    return makeJobError(
      "not-configured",
      "The analysis service rejected the request.",
      "Please reinstall the extension.",
      false
    );
  }
  if (status === 502 || status === 500 || status === 503 || status === 504 || status === 429) {
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
  retryable: boolean
): JobPanelError {
  return { code, message, action, retryable };
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
