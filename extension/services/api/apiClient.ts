import {
  getIdToken,
  markNotAuthorized,
  signInSilently,
  signOut,
} from "../auth/authService";

declare const WXT_API_BASE_URL: string;
declare const WXT_AZURE_FUNCTION_KEY: string;

const TIMEOUT_MS = 30_000;

export type ApiErrorCode =
  | "NOT_CONFIGURED"
  | "NETWORK_ERROR"
  | "UNAUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "SERVICE_ERROR";

/**
 * Typed failure from the storage API. `retryable` drives the UI's
 * error-banner-with-Retry contract (FR-015 / Constitution III).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryable: boolean;

  constructor(status: number, code: ApiErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ApiRequestInit {
  method?: string;
  body?: unknown;
}

/**
 * Authenticated fetch against the storage API: base URL + function key +
 * Bearer ID token. Auth statuses are handled here once — 401 gets one silent
 * renewal then ends the session (sign-in gate); 403 flags the invitation
 * state; 5xx and network failures throw retryable errors. Domain statuses
 * (400/404/409) are returned to the caller.
 */
export async function apiFetch(
  path: string,
  init: ApiRequestInit = {}
): Promise<Response> {
  if (!WXT_API_BASE_URL) {
    throw new ApiError(
      0,
      "NOT_CONFIGURED",
      "The storage service is not configured. Please reinstall the extension.",
      false
    );
  }
  const url = new URL(`${WXT_API_BASE_URL.replace(/\/+$/, "")}${path}`);
  if (WXT_AZURE_FUNCTION_KEY) {
    url.searchParams.set("code", WXT_AZURE_FUNCTION_KEY);
  }

  let response = await attempt(url, init, await getIdToken());

  if (response.status === 401) {
    // One silent renewal, then the sign-in gate (auth contract).
    const renewed = await signInSilently();
    if (renewed) {
      response = await attempt(url, init, renewed.idToken);
    }
  }

  if (response.status === 401) {
    await signOut();
    throw new ApiError(
      401,
      "UNAUTHENTICATED",
      "Your session ended. Sign in to continue.",
      false
    );
  }

  if (response.status === 403) {
    await markNotAuthorized();
    throw new ApiError(
      403,
      "NOT_AUTHORIZED",
      "Access is by invitation. Use “Request access” on the sign-in screen.",
      false
    );
  }

  if (response.status >= 500) {
    throw new ApiError(
      response.status,
      "SERVICE_ERROR",
      "The storage service encountered an error. Try again.",
      true
    );
  }

  return response;
}

async function attempt(
  url: URL,
  init: ApiRequestInit,
  idToken: string | null
): Promise<Response> {
  // Timeout via Promise.race, not AbortSignal: an extension-page
  // AbortController is realm-bound, and repository tests run real fetch
  // (msw/undici) in jsdom where the two realms' AbortSignal brands differ.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new ApiError(
            0,
            "NETWORK_ERROR",
            "The storage service timed out. Try again.",
            true
          )
        ),
      TIMEOUT_MS
    );
  });
  try {
    const request = fetch(url.toString(), {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }).catch(() => {
      throw new ApiError(
        0,
        "NETWORK_ERROR",
        "Could not reach the storage service. Check your connection and try again.",
        true
      );
    });
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}
