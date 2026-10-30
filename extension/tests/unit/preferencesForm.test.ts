import { describe, it, expect } from "vitest";
import {
  emptyPreferencesForm,
  formFromPreferences,
  preferencesFromForm,
} from "../../../shared/preferencesForm";
import { toScoringProfile } from "../../../shared/types/profile";

/** Pure form <-> Preferences mapping shared by the options page and the web Profile page (PR4). */
describe("preferencesForm", () => {
  it("maps an empty form to null preferences", () => {
    expect(preferencesFromForm(emptyPreferencesForm())).toEqual({ preferences: null });
  });

  it("round-trips every preference", () => {
    const preferences = {
      arrangements: ["remote", "hybrid"] as ("remote" | "hybrid")[],
      maxOfficeDays: 2,
      minSalary: { amount: 120000, currency: "USD", period: "year" as const },
      seniority: { min: "senior" as const, max: "staff" as const },
      locations: ["EU timezones only", "Berlin"],
      needsSponsorship: true as const,
    };
    expect(preferencesFromForm(formFromPreferences(preferences))).toEqual({ preferences });
  });

  it("keeps an office-day limit of 0 and treats the empty choice as no limit", () => {
    expect(
      preferencesFromForm({ ...emptyPreferencesForm(), maxOfficeDays: "0" }).preferences
    ).toEqual({ maxOfficeDays: 0 });
    expect(preferencesFromForm({ ...emptyPreferencesForm(), maxOfficeDays: "" }).preferences).toBe(
      null
    );
  });

  it("trims locations and drops blank lines", () => {
    const form = { ...emptyPreferencesForm(), locations: " Berlin \n\n  \nEU only" };
    expect(preferencesFromForm(form).preferences).toEqual({ locations: ["Berlin", "EU only"] });
  });

  it("uppercases the currency", () => {
    const form = {
      ...emptyPreferencesForm(),
      salaryAmount: "90000",
      salaryCurrency: "eur",
      salaryPeriod: "year" as const,
    };
    expect(preferencesFromForm(form).preferences?.minSalary?.currency).toBe("EUR");
  });

  it.each([
    ["a non-numeric salary", { salaryAmount: "lots" }],
    ["a zero salary", { salaryAmount: "0" }],
    ["a bad currency", { salaryAmount: "10", salaryCurrency: "dollars" }],
    ["min seniority above max", { seniorityMin: "staff", seniorityMax: "junior" }],
  ])("reports an error for %s", (_name, patch) => {
    const result = preferencesFromForm({ ...emptyPreferencesForm(), ...patch });
    expect(result.error).toBeTruthy();
    expect(result.preferences).toBeUndefined();
  });

  it("ignores a currency typed without an amount", () => {
    expect(
      preferencesFromForm({ ...emptyPreferencesForm(), salaryCurrency: "EUR" }).preferences
    ).toBe(null);
  });
});

describe("toScoringProfile", () => {
  it("carries preferences and omits the server's other fields", () => {
    const profile = {
      text: "CV",
      dealbreakers: ["No crypto"],
      updatedAt: "2026-01-01T00:00:00.000Z",
      fingerprint: "f".repeat(64),
      preferences: { arrangements: ["remote" as const] },
    };
    expect(toScoringProfile(profile)).toEqual({
      text: "CV",
      dealbreakers: ["No crypto"],
      preferences: { arrangements: ["remote"] },
    });
  });

  it("omits preferences when there are none", () => {
    expect(Object.keys(toScoringProfile({ text: "CV", dealbreakers: [] }))).toEqual([
      "text",
      "dealbreakers",
    ]);
  });
});
