import type { HttpRequest, HttpResponseInit } from "@azure/functions";

/** Shared response helpers for the storage endpoints (contracts/storage-api.md, contracts/web-auth.md). */

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** The request's `Origin` header, or null (extension / server-to-server callers send none). */
export function requestOrigin(request: HttpRequest): string | null {
  return request.headers.get("origin");
}

/**
 * CORS headers for a response. A request `Origin` that matches the
 * ALLOWED_ORIGINS allowlist is echoed back (+ `Vary: Origin`) — least-
 * privilege hardening for the web app's Pages origin (contracts/web-auth.md,
 * research.md R3). No Origin, or an unmatched one, preserves the existing
 * permissive `*` behavior so the extension keeps working unaffected.
 */
export function corsHeaders(origin?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, PATCH, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-functions-key, Authorization",
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

export function jsonResponse(
  status: number,
  jsonBody: unknown,
  origin?: string | null
): HttpResponseInit {
  return { status, headers: corsHeaders(origin), jsonBody };
}

export function noContent(origin?: string | null): HttpResponseInit {
  return { status: 204, headers: corsHeaders(origin) };
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  origin?: string | null
): HttpResponseInit {
  return jsonResponse(status, { error: { code, message } }, origin);
}

export function preflightResponse(origin?: string | null): HttpResponseInit {
  return noContent(origin);
}
