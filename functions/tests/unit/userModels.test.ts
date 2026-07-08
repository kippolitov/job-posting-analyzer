import { describe, it, expect } from "vitest";
import {
  isProfilePutBody,
  isSavedJobPatchBody,
  isSavedJobPutBody,
  NOTES_MAX,
} from "../../src/models/user";

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

const validPut = {
  schemaVersion: 1,
  canonicalUrl: "https://a.example/jobs/1",
  sourceUrl: "https://a.example/jobs/1",
  analysis: validAnalysis,
  status: "interested",
  notes: "",
  savedAt: "2026-07-04T12:01:00Z",
  updatedAt: "2026-07-04T12:01:00Z",
};

describe("isProfilePutBody", () => {
  it("accepts a valid body", () => {
    expect(isProfilePutBody({ text: "t", dealbreakers: ["a"] })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "nope"],
    ["missing text", { dealbreakers: [] }],
    ["non-string text", { text: 5, dealbreakers: [] }],
    ["missing dealbreakers", { text: "t" }],
    ["non-array dealbreakers", { text: "t", dealbreakers: "x" }],
    ["non-string dealbreaker items", { text: "t", dealbreakers: [1] }],
  ])("rejects %s", (_label, body) => {
    expect(isProfilePutBody(body)).toBe(false);
  });
});

describe("isSavedJobPutBody", () => {
  it("accepts a valid record", () => {
    expect(isSavedJobPutBody(validPut)).toBe(true);
  });

  it.each([
    ["null", null],
    ["missing schemaVersion", { ...validPut, schemaVersion: undefined }],
    ["non-URL canonicalUrl", { ...validPut, canonicalUrl: "not a url" }],
    ["ftp canonicalUrl", { ...validPut, canonicalUrl: "ftp://a.example/x" }],
    ["empty canonicalUrl", { ...validPut, canonicalUrl: "" }],
    ["missing sourceUrl", { ...validPut, sourceUrl: undefined }],
    ["missing analysis", { ...validPut, analysis: undefined }],
    ["analysis without model", { ...validPut, analysis: { ...validAnalysis, model: undefined } }],
    ["unknown status", { ...validPut, status: "daydreaming" }],
    ["non-string notes", { ...validPut, notes: 7 }],
    ["notes above the cap", { ...validPut, notes: "x".repeat(NOTES_MAX + 1) }],
    ["missing savedAt", { ...validPut, savedAt: undefined }],
    ["missing updatedAt", { ...validPut, updatedAt: undefined }],
  ])("rejects %s", (_label, body) => {
    expect(isSavedJobPutBody(body)).toBe(false);
  });
});

describe("isSavedJobPatchBody", () => {
  it("accepts partial patches of status, notes, and analysis", () => {
    expect(isSavedJobPatchBody({})).toBe(true);
    expect(isSavedJobPatchBody({ status: "applied" })).toBe(true);
    expect(isSavedJobPatchBody({ notes: "n" })).toBe(true);
    expect(isSavedJobPatchBody({ analysis: validAnalysis })).toBe(true);
    expect(
      isSavedJobPatchBody({ canonicalUrl: "https://a.example/1", savedAt: "t" })
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["unknown status", { status: "daydreaming" }],
    ["non-string notes", { notes: 7 }],
    ["notes above the cap", { notes: "x".repeat(NOTES_MAX + 1) }],
    ["malformed analysis", { analysis: { nope: true } }],
    ["non-string canonicalUrl", { canonicalUrl: 4 }],
    ["non-string savedAt", { savedAt: 4 }],
  ])("rejects %s", (_label, body) => {
    expect(isSavedJobPatchBody(body)).toBe(false);
  });
});
