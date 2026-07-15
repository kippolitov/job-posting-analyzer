import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

/**
 * In-process fixed-window per-IP rate limiter (research.md R8). Deliberately
 * not a persisted guarantee: state is a plain `Map`, per Functions instance
 * — Functions can scale out, so this is friction against a single hot
 * source, not a hard control. The real backstops are per-user monthly caps
 * (meteringService) and the deployment TPM quota. Applied to analyze and
 * billing routes (contracts/metering.md).
 */

const WINDOW_MS = 60_000;
const DEFAULT_ANALYZE_PER_MIN = 30;
const DEFAULT_BILLING_PER_MIN = 10;

interface WindowState {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, WindowState>();

/** Drops all tracked windows so tests can start from a clean slate. */
export function resetRateLimiterForTests(): void {
  buckets.clear();
}

/**
 * Fixed-window check-and-increment for an arbitrary key (contracts/metering.md
 * defaults: research R8). Returns true when the request is allowed.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number = WINDOW_MS,
  now: number = Date.now()
): boolean {
  const state = buckets.get(key);
  if (!state || now - state.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (state.count >= limit) return false;
  state.count++;
  return true;
}

/** First address in `x-forwarded-for` (the client, per Azure Functions' proxy chain). */
export function extractClientIp(request: HttpRequest): string {
  const header = request.headers.get("x-forwarded-for");
  if (!header) return "unknown";
  return header.split(",")[0].trim();
}

export type RouteKey = "analyze" | "billing";

function routeLimit(routeKey: RouteKey): number {
  const envVar =
    routeKey === "analyze" ? "RATE_LIMIT_ANALYZE_PER_MIN" : "RATE_LIMIT_BILLING_PER_MIN";
  const parsed = Number(process.env[envVar]);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return routeKey === "analyze" ? DEFAULT_ANALYZE_PER_MIN : DEFAULT_BILLING_PER_MIN;
}

export type PlainHandler = (
  request: HttpRequest,
  context: InvocationContext
) => Promise<HttpResponseInit>;

/**
 * Wraps a whole route (before withAuth) so unauthenticated bursts are also
 * throttled. 429 `RATE_LIMITED` — distinct from metering's
 * `USAGE_LIMIT_REACHED`, both are 429s but clients branch on `error.code`
 * (contracts/metering.md).
 */
export function withRateLimit(routeKey: RouteKey, handler: PlainHandler): PlainHandler {
  return async (request, context) => {
    if (request.method === "OPTIONS") return handler(request, context);

    const limit = routeLimit(routeKey);
    const ip = extractClientIp(request);
    if (!checkRateLimit(`${routeKey}:${ip}`, limit)) {
      return {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, x-functions-key, Authorization",
        },
        jsonBody: {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please wait a moment and try again.",
          },
        },
      };
    }
    return handler(request, context);
  };
}
