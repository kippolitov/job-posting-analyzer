import { describe, it, expect } from "vitest";
import {
  isProfilePutBody,
  isSavedJobPatchBody,
  isSavedJobPutBody,
  NOTES_MAX,
  isTier,
  MONTHLY_ANALYSES,
  SAVED_JOBS_CAP,
  isUserEntity,
  isUsageEntity,
  isPaddleEventEntity,
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

describe("isTier", () => {
  it("accepts the two known tiers", () => {
    expect(isTier("free")).toBe(true);
    expect(isTier("premium")).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["unknown tier value", "gold"],
    ["number", 1],
  ])("rejects %s", (_label, value) => {
    expect(isTier(value)).toBe(false);
  });
});

describe("per-tier entitlement constants", () => {
  it("MONTHLY_ANALYSES is 50 for free and 300 for premium", () => {
    expect(MONTHLY_ANALYSES.free).toBe(50);
    expect(MONTHLY_ANALYSES.premium).toBe(300);
  });

  it("SAVED_JOBS_CAP is 100 for free and 1000 for premium", () => {
    expect(SAVED_JOBS_CAP.free).toBe(100);
    expect(SAVED_JOBS_CAP.premium).toBe(1000);
  });
});

const validUserEntity = {
  partitionKey: "User",
  rowKey: "user@example.com",
  sub: "sub-123",
  tier: "free",
  createdAt: "2026-07-04T12:00:00Z",
};

describe("isUserEntity", () => {
  it("accepts a minimal valid row", () => {
    expect(isUserEntity(validUserEntity)).toBe(true);
  });

  it("accepts a row carrying optional subscription/display fields", () => {
    expect(
      isUserEntity({
        ...validUserEntity,
        tier: "premium",
        blocked: false,
        migratedFromAllowlist: true,
        paddleCustomerId: "ctm_1",
        paddleSubscriptionId: "sub_1",
        subscriptionStatus: "active",
        renewsAt: "2026-08-01T00:00:00Z",
        endsAt: undefined,
        paddleEventOccurredAt: "2026-07-04T12:00:00Z",
      })
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["wrong partitionKey", { ...validUserEntity, partitionKey: "Nope" }],
    ["non-string rowKey", { ...validUserEntity, rowKey: 4 }],
    ["unknown tier", { ...validUserEntity, tier: "gold" }],
    ["missing tier", { ...validUserEntity, tier: undefined }],
    ["missing createdAt", { ...validUserEntity, createdAt: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(isUserEntity(value)).toBe(false);
  });
});

const validUsageEntity = {
  partitionKey: "sub-123",
  rowKey: "usage-2026-07",
  count: 1,
  limit: 50,
};

describe("isUsageEntity", () => {
  it("accepts a valid row", () => {
    expect(isUsageEntity(validUsageEntity)).toBe(true);
  });

  it.each([
    ["null", null],
    ["non-string partitionKey", { ...validUsageEntity, partitionKey: 1 }],
    ["non-string rowKey", { ...validUsageEntity, rowKey: 1 }],
    ["non-number count", { ...validUsageEntity, count: "1" }],
    ["non-number limit", { ...validUsageEntity, limit: "50" }],
  ])("rejects %s", (_label, value) => {
    expect(isUsageEntity(value)).toBe(false);
  });
});

const validPaddleEventEntity = {
  partitionKey: "PaddleEvent",
  rowKey: "evt_123",
  eventType: "subscription.activated",
  occurredAt: "2026-07-04T12:00:00Z",
  processedAt: "2026-07-04T12:00:01Z",
};

describe("isPaddleEventEntity", () => {
  it("accepts a valid row, with or without the optional sub", () => {
    expect(isPaddleEventEntity(validPaddleEventEntity)).toBe(true);
    expect(isPaddleEventEntity({ ...validPaddleEventEntity, sub: "sub-123" })).toBe(
      true
    );
  });

  it.each([
    ["null", null],
    ["wrong partitionKey", { ...validPaddleEventEntity, partitionKey: "Nope" }],
    ["non-string rowKey", { ...validPaddleEventEntity, rowKey: 4 }],
    ["missing eventType", { ...validPaddleEventEntity, eventType: undefined }],
    ["missing occurredAt", { ...validPaddleEventEntity, occurredAt: undefined }],
    ["missing processedAt", { ...validPaddleEventEntity, processedAt: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(isPaddleEventEntity(value)).toBe(false);
  });
});
