import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { corsHeaders, requestOrigin } from "../../src/services/http";
import type { HttpRequest } from "@azure/functions";

const PAGES_ORIGIN = "https://example.github.io";

function makeRequest(origin: string | null): HttpRequest {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === "origin" ? origin : null),
    },
  } as unknown as HttpRequest;
}

describe("corsHeaders — ALLOWED_ORIGINS allowlist (contracts/web-auth.md)", () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = PAGES_ORIGIN;
  });

  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it("echoes an allowed Origin and adds Vary: Origin", () => {
    const headers = corsHeaders(PAGES_ORIGIN);
    expect(headers["Access-Control-Allow-Origin"]).toBe(PAGES_ORIGIN);
    expect(headers["Vary"]).toBe("Origin");
  });

  it("preserves the wildcard for an absent Origin (extension / server-to-server)", () => {
    const headers = corsHeaders(null);
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Vary"]).toBeUndefined();
  });

  it("preserves the wildcard for an unmatched Origin", () => {
    const headers = corsHeaders("https://evil.example.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Vary"]).toBeUndefined();
  });

  it("preserves the wildcard when no origin argument is passed at all", () => {
    const headers = corsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("supports multiple comma-separated allowed origins", () => {
    process.env.ALLOWED_ORIGINS = `${PAGES_ORIGIN}, https://localhost:5173`;
    expect(corsHeaders("https://localhost:5173")["Access-Control-Allow-Origin"]).toBe(
      "https://localhost:5173"
    );
    expect(corsHeaders(PAGES_ORIGIN)["Access-Control-Allow-Origin"]).toBe(PAGES_ORIGIN);
  });

  it("requestOrigin reads the request's Origin header", () => {
    expect(requestOrigin(makeRequest(PAGES_ORIGIN))).toBe(PAGES_ORIGIN);
    expect(requestOrigin(makeRequest(null))).toBeNull();
  });
});
