import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import {
  startCertsStub,
  stopCertsStub,
  signTestIdToken,
  TEST_CLIENT_ID,
} from "../helpers/testTokens";
import { withAuth } from "../../src/services/auth";
import { analyzeDocumentHandler } from "../../src/analyze-document/index";
import { jobsItemHandler } from "../../src/jobs/index";
import { orchestrateJobAnalysis } from "../../src/services/jobExtractionOrchestrator";
import { ensureTable } from "../../src/services/tablesService";
import { usageRowKey } from "../../src/services/meteringService";
import { MONTHLY_ANALYSES } from "../../src/models/user";
import type { SavedJobEntity } from "../../src/models/user";

vi.mock("../../src/services/jobExtractionOrchestrator", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/services/jobExtractionOrchestrator")>();
  return { ...original, orchestrateJobAnalysis: vi.fn() };
});

const FIXTURES = path.join(__dirname, "..", "fixtures", "documents");

function fixtureFile(name: string, type = "application/octet-stream"): File {
  const bytes = readFileSync(path.join(FIXTURES, name));
  return new File([bytes], name, { type });
}

function makeRequest(authorization: string, formData: FormData): HttpRequest {
  return {
    method: "POST",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? authorization : null,
    },
    formData: () => Promise.resolve(formData),
  } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return { log: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as InvocationContext;
}

function uniqueSub(): string {
  return `sub-${randomUUID()}`;
}

async function usageCount(sub: string): Promise<number | null> {
  const client = await ensureTable("Usage");
  try {
    const row = await client.getEntity<{ count: number }>(sub, usageRowKey());
    return row.count;
  } catch {
    return null;
  }
}

async function seedUsage(sub: string, count: number, limit: number): Promise<void> {
  const client = await ensureTable("Usage");
  await client.createEntity({ partitionKey: sub, rowKey: usageRowKey(), count, limit });
}

const analyzeDocument = withAuth(analyzeDocumentHandler);

describe("analyze-document metering (contracts/analyze-document.md, research R7)", () => {
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
      title: "Senior Backend Engineer",
      company: null,
      location: null,
      arrangement: "hybrid",
      arrangementConfidence: "explicit",
      arrangementEvidence: null,
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "senior",
      techStack: [],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-21T00:00:00.000Z",
    });
  });

  it("a rejected file consumes zero allowance (reject-before-increment, SC-005)", async () => {
    const sub = uniqueSub();
    const token = signTestIdToken({ sub, email: `${sub}@example.com` });
    const form = new FormData();
    form.set("file", fixtureFile("encrypted.pdf", "application/pdf"));

    const res = await analyzeDocument(makeRequest(`Bearer ${token}`, form), makeContext());

    expect(res.status).toBe(422);
    expect(res.jsonBody).toMatchObject({ error: { code: "FILE_PASSWORD_PROTECTED" } });
    expect(vi.mocked(orchestrateJobAnalysis)).not.toHaveBeenCalled();
    expect(await usageCount(sub)).toBeNull();
  });

  it("an oversized file is rejected before any sniff/extraction and consumes zero allowance", async () => {
    const sub = uniqueSub();
    const token = signTestIdToken({ sub, email: `${sub}@example.com` });
    const form = new FormData();
    form.set("file", fixtureFile("oversized.pdf", "application/pdf"));

    const res = await analyzeDocument(makeRequest(`Bearer ${token}`, form), makeContext());

    expect(res.status).toBe(413);
    expect(res.jsonBody).toMatchObject({ error: { code: "FILE_TOO_LARGE" } });
    expect(await usageCount(sub)).toBeNull();
  });

  it(
    "20 parallel valid uploads at 1-remaining yield exactly 1 success (SC-006)",
    async () => {
      const sub = uniqueSub();
      const limit = MONTHLY_ANALYSES.free;
      await seedUsage(sub, limit - 1, limit);
      const token = signTestIdToken({ sub, email: `${sub}@example.com` });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => {
          const form = new FormData();
          form.set("file", fixtureFile("valid.pdf", "application/pdf"));
          return analyzeDocument(makeRequest(`Bearer ${token}`, form), makeContext());
        })
      );

      const successes = results.filter((r) => r.status === 200);
      const exhausted = results.filter((r) => r.status === 429);
      expect(successes).toHaveLength(1);
      expect(exhausted).toHaveLength(19);
      expect(await usageCount(sub)).toBe(limit);
    },
    30_000
  );

  it("a system failure (5xx) after the increment triggers a best-effort refund", async () => {
    const sub = uniqueSub();
    const token = signTestIdToken({ sub, email: `${sub}@example.com` });
    vi.mocked(orchestrateJobAnalysis).mockRejectedValueOnce(new Error("boom"));

    const form = new FormData();
    form.set("file", fixtureFile("valid.pdf", "application/pdf"));
    const res = await analyzeDocument(makeRequest(`Bearer ${token}`, form), makeContext());

    expect(res.status).toBe(500);
    // refundOnSystemFailure is fire-and-forget; wait for the microtask queue to drain.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await usageCount(sub)).toBe(0);
  });

  it("a valid upload returns the same analysis shape as analyze-job, plus source/filename/saveKey", async () => {
    const sub = uniqueSub();
    const token = signTestIdToken({ sub, email: `${sub}@example.com` });
    const form = new FormData();
    form.set("file", fixtureFile("valid.pdf", "application/pdf"));

    const res = await analyzeDocument(makeRequest(`Bearer ${token}`, form), makeContext());

    expect(res.status).toBe(200);
    const body = res.jsonBody as {
      analysis: { title: string };
      source: string;
      filename: string;
      canonicalUrl: string;
      saveKey: string;
      usage: { count: number };
    };
    expect(body.analysis.title).toBe("Senior Backend Engineer");
    expect(body.source).toBe("document");
    expect(body.filename).toBe("valid.pdf");
    expect(body.canonicalUrl).toMatch(/^doc:[0-9a-f]{64}$/);
    expect(body.saveKey).toMatch(/^[0-9a-f]{64}$/);
    expect(body.usage.count).toBe(1);
  });

  it("zero uploaded document bytes persist anywhere after a save (FR-025, SC-008)", async () => {
    const sub = uniqueSub();
    const token = signTestIdToken({ sub, email: `${sub}@example.com` });
    const fileBytes = fixtureFile("valid.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const rawFileBytes = readFileSync(path.join(FIXTURES, "valid.docx"));

    const form = new FormData();
    form.set("file", fileBytes);
    const analyzeRes = await analyzeDocument(makeRequest(`Bearer ${token}`, form), makeContext());
    expect(analyzeRes.status).toBe(200);
    const body = analyzeRes.jsonBody as {
      analysis: unknown;
      filename: string;
      canonicalUrl: string;
      saveKey: string;
    };

    const jobsItem = withAuth(jobsItemHandler);
    const saveRes = await jobsItem(
      {
        method: "PUT",
        params: { key: body.saveKey },
        query: new URLSearchParams(),
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "authorization" ? `Bearer ${token}` : null,
        },
        json: () =>
          Promise.resolve({
            schemaVersion: 1,
            canonicalUrl: body.canonicalUrl,
            sourceUrl: "",
            source: "document",
            filename: body.filename,
            analysis: body.analysis,
            status: "interested",
            notes: "",
            savedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
      } as unknown as HttpRequest,
      makeContext()
    );
    expect(saveRes.status).toBe(200);

    // SavedJobEntity has no byte/blob-shaped column at all (models/user.ts)
    // — assert the actual persisted row's string fields contain nothing
    // from the raw uploaded file (the docx ZIP's own magic bytes, decoded
    // permissively as latin1 so any byte sequence round-trips into the
    // comparison without throwing on invalid UTF-8).
    const client = await ensureTable("SavedJobs");
    const entity = await client.getEntity<SavedJobEntity>(sub, body.saveKey);
    const rawMarker = rawFileBytes.toString("latin1").slice(0, 200);
    const serializedEntity = Object.entries(entity)
      .filter(([key]) => typeof entity[key as keyof SavedJobEntity] === "string")
      .map(([, value]) => String(value))
      .join("\n");
    expect(serializedEntity.includes(rawMarker)).toBe(false);
    expect(Object.keys(entity)).not.toContain("documentBytes");
    expect(Object.keys(entity)).not.toContain("fileBytes");
  });
});
