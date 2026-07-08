import type { HttpResponseInit } from "@azure/functions";

/** Shared response helpers for the storage endpoints (contracts/storage-api.md). */

export function corsHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, PATCH, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-functions-key, Authorization",
  };
}

export function jsonResponse(status: number, jsonBody: unknown): HttpResponseInit {
  return { status, headers: corsHeaders(), jsonBody };
}

export function noContent(): HttpResponseInit {
  return { status: 204, headers: corsHeaders() };
}

export function errorResponse(
  status: number,
  code: string,
  message: string
): HttpResponseInit {
  return jsonResponse(status, { error: { code, message } });
}

export function preflightResponse(): HttpResponseInit {
  return noContent();
}
