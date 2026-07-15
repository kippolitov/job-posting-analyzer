import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { randomUUID } from "node:crypto";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import {
  startCertsStub,
  stopCertsStub,
  signTestIdToken,
  TEST_CLIENT_ID,
} from "../helpers/testTokens";
import { withAuth } from "../../src/services/auth";
import { analyzeJobHandler } from "../../src/analyze-job/index";
import { getByEmail, setBlocked } from "../../src/services/usersStore";
import { orchestrateJobAnalysis } from "../../src/services/jobExtractionOrchestrator";

vi.mock("../../src/services/jobExtractionOrchestrator", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/services/jobExtractionOrchestrator")>();
  return { ...original, orchestrateJobAnalysis: vi.fn() };
});

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

function makeRequest(authorization?: string): HttpRequest {
  return {
    method: "POST",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? (authorization ?? null) : null,
    },
    json: () => Promise.resolve(validBody),
  } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as InvocationContext;
}

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

const analyzeJob = withAuth(analyzeJobHandler);

describe("analyze-job behind withAuth (integration: certs stub + Azurite self-serve signup)", () => {
  beforeAll(async () => {
    process.env.GOOGLE_OAUTH_CERTS_URL = await startCertsStub();
    process.env.GOOGLE_OAUTH_CLIENT_ID = TEST_CLIENT_ID;
    process.env.REQUIRE_AUTH = "true";
  });

  afterAll(async () => {
    await stopCertsStub();
    delete process.env.GOOGLE_OAUTH_CERTS_URL;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.REQUIRE_AUTH;
  });

  beforeEach(() => {
    vi.mocked(orchestrateJobAnalysis).mockReset();
    vi.mocked(orchestrateJobAnalysis).mockResolvedValue({
      isJobPosting: true,
      arrangement: "remote",
      arrangementConfidence: "explicit",
      seniority: "senior",
      techStack: [],
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-07T00:00:00Z",
    } as never);
  });

  it("401 without a token — orchestrator (OpenAI) never runs", async () => {
    const res = await analyzeJob(makeRequest(), makeContext());
    expect(res.status).toBe(401);
    expect(res.jsonBody).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(vi.mocked(orchestrateJobAnalysis)).not.toHaveBeenCalled();
  });

  it("end-to-end signup: an unknown email creates the Users row and reaches the handler", async () => {
    const email = uniqueEmail();
    expect(await getByEmail(email)).toBeNull();

    const token = signTestIdToken({ email });
    const res = await analyzeJob(makeRequest(`Bearer ${token}`), makeContext());
    expect(res.status).toBe(200);
    expect(vi.mocked(orchestrateJobAnalysis)).toHaveBeenCalledTimes(1);

    const row = await getByEmail(email);
    expect(row).not.toBeNull();
    expect(row?.tier).toBe("free");
  });

  it("a second request from the same account reuses the row (no duplicate signup)", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    const token = signTestIdToken({ email, sub });

    await analyzeJob(makeRequest(`Bearer ${token}`), makeContext());
    const first = await getByEmail(email);

    await analyzeJob(makeRequest(`Bearer ${token}`), makeContext());
    const second = await getByEmail(email);

    expect(second?.createdAt).toBe(first?.createdAt);
    expect(second?.sub).toBe(sub);
  });

  it("blocking is effective on the very next request (no caching)", async () => {
    const email = uniqueEmail();
    const token = signTestIdToken({ email });

    const first = await analyzeJob(makeRequest(`Bearer ${token}`), makeContext());
    expect(first.status).toBe(200);

    await setBlocked(email, true);
    const second = await analyzeJob(makeRequest(`Bearer ${token}`), makeContext());
    expect(second.status).toBe(403);
    expect(second.jsonBody).toMatchObject({ error: { code: "NOT_AUTHORIZED" } });
  });

  it("403 for an unverified email — orchestrator never runs and no Users row is created", async () => {
    const email = uniqueEmail();
    const token = signTestIdToken({ email, email_verified: false });
    const res = await analyzeJob(makeRequest(`Bearer ${token}`), makeContext());
    expect(res.status).toBe(403);
    expect(vi.mocked(orchestrateJobAnalysis)).not.toHaveBeenCalled();
    expect(await getByEmail(email)).toBeNull();
  });
});
