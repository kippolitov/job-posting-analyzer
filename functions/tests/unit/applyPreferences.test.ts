import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyPreferences } from "../../src/services/applyPreferences";
import type { JobAnalysisPayload } from "../../../shared/types/job";
import type { Preferences } from "../../../shared/types/profile";

/** research R11's table: code checks arrangement, office days, salary and seniority only. */
const base = JSON.parse(
  readFileSync(
    path.join(__dirname, "..", "fixtures", "jobAnalysis", "explicit-hybrid.json"),
    "utf-8"
  )
) as JobAnalysisPayload;

function posting(overrides: Partial<JobAnalysisPayload>): JobAnalysisPayload {
  return {
    ...base,
    fit: {
      score: 77,
      rationale: "Solid overlap.",
      weaknesses: ["Model weakness"],
      dealbreakersViolated: [],
    },
    ...overrides,
  };
}

function run(overrides: Partial<JobAnalysisPayload>, preferences: Preferences | null | undefined) {
  const out = applyPreferences(posting(overrides), preferences);
  return {
    violated: out.fit?.dealbreakersViolated ?? [],
    weaknesses: out.fit?.weaknesses ?? [],
    score: out.fit?.score,
  };
}

const salary = (max: number | null, currency = "USD", period: "year" | "month" = "year") => ({
  min: null,
  max,
  currency,
  period,
});

describe("applyPreferences", () => {
  it("leaves the payload untouched with no preferences", () => {
    const payload = posting({ arrangement: "onsite" });
    for (const prefs of [undefined, null, {}]) {
      expect(applyPreferences(payload, prefs)).toEqual(payload);
    }
  });

  it("leaves a null fit alone", () => {
    const payload = posting({ fit: null });
    expect(applyPreferences(payload, { arrangements: ["remote"] })).toEqual(payload);
  });

  describe("arrangements", () => {
    const prefs: Preferences = { arrangements: ["remote"] };

    it("flags an on-site posting with explicit evidence and keeps the score", () => {
      const r = run({ arrangement: "onsite", arrangementConfidence: "explicit" }, prefs);
      expect(r.violated).toContain("Arrangement: remote only");
      expect(r.score).toBe(77);
    });

    it("flags an inferred arrangement too", () => {
      expect(
        run({ arrangement: "onsite", arrangementConfidence: "inferred" }, prefs).violated
      ).toContain("Arrangement: remote only");
    });

    it("gives an unverified note for an unspecified arrangement", () => {
      const r = run({ arrangement: "unspecified", arrangementConfidence: "none" }, prefs);
      expect(r.violated).toEqual([]);
      expect(r.weaknesses[0]).toBe("Unverified: arrangement not stated");
    });

    it("gives no violation when confidence is none", () => {
      expect(run({ arrangement: "onsite", arrangementConfidence: "none" }, prefs).violated).toEqual(
        []
      );
    });

    it("accepts an allowed arrangement", () => {
      expect(
        run({ arrangement: "hybrid", arrangementConfidence: "explicit" }, {
          arrangements: ["remote", "hybrid"],
        }).violated
      ).toEqual([]);
    });
  });

  describe("salary", () => {
    const prefs: Preferences = { minSalary: { amount: 120000, currency: "USD", period: "year" } };

    it("flags a maximum below the minimum", () => {
      const r = run({ salary: salary(100000) }, prefs);
      expect(r.violated).toContain("Minimum salary: 120000 USD per year");
    });

    it("falls back to min when there is no max", () => {
      const r = run({ salary: { min: 90000, max: null, currency: "USD", period: "year" } }, prefs);
      expect(r.violated).toContain("Minimum salary: 120000 USD per year");
    });

    it("does not flag a salary that meets the minimum", () => {
      expect(run({ salary: salary(150000) }, prefs).violated).toEqual([]);
    });

    it("is unverified for a different currency", () => {
      const r = run({ salary: salary(100000, "EUR") }, prefs);
      expect(r.violated).toEqual([]);
      expect(r.weaknesses[0]).toMatch(/^Unverified: salary/);
    });

    it("is unverified for a different pay period", () => {
      const r = run({ salary: salary(5000, "USD", "month") }, prefs);
      expect(r.violated).toEqual([]);
      expect(r.weaknesses[0]).toMatch(/^Unverified: salary/);
    });

    it("is unverified when the posting has no salary", () => {
      const r = run({ salary: null }, prefs);
      expect(r.violated).toEqual([]);
      expect(r.weaknesses[0]).toBe("Unverified: salary not stated");
    });
  });

  describe("seniority", () => {
    const prefs: Preferences = { seniority: { min: "senior", max: "staff" } };

    it("flags a level below the range", () => {
      expect(run({ seniority: "junior" }, prefs).violated).toContain("Seniority: senior to staff");
    });

    it("flags a level above the range", () => {
      expect(run({ seniority: "director" }, prefs).violated).toContain(
        "Seniority: senior to staff"
      );
    });

    it("accepts a level inside the range", () => {
      expect(run({ seniority: "staff" }, prefs).violated).toEqual([]);
    });

    it("is unverified when unspecified", () => {
      const r = run({ seniority: "unspecified" }, prefs);
      expect(r.violated).toEqual([]);
      expect(r.weaknesses[0]).toBe("Unverified: seniority not stated");
    });

    it("supports a min-only range", () => {
      expect(run({ seniority: "mid" }, { seniority: { min: "senior" } }).violated).toContain(
        "Seniority: senior or above"
      );
    });
  });

  describe("office days", () => {
    const prefs: Preferences = { maxOfficeDays: 2 };

    it("flags a hybrid posting stating more days", () => {
      const r = run({ arrangement: "hybrid", daysInOffice: 3 }, prefs);
      expect(r.violated).toContain("Office days: at most 2 per week");
      expect(r.score).toBe(77);
    });

    it("accepts a hybrid posting within the limit", () => {
      expect(run({ arrangement: "hybrid", daysInOffice: 2 }, prefs).violated).toEqual([]);
    });

    it("is unverified for hybrid with no days stated", () => {
      const r = run({ arrangement: "hybrid", daysInOffice: null }, prefs);
      expect(r.violated).toEqual([]);
      expect(r.weaknesses[0]).toBe("Unverified: office days not stated");
    });

    it("counts on-site as 5 days when confidence is explicit or inferred", () => {
      for (const arrangementConfidence of ["explicit", "inferred"] as const) {
        expect(
          run({ arrangement: "onsite", arrangementConfidence, daysInOffice: null }, prefs).violated
        ).toContain("Office days: at most 2 per week");
      }
    });

    it("does not count on-site with confidence none", () => {
      expect(
        run({ arrangement: "onsite", arrangementConfidence: "none" }, prefs).violated
      ).toEqual([]);
    });

    it("does not report an on-site posting twice when the arrangement check already did", () => {
      const r = run(
        { arrangement: "onsite", arrangementConfidence: "explicit" },
        { arrangements: ["remote"], maxOfficeDays: 2 }
      );
      expect(r.violated).toEqual(["Arrangement: remote only"]);
    });

    it("allows a limit of 5 for on-site", () => {
      expect(
        run({ arrangement: "onsite", arrangementConfidence: "explicit" }, { maxOfficeDays: 5 })
          .violated
      ).toEqual([]);
    });
  });

  describe("model-judged preferences", () => {
    it("never checks locations or sponsorship in code", () => {
      const r = run(
        { location: "New York" },
        { locations: ["EU timezones only"], needsSponsorship: true }
      );
      expect(r.violated).toEqual([]);
      expect(r.weaknesses).toEqual(["Model weakness"]);
    });

    it("keeps a violation the model already reported", () => {
      const payload = posting({});
      payload.fit!.dealbreakersViolated = ["Work authorization: needs visa sponsorship"];
      const out = applyPreferences(payload, { needsSponsorship: true });
      expect(out.fit!.dealbreakersViolated).toContain("Work authorization: needs visa sponsorship");
    });
  });

  it("merges with existing violations without duplicating", () => {
    const payload = posting({ arrangement: "onsite", arrangementConfidence: "explicit" });
    payload.fit!.dealbreakersViolated = ["Arrangement: remote only", "No crypto"];
    const out = applyPreferences(payload, { arrangements: ["remote"] });
    expect(out.fit!.dealbreakersViolated).toEqual(["Arrangement: remote only", "No crypto"]);
  });

  it("prepends unverified notes and caps weaknesses at 5", () => {
    const payload = posting({
      arrangement: "unspecified",
      arrangementConfidence: "none",
      salary: null,
      seniority: "unspecified",
    });
    payload.fit!.weaknesses = ["a", "b", "c", "d", "e"];
    const out = applyPreferences(payload, {
      arrangements: ["remote"],
      minSalary: { amount: 1, currency: "USD", period: "year" },
      seniority: { min: "senior" },
    });
    expect(out.fit!.weaknesses).toHaveLength(5);
    expect(out.fit!.weaknesses!.slice(0, 3).every((w) => w.startsWith("Unverified:"))).toBe(true);
  });
});
