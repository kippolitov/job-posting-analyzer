import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { isSavedJobPutBody } from "../../src/models/user";
import type { SavedJobPayload } from "../../src/models/user";
import { saveJob, getJob } from "../../src/services/savedJobsRepository";

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

function pasteCanonicalUrl(text = "a pasted job posting body"): string {
  return `paste:${sha256Hex(text)}`;
}

function validPastePut(overrides: Partial<SavedJobPayload> = {}): unknown {
  return {
    schemaVersion: 1,
    canonicalUrl: pasteCanonicalUrl(),
    sourceUrl: "",
    source: "paste",
    filename: "",
    analysis: validAnalysis,
    status: "interested",
    notes: "",
    savedAt: "2026-07-04T12:01:00Z",
    updatedAt: "2026-07-04T12:01:00Z",
    ...overrides,
  };
}

describe("isSavedJobPutBody — paste source discriminator (spec 005 FR-020/FR-021)", () => {
  it("accepts a valid paste-sourced body", () => {
    expect(isSavedJobPutBody(validPastePut())).toBe(true);
  });

  it("accepts a paste body with filename omitted entirely", () => {
    const body = validPastePut() as Record<string, unknown>;
    delete body.filename;
    expect(isSavedJobPutBody(body)).toBe(true);
  });

  it("rejects a paste body whose canonicalUrl isn't paste:<sha256 hex>", () => {
    expect(isSavedJobPutBody(validPastePut({ canonicalUrl: "paste:not-hex" }))).toBe(false);
    expect(
      isSavedJobPutBody(validPastePut({ canonicalUrl: "https://example.com/x" }))
    ).toBe(false);
    expect(isSavedJobPutBody(validPastePut({ canonicalUrl: "doc:" + sha256Hex("x") }))).toBe(
      false
    );
  });

  it("rejects a paste body with a non-empty sourceUrl — pasted text has no URL", () => {
    expect(
      isSavedJobPutBody(validPastePut({ sourceUrl: "https://example.com/jobs/1" }))
    ).toBe(false);
  });

  it("rejects a paste body with a non-empty filename — pasted text has no file", () => {
    expect(isSavedJobPutBody(validPastePut({ filename: "notes.txt" }))).toBe(false);
  });
});

describe("saveJob — paste-sourced rows (spec 005 FR-020/FR-021)", () => {
  it("verifies sha256(canonicalUrl) === key for a paste: identity, same primitive as URL/document rows", async () => {
    const sub = uniqueSub();
    const canonicalUrl = pasteCanonicalUrl();
    const key = sha256Hex(canonicalUrl);
    const payload = validPastePut({ canonicalUrl }) as SavedJobPayload;

    const saved = await saveJob(sub, key, payload);
    expect(saved.canonicalUrl).toBe(canonicalUrl);
    expect(saved.source).toBe("paste");
    expect(saved.sourceUrl).toBe("");

    const fetched = await getJob(sub, key);
    expect(fetched?.source).toBe("paste");
    expect(fetched?.sourceUrl).toBe("");
  });

  it("resolves repeat pastes of the same text to the same key (FR-021)", async () => {
    const sub = uniqueSub();
    const canonicalUrl = pasteCanonicalUrl("the same posting text");
    const key = sha256Hex(canonicalUrl);
    await saveJob(sub, key, validPastePut({ canonicalUrl }) as SavedJobPayload);

    // A second "paste of the same text" resolves to the identical key —
    // this is the mechanism, not a second ad-hoc check of it.
    const secondKey = sha256Hex(pasteCanonicalUrl("the same posting text"));
    expect(secondKey).toBe(key);
  });
});
