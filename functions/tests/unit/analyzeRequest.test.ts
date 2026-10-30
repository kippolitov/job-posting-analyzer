import { describe, it, expect } from "vitest";
import { isAnalyzeJobRequest } from "../../src/models/job";
import { resolveScoringProfile } from "../../src/services/profileFingerprint";
import { profileToPromptText } from "../../../shared/types/profile";

const extract = {
  url: "https://example.com/job",
  canonicalUrl: "https://example.com/job",
  title: "Engineer",
  jsonLd: [],
  mainText: "We are hiring.",
  extractedAt: "2026-10-29T00:00:00.000Z",
};

describe("isAnalyzeJobRequest — 006 additions (contracts/analyze-api.md §1)", () => {
  it("accepts a legacy body without the new fields", () => {
    expect(isAnalyzeJobRequest({ extract, profile: "CV" })).toBe(true);
    expect(isAnalyzeJobRequest({ extract })).toBe(true);
  });

  it("accepts a body with valid profileData and rescore", () => {
    expect(
      isAnalyzeJobRequest({
        extract,
        profile: "CV",
        profileData: { text: "CV", dealbreakers: ["Remote only"] },
        rescore: { priorFingerprint: "a".repeat(64) },
      })
    ).toBe(true);
    expect(isAnalyzeJobRequest({ extract, rescore: { priorFingerprint: null } })).toBe(true);
  });

  it("rejects malformed profileData", () => {
    expect(isAnalyzeJobRequest({ extract, profileData: { text: 1, dealbreakers: [] } })).toBe(
      false
    );
    expect(
      isAnalyzeJobRequest({ extract, profileData: { text: "CV", dealbreakers: "Remote" } })
    ).toBe(false);
    expect(
      isAnalyzeJobRequest({ extract, profileData: { text: "CV", dealbreakers: [1] } })
    ).toBe(false);
    expect(isAnalyzeJobRequest({ extract, profileData: "CV" })).toBe(false);
  });

  it("rejects a malformed rescore.priorFingerprint", () => {
    expect(isAnalyzeJobRequest({ extract, rescore: { priorFingerprint: "abc" } })).toBe(false);
    expect(
      isAnalyzeJobRequest({ extract, rescore: { priorFingerprint: "A".repeat(64) } })
    ).toBe(false);
    expect(isAnalyzeJobRequest({ extract, rescore: {} })).toBe(false);
    expect(isAnalyzeJobRequest({ extract, rescore: true })).toBe(false);
  });
});

describe("resolveScoringProfile", () => {
  const profileData = { text: "CV", dealbreakers: ["Remote only"] };

  it("serializes profileData and ignores the legacy string", () => {
    expect(resolveScoringProfile({ profileData, profile: "stale string" })).toBe(
      profileToPromptText(profileData)
    );
  });

  it("falls back to the legacy profile string", () => {
    expect(resolveScoringProfile({ profile: "CV only" })).toBe("CV only");
    expect(resolveScoringProfile({})).toBeUndefined();
  });
});
