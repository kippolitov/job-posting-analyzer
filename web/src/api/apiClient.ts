import { clearSession, getSession, setAuthError, setSession } from "@/auth/authStore";
import { promptSilent } from "@/auth/googleIdentity";

const TIMEOUT_MS = 30_000;

export type ApiErrorCode =
  | "NOT_CONFIGURED"
  | "NETWORK_ERROR"
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "UNPROCESSABLE"
  | "USAGE_LIMIT_REACHED"
  | "RATE_LIMITED"
  | "SERVICE_ERROR";

/** Typed API failure — drives the plain-language error/exhaustion UI states (constitution III). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  /** Present on 429 USAGE_LIMIT_REACHED (contracts/consumed-endpoints.md). */
  readonly usage?: { count: number; limit: number; resetsAt: string; tier: string };

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    retryable: boolean,
    usage?: { count: number; limit: number; resetsAt: string; tier: string }
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.usage = usage;
  }
}

export interface ApiRequestInit {
  method?: string;
  body?: unknown;
  /** Raw body (e.g. FormData for multipart uploads) — bypasses JSON encoding. */
  rawBody?: BodyInit;
}

function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
}

async function errorBodyMessage(response: Response): Promise<{
  message: string;
  usage?: { count: number; limit: number; resetsAt: string; tier: string };
}> {
  try {
    const body = (await response.clone().json()) as {
      error?: { message?: string };
      usage?: { count: number; limit: number; resetsAt: string; tier: string };
    };
    return { message: body.error?.message ?? response.statusText, usage: body.usage };
  } catch {
    return { message: response.statusText };
  }
}

/**
 * Authenticated fetch against the storage/analysis API: base URL + Bearer ID
 * token. 401 gets one silent re-auth + retry (contracts/web-auth.md); other
 * statuses map to typed ApiErrors so pages render plain-language states
 * without duplicating this logic (constitution III).
 */
export async function apiFetch(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const base = apiBaseUrl();
  if (!base) {
    throw new ApiError(0, "NOT_CONFIGURED", "The service is not configured.", false);
  }
  const url = `${base.replace(/\/+$/, "")}${path}`;
  const previousToken = getSession()?.idToken ?? null;

  let response = await attempt(url, init, previousToken);

  if (response.status === 401) {
    const renewed = await attemptSilentReauth(previousToken);
    if (renewed) {
      response = await attempt(url, init, renewed);
    }
  }

  if (response.status === 400) {
    const { message } = await errorBodyMessage(response);
    throw new ApiError(400, "INVALID_REQUEST", message, false);
  }

  if (response.status === 401) {
    const message = "Your session ended. Sign in again.";
    setAuthError(message);
    clearSession();
    throw new ApiError(401, "UNAUTHENTICATED", message, false);
  }

  if (response.status === 403) {
    const { message } = await errorBodyMessage(response);
    // Unverified email / blocked account (contracts/web-auth.md) — show the
    // server's plain-language message, then return to signed-out state.
    setAuthError(message);
    clearSession();
    throw new ApiError(403, "NOT_AUTHORIZED", message, false);
  }

  if (response.status === 404) {
    const { message } = await errorBodyMessage(response);
    throw new ApiError(404, "NOT_FOUND", message, false);
  }

  if (response.status === 409) {
    const { message } = await errorBodyMessage(response);
    throw new ApiError(409, "CONFLICT", message, false);
  }

  if (response.status === 413) {
    const { message } = await errorBodyMessage(response);
    throw new ApiError(413, "TOO_LARGE", message, false);
  }

  if (response.status === 415) {
    const { message } = await errorBodyMessage(response);
    throw new ApiError(415, "UNSUPPORTED_TYPE", message, false);
  }

  if (response.status === 422) {
    const { message } = await errorBodyMessage(response);
    throw new ApiError(422, "UNPROCESSABLE", message, false);
  }

  if (response.status === 429) {
    const { message, usage } = await errorBodyMessage(response);
    throw new ApiError(429, "USAGE_LIMIT_REACHED", message, false, usage);
  }

  if (response.status >= 500) {
    const { message } = await errorBodyMessage(response);
    throw new ApiError(response.status, "SERVICE_ERROR", message || "The service failed. Try again.", true);
  }

  return response;
}

/**
 * One silent GIS re-issue attempt, waiting briefly for a *new* token to
 * appear. Compares against the token that just 401'd — until the caller
 * clears the stale session, getSession() still returns it, so a same-token
 * match doesn't count as a renewal.
 */
async function attemptSilentReauth(previousToken: string | null): Promise<string | null> {
  promptSilent();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const session = getSession();
    if (session && session.idToken !== previousToken) return session.idToken;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function attempt(
  url: string,
  init: ApiRequestInit,
  idToken: string | null
): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new ApiError(0, "NETWORK_ERROR", "The service timed out. Try again.", true)),
      TIMEOUT_MS
    );
  });
  const headers: Record<string, string> = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const requestInit: RequestInit = { method: init.method ?? "GET", headers };
  if (init.rawBody !== undefined) {
    requestInit.body = init.rawBody;
  } else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(init.body);
  }
  try {
    const request = fetch(url, requestInit).catch(() => {
      throw new ApiError(0, "NETWORK_ERROR", "Could not reach the service. Check your connection.", true);
    });
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Re-exported so callers can seed a session in tests without importing authStore directly.
export { setSession };
