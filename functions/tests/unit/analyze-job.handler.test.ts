import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { analyzeJobHandler, withUsageMetering } from "../../src/analyze-job/index";
import { withAuth } from "../../src/services/auth";
import { JobSchemaError } from "../../src/services/jobExtractionOrchestrator";
import { orchestrateJobAnalysis } from "../../src/services/jobExtractionOrchestrator";
import { MONTHLY_ANALYSES } from "../../src/models/user";
import { ensureTable } from "../../src/services/tablesService";
import { usageRowKey } from "../../src/services/meteringService";

vi.mock("../../src/services/jobExtractionOrchestrator", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/services/jobExtractionOrchestrator")>();
  return { ...original, orchestrateJobAnalysis: vi.fn() };
});

const hybridAnalysis = JSON.parse(
  readFileSync(
    path.join(__dirname, "..", "fixtures", "jobAnalysis", "explicit-hybrid.json"),
    "utf-8"
  )
) as Record<string, unknown>;

function makeRequest(body: unknown, method = "POST"): HttpRequest {
  return {
    method,
    headers: { get: () => null },
    json: () =>
      body instanceof Error ? Promise.reject(body) : Promise.resolve(body),
  } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as InvocationContext;
}

const testUser = { sub: "test-sub", email: "user@example.com", tier: "free" as const };

const validBody = {
  extract: {
    url: "https://example.com/jobs/1",
    canonicalUrl: "https://example.com/jobs/1",
    title: "Job",
    jsonLd: [],
    mainText: "A realistic job description body. ".repeat(20),
    extractedAt: "2026-07-04T12:00:00Z",
  },
};

describe("analyze-job handler", () => {
  beforeEach(() => {
    vi.mocked(orchestrateJobAnalysis).mockReset();
  });

  it("returns 204 for OPTIONS preflight", async () => {
    const res = await analyzeJobHandler(makeRequest(null, "OPTIONS"), makeContext(), testUser);
    expect(res.status).toBe(204);
  });

  it("returns 400 INVALID_REQUEST for non-JSON bodies", async () => {
    const res = await analyzeJobHandler(
      makeRequest(new Error("bad json")),
      makeContext(),
      testUser
    );
    expect(res.status).toBe(400);
    expect(res.jsonBody).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("returns 400 INVALID_REQUEST when extract is missing or malformed", async () => {
    const res = await analyzeJobHandler(makeRequest({ profile: "x" }), makeContext(), testUser);
    expect(res.status).toBe(400);
    expect(res.jsonBody).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("returns 413 EXTRACT_TOO_LARGE when mainText exceeds the cap", async () => {
    const res = await analyzeJobHandler(
      makeRequest({
        extract: { ...validBody.extract, mainText: "x".repeat(40_001) },
      }),
      makeContext(),
      testUser
    );
    expect(res.status).toBe(413);
    expect(res.jsonBody).toMatchObject({ error: { code: "EXTRACT_TOO_LARGE" } });
  });

  it("returns 200 with the analysis on success", async () => {
    vi.mocked(orchestrateJobAnalysis).mockResolvedValue({
      ...hybridAnalysis,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-04T12:00:04Z",
    } as never);

    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), testUser);
    expect(res.status).toBe(200);
    expect(res.jsonBody).toMatchObject({ arrangement: "hybrid", daysInOffice: 3 });
  });

  it("passes profile and assumeJobPosting through to the orchestrator", async () => {
    vi.mocked(orchestrateJobAnalysis).mockResolvedValue({
      ...hybridAnalysis,
      model: "m",
      analyzedAt: "t",
    } as never);

    await analyzeJobHandler(
      makeRequest({ ...validBody, profile: "P", assumeJobPosting: true }),
      makeContext(),
      testUser
    );
    expect(vi.mocked(orchestrateJobAnalysis)).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "P", assumeJobPosting: true }),
      testUser.tier,
      expect.any(Function)
    );
  });

  it("maps JobSchemaError to 502 SCHEMA_PARSE_FAILED", async () => {
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(
      new JobSchemaError("model output failed schema")
    );
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), testUser);
    expect(res.status).toBe(502);
    expect(res.jsonBody).toMatchObject({ error: { code: "SCHEMA_PARSE_FAILED" } });
  });

  it("maps unexpected orchestrator errors to 500 SERVICE_ERROR", async () => {
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(new Error("boom"));
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), testUser);
    expect(res.status).toBe(500);
    expect(res.jsonBody).toMatchObject({ error: { code: "SERVICE_ERROR" } });
  });

  it("rejects unauthenticated requests before the orchestrator when wrapped in withAuth", async () => {
    process.env.REQUIRE_AUTH = "true";
    try {
      const wrapped = withAuth(analyzeJobHandler);
      const request = {
        ...makeRequest(validBody),
        headers: { get: () => null },
      } as unknown as HttpRequest;
      const res = await wrapped(request, makeContext());
      expect(res.status).toBe(401);
      expect(res.jsonBody).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      expect(vi.mocked(orchestrateJobAnalysis)).not.toHaveBeenCalled();
    } finally {
      delete process.env.REQUIRE_AUTH;
    }
  });
});

function uniqueSub(): string {
  return `sub-${randomUUID()}`;
}

async function seedUsage(sub: string, count: number, limit: number): Promise<void> {
  const client = await ensureTable("Usage");
  await client.createEntity({ partitionKey: sub, rowKey: usageRowKey(), count, limit });
}

async function readUsage(sub: string): Promise<{ count: number }> {
  const client = await ensureTable("Usage");
  return (await client.getEntity<{ count: number }>(sub, usageRowKey())) as {
    count: number;
  };
}

describe("withUsageMetering", () => {
  afterEach(() => {
    delete process.env.METERING_ENFORCED;
  });

  it("returns 429 USAGE_LIMIT_REACHED before the wrapped handler runs when the allowance is exhausted", async () => {
    const sub = uniqueSub();
    await seedUsage(sub, MONTHLY_ANALYSES.free, MONTHLY_ANALYSES.free);
    const inner = vi.fn();
    const wrapped = withUsageMetering(inner);

    const res = await wrapped(makeRequest(validBody), makeContext(), {
      ...testUser,
      sub,
    });
    expect(res.status).toBe(429);
    expect(res.jsonBody).toMatchObject({
      error: { code: "USAGE_LIMIT_REACHED" },
      usage: { count: MONTHLY_ANALYSES.free, limit: MONTHLY_ANALYSES.free, tier: "free" },
    });
    expect(inner).not.toHaveBeenCalled();
  });

  it("echoes usage on a 200 response, additive to the existing body", async () => {
    const sub = uniqueSub();
    const inner = vi.fn().mockResolvedValue({
      status: 200,
      jsonBody: { isJobPosting: true },
    });
    const wrapped = withUsageMetering(inner);

    const res = await wrapped(makeRequest(validBody), makeContext(), {
      ...testUser,
      sub,
    });
    expect(res.status).toBe(200);
    expect(res.jsonBody).toMatchObject({
      isJobPosting: true,
      usage: { count: 1, limit: MONTHLY_ANALYSES.free, tier: "free" },
    });
    expect((await readUsage(sub)).count).toBe(1);
  });

  it("best-effort refunds the increment when the wrapped handler fails with a system error", async () => {
    const sub = uniqueSub();
    await seedUsage(sub, 5, MONTHLY_ANALYSES.free);
    const inner = vi.fn().mockResolvedValue({
      status: 500,
      jsonBody: { error: { code: "SERVICE_ERROR" } },
    });
    const wrapped = withUsageMetering(inner);

    await wrapped(makeRequest(validBody), makeContext(), { ...testUser, sub });
    // Increment (5 -> 6) then refund (6 -> 5): net unchanged.
    await vi.waitFor(async () => {
      expect((await readUsage(sub)).count).toBe(5);
    });
  });

  it("METERING_ENFORCED=false counts but never blocks (shadow mode)", async () => {
    process.env.METERING_ENFORCED = "false";
    const sub = uniqueSub();
    await seedUsage(sub, MONTHLY_ANALYSES.free, MONTHLY_ANALYSES.free);
    const inner = vi.fn().mockResolvedValue({ status: 200, jsonBody: {} });
    const wrapped = withUsageMetering(inner);

    const res = await wrapped(makeRequest(validBody), makeContext(), {
      ...testUser,
      sub,
    });
    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
