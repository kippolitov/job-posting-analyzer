import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { analyzeJobHandler } from "../../src/analyze-job/index";
import { analyzeDocumentHandler } from "../../src/analyze-document/index";
import { orchestrateJobAnalysis } from "../../src/services/jobExtractionOrchestrator";
import { extractDocument } from "../../src/services/documentExtraction";
import { fingerprintForRequest } from "../../src/services/profileFingerprint";
import { ensureTable } from "../../src/services/tablesService";
import { usageRowKey } from "../../src/services/meteringService";
import {
  FREE_RESCORES_PER_MONTH,
  MONTHLY_ANALYSES,
  UNAVAILABLE_REFUNDS_PER_MONTH,
  type AuthenticatedUser,
} from "../../src/models/user";
import type { AnalyzeJobRequest } from "../../src/models/job";
import { pasteIdentity } from "../../../shared/pasteIdentity";
import { seedSavedJob } from "../helpers/savedJobsSeeder";

/**
 * Rescore metering end to end (research R6, contracts/analyze-api.md §2–3),
 * against Azurite, with the model replaced by recorded fixtures. The mock
 * stamps the fingerprint the real orchestrator would stamp.
 */
vi.mock("../../src/services/jobExtractionOrchestrator", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/services/jobExtractionOrchestrator")>();
  return { ...original, orchestrateJobAnalysis: vi.fn() };
});

const FIXTURES = path.join(__dirname, "..", "fixtures");
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, "jobAnalysis", `${name}.json`), "utf-8")) as {
    fit: Record<string, unknown> | null;
  };

function respondWith(name: string) {
  vi.mocked(orchestrateJobAnalysis).mockImplementation((req: AnalyzeJobRequest) => {
    const payload = fixture(name);
    const fingerprint = fingerprintForRequest(req);
    return Promise.resolve({
      ...payload,
      fit: payload.fit && fingerprint ? { ...payload.fit, profileFingerprint: fingerprint } : null,
      model: "gpt-6-luna",
      analyzedAt: "2026-10-29T00:00:00.000Z",
    } as never);
  });
}

const profileData = { text: "Senior .NET engineer", dealbreakers: ["No fully on-site roles"] };
const OLD_PROFILE = { text: "Junior .NET engineer", dealbreakers: [] };
const oldFingerprint = fingerprintForRequest({ profileData: OLD_PROFILE })!;

function user(tier: "free" | "premium" = "free"): AuthenticatedUser {
  return { sub: `sub-${randomUUID()}`, email: "user@example.com", tier };
}

function context(): InvocationContext {
  return { log: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as InvocationContext;
}

function jsonRequest(body: unknown): HttpRequest {
  return {
    method: "POST",
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as HttpRequest;
}

function formRequest(form: FormData): HttpRequest {
  return {
    method: "POST",
    headers: { get: () => null },
    formData: () => Promise.resolve(form),
  } as unknown as HttpRequest;
}

const canonicalUrl = () => `https://jobs.example.com/${randomUUID()}`;

function rescoreBody(url: string, extra: Record<string, unknown> = {}) {
  return {
    extract: {
      url,
      canonicalUrl: url,
      title: "Senior Backend Engineer",
      jsonLd: [],
      mainText: "This role is fully on-site at our Dallas office, five days a week.",
      extractedAt: "2026-10-29T00:00:00.000Z",
    },
    profileData,
    rescore: { priorFingerprint: oldFingerprint },
    ...extra,
  };
}

interface UsageRow {
  count: number;
  rescoresUsed?: number;
  unavailableRefunds?: number;
}

async function seedUsage(sub: string, row: UsageRow): Promise<void> {
  const client = await ensureTable("Usage");
  await client.createEntity({
    partitionKey: sub,
    rowKey: usageRowKey(),
    limit: MONTHLY_ANALYSES.free,
    ...row,
  });
}

async function readUsage(sub: string): Promise<UsageRow> {
  const client = await ensureTable("Usage");
  return client.getEntity<UsageRow>(sub, usageRowKey());
}

type Body = {
  postingUnavailable?: boolean;
  usage: { charged: string; rescoresUsed: number; rescoresLimit: number; count: number };
};

describe("rescore through analyze-job (research R6)", () => {
  beforeEach(() => {
    vi.mocked(orchestrateJobAnalysis).mockReset();
    respondWith("dealbreaker-onsite");
  });

  it("a rescore of a saved stale posting is charged as a free rescore", async () => {
    const u = user();
    const url = canonicalUrl();
    await seedSavedJob(u.sub, url, { score: 50, rationale: "r", profileFingerprint: oldFingerprint });

    const res = await analyzeJobHandler(jsonRequest(rescoreBody(url)), context(), u);
    expect(res.status).toBe(200);
    expect((res.jsonBody as Body).usage).toMatchObject({
      charged: "rescore",
      rescoresUsed: 1,
      rescoresLimit: FREE_RESCORES_PER_MONTH,
      count: 0,
    });
  });

  it("an ordinary analysis echoes charged: analysis", async () => {
    const u = user();
    const res = await analyzeJobHandler(
      jsonRequest({ ...rescoreBody(canonicalUrl()), rescore: undefined }),
      context(),
      u
    );
    expect((res.jsonBody as Body).usage).toMatchObject({ charged: "analysis", count: 1 });
  });

  it("succeeds when the allowance is used up but free rescores are left", async () => {
    const u = user();
    const url = canonicalUrl();
    await seedUsage(u.sub, { count: MONTHLY_ANALYSES.free });
    await seedSavedJob(u.sub, url, { score: 50, rationale: "r" });
    const res = await analyzeJobHandler(jsonRequest(rescoreBody(url)), context(), u);
    expect(res.status).toBe(200);
    expect((res.jsonBody as Body).usage.charged).toBe("rescore");
  });

  it("returns 429 with rescoresUsed when both are used up", async () => {
    const u = user();
    const url = canonicalUrl();
    await seedUsage(u.sub, { count: MONTHLY_ANALYSES.free, rescoresUsed: FREE_RESCORES_PER_MONTH });
    await seedSavedJob(u.sub, url, { score: 50, rationale: "r" });
    const res = await analyzeJobHandler(jsonRequest(rescoreBody(url)), context(), u);
    expect(res.status).toBe(429);
    expect(res.jsonBody).toMatchObject({
      error: { code: "USAGE_LIMIT_REACHED" },
      usage: { rescoresUsed: FREE_RESCORES_PER_MONTH, rescoresLimit: FREE_RESCORES_PER_MONTH },
    });
    expect(orchestrateJobAnalysis).not.toHaveBeenCalled();
  });

  it("refunds the free rescore on a model 5xx", async () => {
    const u = user();
    const url = canonicalUrl();
    await seedSavedJob(u.sub, url, { score: 50, rationale: "r" });
    vi.mocked(orchestrateJobAnalysis).mockRejectedValueOnce(new Error("boom"));
    const res = await analyzeJobHandler(jsonRequest(rescoreBody(url)), context(), u);
    expect(res.status).toBe(500);
    await vi.waitFor(async () => {
      expect((await readUsage(u.sub)).rescoresUsed ?? 0).toBe(0);
    });
  });

  it("a rescore that finds no posting is refunded and flagged postingUnavailable", async () => {
    respondWith("non-job");
    const u = user();
    const url = canonicalUrl();
    await seedSavedJob(u.sub, url, { score: 50, rationale: "r" });
    const res = await analyzeJobHandler(jsonRequest(rescoreBody(url)), context(), u);
    expect(res.status).toBe(200);
    expect(res.jsonBody).toMatchObject({ postingUnavailable: true, usage: { charged: "none" } });
    expect(await readUsage(u.sub)).toMatchObject({ rescoresUsed: 0, unavailableRefunds: 1 });
  });

  it("an 11th unavailable refund in the month is not granted", async () => {
    respondWith("non-job");
    const u = user();
    const url = canonicalUrl();
    await seedUsage(u.sub, { count: 0, unavailableRefunds: UNAVAILABLE_REFUNDS_PER_MONTH });
    await seedSavedJob(u.sub, url, { score: 50, rationale: "r" });
    const res = await analyzeJobHandler(jsonRequest(rescoreBody(url)), context(), u);
    expect(res.jsonBody).toMatchObject({ postingUnavailable: true, usage: { charged: "rescore" } });
    expect(await readUsage(u.sub)).toMatchObject({
      rescoresUsed: 1,
      unavailableRefunds: UNAVAILABLE_REFUNDS_PER_MONTH,
    });
  });

  it("assumeJobPosting turns off the unavailable refund", async () => {
    respondWith("non-job");
    const u = user();
    const url = canonicalUrl();
    await seedSavedJob(u.sub, url, { score: 50, rationale: "r" });
    const res = await analyzeJobHandler(
      jsonRequest(rescoreBody(url, { assumeJobPosting: true })),
      context(),
      u
    );
    expect(res.jsonBody).not.toHaveProperty("postingUnavailable");
    expect((res.jsonBody as Body).usage.charged).toBe("rescore");
  });
});

describe("rescore through analyze-document (research R6, R7)", () => {
  const docBytes = readFileSync(path.join(FIXTURES, "documents", "valid.docx"));

  beforeEach(() => {
    vi.mocked(orchestrateJobAnalysis).mockReset();
    respondWith("dealbreaker-onsite");
  });

  function docForm(extra: Record<string, string> = {}): FormData {
    const form = new FormData();
    form.set(
      "file",
      new File([docBytes], "valid.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    );
    form.set("profileData", JSON.stringify(profileData));
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  }

  it("finds the saved doc: row and charges a free rescore", async () => {
    const u = user();
    const { text } = await extractDocument(docBytes);
    const docUrl = `doc:${createHash("sha256").update(text).digest("hex")}`;
    await seedSavedJob(u.sub, docUrl, { score: 50, rationale: "r" }, "document");

    const res = await analyzeDocumentHandler(
      formRequest(docForm({ rescore: "true", priorFingerprint: oldFingerprint })),
      context(),
      u
    );
    expect(res.status).toBe(200);
    expect((res.jsonBody as Body).usage).toMatchObject({ charged: "rescore", rescoresUsed: 1 });
  });

  it("rejects malformed profileData with 400 and charges nothing", async () => {
    const u = user();
    const form = docForm();
    form.set("profileData", "{not json");
    const res = await analyzeDocumentHandler(formRequest(form), context(), u);
    expect(res.status).toBe(400);
    expect(res.jsonBody).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(orchestrateJobAnalysis).not.toHaveBeenCalled();
  });

  it("a paste rescore through the text part finds the extension's paste: row", async () => {
    const u = user();
    const text = "Senior Backend Engineer at Initech. ".repeat(20);
    await seedSavedJob(u.sub, await pasteIdentity(text), { score: 50, rationale: "r" }, "paste");

    const form = new FormData();
    form.set("text", text);
    form.set("profileData", JSON.stringify(profileData));
    form.set("rescore", "true");
    form.set("priorFingerprint", oldFingerprint);
    const res = await analyzeDocumentHandler(formRequest(form), context(), u);
    expect(res.status).toBe(200);
    expect((res.jsonBody as Body).usage).toMatchObject({ charged: "rescore" });
  });
});
