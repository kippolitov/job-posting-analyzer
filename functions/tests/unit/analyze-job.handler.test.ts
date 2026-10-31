import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { analyzeJobHandler } from "../../src/analyze-job/index";
import { withAuth } from "../../src/services/auth";
import { JobSchemaError, ModelTimeoutError } from "../../src/services/jobExtractionOrchestrator";
import {
  orchestrateJobAnalysis,
  type ModelUsage,
} from "../../src/services/jobExtractionOrchestrator";
import { ModelConfigError } from "../../src/services/modelConfig";
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

// Unique per run: the handler meters against Azurite, so a fixed sub would
// accumulate usage across runs.
const testUser = { sub: `test-sub-${randomUUID()}`, email: "user@example.com", tier: "free" as const };

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

  it("accepts a request with structuredSources absent (old extension) — FR-014, contracts §1", async () => {
    vi.mocked(orchestrateJobAnalysis).mockResolvedValue({
      ...hybridAnalysis,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-04T12:00:04Z",
    } as never);

    // validBody.extract carries no structuredSources field at all.
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), testUser);
    expect(res.status).toBe(200);
  });

  it("accepts a request with structuredSources present, including an unknown kind — FR-014, contracts §1", async () => {
    vi.mocked(orchestrateJobAnalysis).mockResolvedValue({
      ...hybridAnalysis,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-04T12:00:04Z",
    } as never);

    const bodyWithStructuredSources = {
      extract: {
        ...validBody.extract,
        structuredSources: [
          { kind: "microdata", data: { title: "Sr. Manager" } },
          // A future harvester kind an older/newer backend doesn't recognize
          // yet — must be tolerated, not rejected (contracts §1).
          { kind: "state-blob-future-convention", data: { anything: true } },
        ],
      },
    };

    const res = await analyzeJobHandler(
      makeRequest(bodyWithStructuredSources),
      makeContext(),
      testUser
    );
    expect(res.status).toBe(200);
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
      expect.any(Function),
      expect.any(Function)
    );
  });

  it("logs one model.usage line per completion attempt, with token counts only", async () => {
    const usage = (attempt: 1 | 2): ModelUsage => ({
      deployment: "gpt-6-luna",
      promptTokens: 2100,
      completionTokens: 380,
      reasoningTokens: 0,
      cachedTokens: 0,
      latencyMs: 4200,
      attempt,
      finishReason: "stop",
    });
    vi.mocked(orchestrateJobAnalysis).mockImplementation((_req, _tier, _warn, observe) => {
      observe?.(usage(1));
      observe?.(usage(2));
      return Promise.resolve({
        ...hybridAnalysis,
        model: "gpt-6-luna",
        analyzedAt: "2026-07-04T12:00:04Z",
      } as never);
    });
    const profile = "Distinctive profile text that must never reach the logs";
    const log = vi.fn<unknown[], void>();
    const warn = vi.fn<unknown[], void>();
    const error = vi.fn<unknown[], void>();
    const context = { log, warn, error } as unknown as InvocationContext;

    const res = await analyzeJobHandler(
      makeRequest({ ...validBody, profile }),
      context,
      testUser
    );
    expect(res.status).toBe(200);

    const logCalls = log.mock.calls;
    const usageLines = logCalls.filter(([first]) => first === "model.usage");
    expect(usageLines).toHaveLength(2);
    expect(JSON.parse(usageLines[0][1] as string)).toEqual(usage(1));
    expect(JSON.parse(usageLines[1][1] as string)).toEqual(usage(2));

    const everything = [
      ...logCalls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
    expect(everything).not.toContain(validBody.extract.mainText.trim());
    expect(everything).not.toContain(profile);
  });

  it("maps ModelConfigError to 500 SERVICE_ERROR", async () => {
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(
      new ModelConfigError("AZURE_OPENAI_JOB_REASONING_EFFORT must be one of none|low|medium|high|xhigh")
    );
    const error = vi.fn();
    const context = { log: vi.fn(), warn: vi.fn(), error } as unknown as InvocationContext;
    const res = await analyzeJobHandler(makeRequest(validBody), context, testUser);
    expect(res.status).toBe(500);
    expect(res.jsonBody).toMatchObject({ error: { code: "SERVICE_ERROR" } });
    expect(error).toHaveBeenCalled();
  });

  it("refunds through the 5xx path when the model config is invalid", async () => {
    const sub = uniqueSub();
    await seedUsage(sub, 5, MONTHLY_ANALYSES.free);
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(
      new ModelConfigError("AZURE_OPENAI_JOB_TEMPERATURE must be a number in [0, 2]")
    );
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), {
      ...testUser,
      sub,
    });
    expect(res.status).toBe(500);
    await vi.waitFor(async () => {
      expect((await readUsage(sub)).count).toBe(5);
    });
  });

  it("maps JobSchemaError to 502 SCHEMA_PARSE_FAILED", async () => {
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(
      new JobSchemaError("model output failed schema")
    );
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), testUser);
    expect(res.status).toBe(502);
    expect(res.jsonBody).toMatchObject({ error: { code: "SCHEMA_PARSE_FAILED" } });
  });

  it("maps ModelTimeoutError to 504 MODEL_TIMEOUT with a retry message", async () => {
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(new ModelTimeoutError("model stalled"));
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), testUser);
    expect(res.status).toBe(504);
    expect(res.jsonBody).toMatchObject({
      error: { code: "MODEL_TIMEOUT", message: expect.stringMatching(/took too long.*try again/i) },
    });
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

describe("analyze-job metering (moved from withUsageMetering, 006 §4)", () => {
  const success = () =>
    vi.mocked(orchestrateJobAnalysis).mockResolvedValue({
      ...hybridAnalysis,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-04T12:00:04Z",
    } as never);

  beforeEach(() => {
    vi.mocked(orchestrateJobAnalysis).mockReset();
  });

  afterEach(() => {
    delete process.env.METERING_ENFORCED;
  });

  it("returns 429 USAGE_LIMIT_REACHED before the model runs when the allowance is exhausted", async () => {
    const sub = uniqueSub();
    await seedUsage(sub, MONTHLY_ANALYSES.free, MONTHLY_ANALYSES.free);

    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), {
      ...testUser,
      sub,
    });
    expect(res.status).toBe(429);
    expect(res.jsonBody).toMatchObject({
      error: { code: "USAGE_LIMIT_REACHED" },
      usage: { count: MONTHLY_ANALYSES.free, limit: MONTHLY_ANALYSES.free, tier: "free" },
    });
    expect(orchestrateJobAnalysis).not.toHaveBeenCalled();
  });

  it("echoes usage on a 200 response, additive to the existing body", async () => {
    success();
    const sub = uniqueSub();
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), {
      ...testUser,
      sub,
    });
    expect(res.status).toBe(200);
    expect(res.jsonBody).toMatchObject({
      arrangement: "hybrid",
      usage: { count: 1, limit: MONTHLY_ANALYSES.free, tier: "free", charged: "analysis" },
    });
    expect((await readUsage(sub)).count).toBe(1);
  });

  it("best-effort refunds the increment on a system error", async () => {
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(new Error("boom"));
    const sub = uniqueSub();
    await seedUsage(sub, 5, MONTHLY_ANALYSES.free);
    await analyzeJobHandler(makeRequest(validBody), makeContext(), { ...testUser, sub });
    await vi.waitFor(async () => {
      expect((await readUsage(sub)).count).toBe(5);
    });
  });

  it("refunds the increment when the model times out (the handler, not the host, ends the call)", async () => {
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(new ModelTimeoutError("model stalled"));
    const sub = uniqueSub();
    await seedUsage(sub, 5, MONTHLY_ANALYSES.free);
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), { ...testUser, sub });
    expect(res.status).toBe(504);
    await vi.waitFor(async () => {
      expect((await readUsage(sub)).count).toBe(5);
    });
  });

  it("METERING_ENFORCED=false counts but never blocks (shadow mode)", async () => {
    success();
    process.env.METERING_ENFORCED = "false";
    const sub = uniqueSub();
    await seedUsage(sub, MONTHLY_ANALYSES.free, MONTHLY_ANALYSES.free);
    const res = await analyzeJobHandler(makeRequest(validBody), makeContext(), {
      ...testUser,
      sub,
    });
    expect(res.status).toBe(200);
    expect(orchestrateJobAnalysis).toHaveBeenCalledTimes(1);
  });
});

describe("analyze-job charges only after validation (contracts/analyze-api.md §4)", () => {
  beforeEach(() => {
    vi.mocked(orchestrateJobAnalysis).mockReset();
  });

  async function usageOrNull(sub: string): Promise<number | null> {
    const client = await ensureTable("Usage");
    try {
      return (await client.getEntity<{ count: number }>(sub, usageRowKey())).count;
    } catch {
      return null;
    }
  }

  it.each([
    ["invalid JSON", new Error("bad json"), 400],
    ["a missing extract", { profile: "x" }, 400],
    ["an oversized mainText", { extract: { ...validBody.extract, mainText: "x".repeat(40_001) } }, 413],
    [
      "malformed profileData",
      { ...validBody, profileData: { text: 1, dealbreakers: [] } },
      400,
    ],
  ])("%s leaves the allowance untouched", async (_name, body, status) => {
    const sub = uniqueSub();
    const res = await analyzeJobHandler(makeRequest(body), makeContext(), { ...testUser, sub });
    expect(res.status).toBe(status);
    expect(await usageOrNull(sub)).toBeNull();
    expect(orchestrateJobAnalysis).not.toHaveBeenCalled();
  });

  it(
    "N parallel requests at the cap produce exactly one 200",
    async () => {
      vi.mocked(orchestrateJobAnalysis).mockResolvedValue({
        ...hybridAnalysis,
        model: "gpt-4o-mini",
        analyzedAt: "2026-07-04T12:00:04Z",
      } as never);
      const sub = uniqueSub();
      await seedUsage(sub, MONTHLY_ANALYSES.free - 1, MONTHLY_ANALYSES.free);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          analyzeJobHandler(makeRequest(validBody), makeContext(), { ...testUser, sub })
        )
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 429)).toHaveLength(9);
    },
    30_000
  );
});
