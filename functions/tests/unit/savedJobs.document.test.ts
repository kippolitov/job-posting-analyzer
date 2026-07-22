import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { isSavedJobPutBody } from "../../src/models/user";
import type { SavedJobPayload } from "../../src/models/user";
import { saveJob, getJob, KeyMismatchError } from "../../src/services/savedJobsRepository";
import { ensureTable } from "../../src/services/tablesService";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function uniqueSub(): string {
  return `sub-${randomUUID()}`;
}

const validAnalysis = {
  isJobPosting: true,
  title: "Engineer",
  company: "Acme",
  arrangement: "remote",
  arrangementConfidence: "explicit",
  seniority: "senior",
  techStack: [],
  model: "gpt-4o-mini",
  analyzedAt: "2026-07-04T12:00:04Z",
};

function docCanonicalUrl(text = "extracted document text"): string {
  return `doc:${sha256Hex(text)}`;
}

function validDocumentPut(overrides: Partial<SavedJobPayload> = {}): unknown {
  return {
    schemaVersion: 1,
    canonicalUrl: docCanonicalUrl(),
    sourceUrl: "",
    source: "document",
    filename: "job-description.pdf",
    analysis: validAnalysis,
    status: "interested",
    notes: "",
    savedAt: "2026-07-04T12:01:00Z",
    updatedAt: "2026-07-04T12:01:00Z",
    ...overrides,
  };
}

describe("isSavedJobPutBody — document source discriminator (data-model.md §2.2)", () => {
  it("accepts a valid document-sourced body", () => {
    expect(isSavedJobPutBody(validDocumentPut())).toBe(true);
  });

  it("rejects a document body whose canonicalUrl isn't doc:<sha256 hex>", () => {
    expect(isSavedJobPutBody(validDocumentPut({ canonicalUrl: "doc:not-hex" }))).toBe(false);
    expect(
      isSavedJobPutBody(validDocumentPut({ canonicalUrl: "https://example.com/x" }))
    ).toBe(false);
  });

  it("rejects a document body with an empty filename", () => {
    expect(isSavedJobPutBody(validDocumentPut({ filename: "" }))).toBe(false);
  });

  it("allows an empty sourceUrl for a document-sourced body", () => {
    expect(isSavedJobPutBody(validDocumentPut({ sourceUrl: "" }))).toBe(true);
  });

  it("still validates url-sourced bodies exactly as before when source is omitted", () => {
    const urlBody = {
      schemaVersion: 1,
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1",
      analysis: validAnalysis,
      status: "interested",
      notes: "",
      savedAt: "2026-07-04T12:01:00Z",
      updatedAt: "2026-07-04T12:01:00Z",
    };
    expect(isSavedJobPutBody(urlBody)).toBe(true);
  });

  it("still validates url-sourced bodies when source is explicitly 'url'", () => {
    const urlBody = {
      schemaVersion: 1,
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1",
      source: "url",
      filename: "",
      analysis: validAnalysis,
      status: "interested",
      notes: "",
      savedAt: "2026-07-04T12:01:00Z",
      updatedAt: "2026-07-04T12:01:00Z",
    };
    expect(isSavedJobPutBody(urlBody)).toBe(true);
  });

  it("rejects a 'url' source body with a non-http canonicalUrl", () => {
    const body = {
      schemaVersion: 1,
      canonicalUrl: "doc:abc",
      sourceUrl: "",
      source: "url",
      analysis: validAnalysis,
      status: "interested",
      notes: "",
      savedAt: "2026-07-04T12:01:00Z",
      updatedAt: "2026-07-04T12:01:00Z",
    };
    expect(isSavedJobPutBody(body)).toBe(false);
  });
});

describe("saveJob — document-sourced rows (data-model.md §2)", () => {
  it("verifies sha256(canonicalUrl) === key for a doc: identity, same primitive as URL rows", async () => {
    const sub = uniqueSub();
    const canonicalUrl = docCanonicalUrl();
    const key = sha256Hex(canonicalUrl);
    const payload = validDocumentPut({ canonicalUrl }) as SavedJobPayload;

    const saved = await saveJob(sub, key, payload);
    expect(saved.canonicalUrl).toBe(canonicalUrl);
    expect(saved.source).toBe("document");
    expect(saved.filename).toBe("job-description.pdf");

    const fetched = await getJob(sub, key);
    expect(fetched?.source).toBe("document");
    expect(fetched?.filename).toBe("job-description.pdf");
    expect(fetched?.sourceUrl).toBe("");
  });

  it("rejects a mismatched key for a document-sourced save", async () => {
    const sub = uniqueSub();
    const payload = validDocumentPut() as SavedJobPayload;
    const wrongKey = sha256Hex("not-the-canonical-url");
    await expect(saveJob(sub, wrongKey, payload)).rejects.toBeInstanceOf(KeyMismatchError);
  });

  it("back-compat: reading a legacy row (no source/filename columns) defaults to source='url', filename=''", async () => {
    const sub = uniqueSub();
    const canonicalUrl = `https://example.com/jobs/${randomUUID()}`;
    const key = sha256Hex(canonicalUrl);
    const client = await ensureTable("SavedJobs");
    // Simulate a pre-004 row: no source/filename columns at all.
    await client.createEntity({
      partitionKey: sub,
      rowKey: key,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      title: "Engineer",
      company: "Acme",
      arrangement: "remote",
      status: "interested",
      notes: "",
      analysisJson: JSON.stringify(validAnalysis),
      savedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    });

    const job = await getJob(sub, key);
    expect(job?.source).toBe("url");
    expect(job?.filename).toBe("");
  });
});
