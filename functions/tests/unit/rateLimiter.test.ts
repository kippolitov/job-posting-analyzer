import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  checkRateLimit,
  extractClientIp,
  withRateLimit,
  resetRateLimiterForTests,
} from "../../src/services/rateLimiter";

function makeRequest(
  forwardedFor: string | null,
  method = "POST"
): HttpRequest {
  return {
    method,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-forwarded-for" ? forwardedFor : null,
    },
  } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return { log: () => {}, error: () => {}, warn: () => {} } as unknown as InvocationContext;
}

describe("extractClientIp", () => {
  it("reads the first address from a comma-separated x-forwarded-for", () => {
    expect(extractClientIp(makeRequest("203.0.113.5, 10.0.0.1"))).toBe("203.0.113.5");
  });

  it("trims whitespace", () => {
    expect(extractClientIp(makeRequest("  203.0.113.5  , 10.0.0.1"))).toBe("203.0.113.5");
  });

  it("falls back to a constant key when the header is absent", () => {
    expect(extractClientIp(makeRequest(null))).toBe("unknown");
  });
});

describe("checkRateLimit — fixed window per key", () => {
  it("allows up to the limit within a window, then rejects", () => {
    const now = 0;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("ip-a", 5, 60_000, now)).toBe(true);
    }
    expect(checkRateLimit("ip-a", 5, 60_000, now)).toBe(false);
  });

  it("resets the counter once the window elapses", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("ip-b", 5, 60_000, 0)).toBe(true);
    }
    expect(checkRateLimit("ip-b", 5, 60_000, 0)).toBe(false);
    // A new window starts.
    expect(checkRateLimit("ip-b", 5, 60_000, 60_000)).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("ip-c", 3, 60_000, 0);
    expect(checkRateLimit("ip-c", 3, 60_000, 0)).toBe(false);
    expect(checkRateLimit("ip-d", 3, 60_000, 0)).toBe(true);
  });
});

describe("withRateLimit", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ANALYZE_PER_MIN;
    delete process.env.RATE_LIMIT_BILLING_PER_MIN;
  });

  const okHandler = vi.fn(
    (): Promise<HttpResponseInit> =>
      Promise.resolve({ status: 200, jsonBody: { ok: true } })
  );

  it("passes requests through under the default analyze limit (30/min)", async () => {
    okHandler.mockClear();
    const wrapped = withRateLimit("analyze", okHandler);
    for (let i = 0; i < 30; i++) {
      const res = await wrapped(makeRequest("203.0.113.9"), makeContext());
      expect(res.status).toBe(200);
    }
    expect(okHandler).toHaveBeenCalledTimes(30);
  });

  it("returns 429 RATE_LIMITED (distinct from USAGE_LIMIT_REACHED) once the analyze limit is exceeded", async () => {
    okHandler.mockClear();
    const wrapped = withRateLimit("analyze", okHandler);
    for (let i = 0; i < 30; i++) {
      await wrapped(makeRequest("203.0.113.10"), makeContext());
    }
    const res = await wrapped(makeRequest("203.0.113.10"), makeContext());
    expect(res.status).toBe(429);
    expect(res.jsonBody).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(okHandler).toHaveBeenCalledTimes(30);
  });

  it("honors RATE_LIMIT_ANALYZE_PER_MIN and RATE_LIMIT_BILLING_PER_MIN independently", async () => {
    process.env.RATE_LIMIT_ANALYZE_PER_MIN = "2";
    process.env.RATE_LIMIT_BILLING_PER_MIN = "1";
    okHandler.mockClear();

    const analyzeWrapped = withRateLimit("analyze", okHandler);
    expect((await analyzeWrapped(makeRequest("203.0.113.11"), makeContext())).status).toBe(200);
    expect((await analyzeWrapped(makeRequest("203.0.113.11"), makeContext())).status).toBe(200);
    expect((await analyzeWrapped(makeRequest("203.0.113.11"), makeContext())).status).toBe(429);

    const billingWrapped = withRateLimit("billing", okHandler);
    expect((await billingWrapped(makeRequest("203.0.113.12"), makeContext())).status).toBe(200);
    expect((await billingWrapped(makeRequest("203.0.113.12"), makeContext())).status).toBe(429);
  });

  it("passes OPTIONS preflight through without counting against the limit", async () => {
    okHandler.mockClear();
    process.env.RATE_LIMIT_ANALYZE_PER_MIN = "1";
    const wrapped = withRateLimit("analyze", okHandler);
    for (let i = 0; i < 5; i++) {
      const res = await wrapped(makeRequest("203.0.113.13", "OPTIONS"), makeContext());
      expect(res.status).toBe(200);
    }
    expect(okHandler).toHaveBeenCalledTimes(5);
  });

  it("tracks separate IPs independently through the wrapper", async () => {
    process.env.RATE_LIMIT_ANALYZE_PER_MIN = "1";
    okHandler.mockClear();
    const wrapped = withRateLimit("analyze", okHandler);
    expect((await wrapped(makeRequest("203.0.113.14"), makeContext())).status).toBe(200);
    expect((await wrapped(makeRequest("203.0.113.14"), makeContext())).status).toBe(429);
    expect((await wrapped(makeRequest("203.0.113.15"), makeContext())).status).toBe(200);
  });
});
