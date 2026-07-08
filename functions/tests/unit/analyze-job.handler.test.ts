import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { analyzeJobHandler } from "../../src/analyze-job/index";
import { withAuth } from "../../src/services/auth";
import { JobSchemaError } from "../../src/services/jobExtractionOrchestrator";
import { orchestrateJobAnalysis } from "../../src/services/jobExtractionOrchestrator";

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

const testUser = { sub: "test-sub", email: "user@example.com" };

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
