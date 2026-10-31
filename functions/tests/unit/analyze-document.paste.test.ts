import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { analyzeDocumentHandler } from "../../src/analyze-document/index";
import {
  orchestrateJobAnalysis,
  ModelTimeoutError,
} from "../../src/services/jobExtractionOrchestrator";
import { chargeAnalysis, refundCharge } from "../../src/services/meteringService";
import { sha256Hex } from "../../src/services/savedJobsRepository";
import { pasteIdentity } from "../../../shared/pasteIdentity";

/** contracts/analyze-api.md §1: the `text` part for the web's Paste text option (FR-027). */
vi.mock("../../src/services/jobExtractionOrchestrator", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/services/jobExtractionOrchestrator")>();
  return { ...original, orchestrateJobAnalysis: vi.fn() };
});

vi.mock("../../src/services/meteringService", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/services/meteringService")>();
  return {
    ...original,
    chargeAnalysis: vi.fn(),
    refundCharge: vi.fn().mockResolvedValue(undefined),
    grantUnavailableRefund: vi.fn().mockResolvedValue(false),
  };
});

const analysis = {
  ...(JSON.parse(
    readFileSync(
      path.join(__dirname, "..", "fixtures", "jobAnalysis", "explicit-hybrid.json"),
      "utf-8"
    )
  ) as Record<string, unknown>),
  model: "gpt-6-luna",
  analyzedAt: "2026-10-29T00:00:00.000Z",
};

const user = { sub: "paste-sub", email: "user@example.com", tier: "free" as const };
const POSTING = "We are hiring a senior backend engineer to build C# services. ".repeat(10);

function request(parts: Record<string, string | Blob>): HttpRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(parts)) form.set(k, v);
  return {
    method: "POST",
    headers: { get: () => null },
    formData: () => Promise.resolve(form),
  } as unknown as HttpRequest;
}

const context = () =>
  ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }) as unknown as InvocationContext;

describe("analyze-document text part", () => {
  beforeEach(() => {
    vi.mocked(orchestrateJobAnalysis).mockReset().mockResolvedValue(analysis as never);
    vi.mocked(chargeAnalysis).mockReset().mockResolvedValue({
      allowed: true,
      charged: "analysis",
      usage: {
        count: 1,
        limit: 50,
        resetsAt: "2026-11-01T00:00:00.000Z",
        tier: "free",
        rescoresUsed: 0,
        rescoresLimit: 10,
      },
    });
  });

  it("rejects both a file and text with 400", async () => {
    const res = await analyzeDocumentHandler(
      request({ text: POSTING, file: new Blob(["x"]) }),
      context(),
      user
    );
    expect(res.status).toBe(400);
    expect(chargeAnalysis).not.toHaveBeenCalled();
  });

  it("rejects neither a file nor text with 400", async () => {
    const res = await analyzeDocumentHandler(request({}), context(), user);
    expect(res.status).toBe(400);
    expect(chargeAnalysis).not.toHaveBeenCalled();
  });

  it("rejects 299 characters with 400 TEXT_TOO_SHORT, uncharged", async () => {
    const res = await analyzeDocumentHandler(request({ text: "x".repeat(299) }), context(), user);
    expect(res.status).toBe(400);
    expect(res.jsonBody).toMatchObject({ error: { code: "TEXT_TOO_SHORT" } });
    expect(chargeAnalysis).not.toHaveBeenCalled();
  });

  it("rejects 40,001 characters with 413 TEXT_TOO_LONG, uncharged", async () => {
    const res = await analyzeDocumentHandler(
      request({ text: "x".repeat(40_001) }),
      context(),
      user
    );
    expect(res.status).toBe(413);
    expect(res.jsonBody).toMatchObject({ error: { code: "TEXT_TOO_LONG" } });
    expect(chargeAnalysis).not.toHaveBeenCalled();
  });

  it("answers a model timeout with 504 MODEL_TIMEOUT and refunds the charge", async () => {
    vi.mocked(orchestrateJobAnalysis).mockRejectedValue(new ModelTimeoutError("model stalled"));
    const res = await analyzeDocumentHandler(request({ text: POSTING }), context(), user);
    expect(res.status).toBe(504);
    expect(res.jsonBody).toMatchObject({
      error: { code: "MODEL_TIMEOUT", message: expect.stringMatching(/took too long.*try again/i) },
    });
    expect(refundCharge).toHaveBeenCalledWith(user.sub, user.tier, "analysis");
  });

  it("analyzes a valid paste the way the extension's paste flow does", async () => {
    const res = await analyzeDocumentHandler(request({ text: POSTING }), context(), user);
    expect(res.status).toBe(200);

    const [req] = vi.mocked(orchestrateJobAnalysis).mock.calls[0];
    expect(req.extract.title).toBe("");
    expect(req.extract.mainText).toBe(POSTING);

    const body = res.jsonBody as Record<string, unknown>;
    expect(body.source).toBe("paste");
    expect(body).not.toHaveProperty("filename");
    const key = await pasteIdentity(POSTING);
    expect(body.canonicalUrl).toBe(key);
    expect(body.saveKey).toBe(sha256Hex(key));
  });

  it("gives a whitespace variant of the same text the same saveKey", async () => {
    const a = await analyzeDocumentHandler(request({ text: POSTING }), context(), user);
    const b = await analyzeDocumentHandler(
      request({ text: `\n  ${POSTING.replace(/ /g, "  ")}  ` }),
      context(),
      user
    );
    expect((a.jsonBody as { saveKey: string }).saveKey).toBe(
      (b.jsonBody as { saveKey: string }).saveKey
    );
  });
});
