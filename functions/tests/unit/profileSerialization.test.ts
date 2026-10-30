import { describe, it, expect } from "vitest";
import {
  dealbreakerLinesFromPrompt,
  profileToPromptText,
} from "../../../shared/types/profile";

/**
 * data-model.md §3 invariant: for `{text, dealbreakers}` the serialization is
 * byte-identical to the pre-006 implementation, so fingerprints stay stable
 * from PR2 to PR5. The expected strings are written out literally on purpose.
 */
const CASES: [string, { text: string; dealbreakers: string[] }, string][] = [
  ["no dealbreakers", { text: "Senior engineer", dealbreakers: [] }, "Senior engineer"],
  [
    "one dealbreaker",
    { text: "Senior engineer", dealbreakers: ["No fully on-site roles"] },
    "Senior engineer\n\nDealbreakers:\n- No fully on-site roles",
  ],
  [
    "several dealbreakers",
    { text: "Senior engineer", dealbreakers: ["Remote only", "No defense", "No crypto"] },
    "Senior engineer\n\nDealbreakers:\n- Remote only\n- No defense\n- No crypto",
  ],
  [
    "trailing whitespace in text",
    { text: "Senior engineer  \n\n", dealbreakers: ["Remote only"] },
    "Senior engineer  \n\n\n\nDealbreakers:\n- Remote only",
  ],
  [
    "unicode",
    { text: "Ingénieur — Zürich 🚀", dealbreakers: ["Pas de déplacements"] },
    "Ingénieur — Zürich 🚀\n\nDealbreakers:\n- Pas de déplacements",
  ],
];

describe("profileToPromptText invariant", () => {
  it.each(CASES)("%s is byte-identical to the pre-006 output", (_name, profile, expected) => {
    expect(profileToPromptText(profile)).toBe(expected);
  });
});

describe("dealbreakerLinesFromPrompt", () => {
  it.each(CASES)("round-trips the dealbreakers for %s", (_name, profile) => {
    expect(dealbreakerLinesFromPrompt(profileToPromptText(profile))).toEqual(
      profile.dealbreakers
    );
  });

  it("returns [] when there is no Dealbreakers section", () => {
    expect(dealbreakerLinesFromPrompt("Just a résumé\n- with a bullet")).toEqual([]);
    expect(dealbreakerLinesFromPrompt("")).toEqual([]);
  });

  it("stops at the next section heading", () => {
    const text = "CV\n\nDealbreakers:\n- Remote only\n\nPreferences:\n- Work arrangement: remote";
    expect(dealbreakerLinesFromPrompt(text)).toEqual(["Remote only"]);
  });
});

describe("Preferences section (PR4, data-model.md §3)", () => {
  const base = { text: "Senior engineer", dealbreakers: [] as string[] };

  it("renders each preference exactly as the data model shows", () => {
    expect(
      profileToPromptText({
        ...base,
        preferences: {
          arrangements: ["remote", "hybrid"],
          maxOfficeDays: 2,
          minSalary: { amount: 120000, currency: "USD", period: "year" },
          seniority: { min: "senior", max: "staff" },
          locations: ["EU timezones only"],
          needsSponsorship: true,
        },
      })
    ).toBe(
      [
        "Senior engineer",
        "",
        "Preferences:",
        "- Work arrangement: remote or hybrid",
        "- Office days: at most 2 per week",
        "- Minimum salary: 120000 USD per year",
        "- Seniority: senior to staff",
        "- Locations or timezones: EU timezones only",
        "- Work authorization: needs visa sponsorship",
      ].join("\n")
    );
  });

  it("puts Preferences after Dealbreakers", () => {
    expect(
      profileToPromptText({
        text: "CV",
        dealbreakers: ["No crypto"],
        preferences: { arrangements: ["remote"] },
      })
    ).toBe("CV\n\nDealbreakers:\n- No crypto\n\nPreferences:\n- Work arrangement: remote");
  });

  it("renders half-open seniority ranges and an office-day limit of 0", () => {
    const text = profileToPromptText({
      ...base,
      preferences: { seniority: { min: "senior" }, maxOfficeDays: 0 },
    });
    expect(text).toContain("- Office days: at most 0 per week");
    expect(text).toContain("- Seniority: senior or above");
    expect(
      profileToPromptText({ ...base, preferences: { seniority: { max: "mid" } } })
    ).toContain("- Seniority: mid or below");
  });

  it("is omitted when preferences are absent, null or empty", () => {
    for (const preferences of [undefined, null, {}]) {
      expect(profileToPromptText({ ...base, preferences })).toBe("Senior engineer");
    }
  });

  it("lists multiple locations with semicolons", () => {
    expect(
      profileToPromptText({ ...base, preferences: { locations: ["Berlin", "EU timezones"] } })
    ).toContain("- Locations or timezones: Berlin; EU timezones");
  });
});

describe("Confirmed skills section (PR5)", () => {
  const base = { text: "Senior engineer", dealbreakers: ["Remote only"] };

  it("renders after Dealbreakers when there are no preferences", () => {
    expect(profileToPromptText({ ...base, confirmedSkills: ["Terraform", "Kubernetes"] })).toBe(
      "Senior engineer\n\nDealbreakers:\n- Remote only\n\nConfirmed skills:\n- Terraform\n- Kubernetes"
    );
  });

  it("renders after Preferences", () => {
    expect(
      profileToPromptText({
        ...base,
        preferences: { maxOfficeDays: 2 },
        confirmedSkills: ["Terraform"],
      })
    ).toBe(
      "Senior engineer\n\nDealbreakers:\n- Remote only\n\nPreferences:\n- Office days: at most 2 per week\n\nConfirmed skills:\n- Terraform"
    );
  });

  it("is omitted when empty or undefined", () => {
    expect(profileToPromptText({ ...base, confirmedSkills: [] })).toBe(profileToPromptText(base));
  });

  it("does not disturb the dealbreaker inverse", () => {
    const text = profileToPromptText({ ...base, confirmedSkills: ["Terraform"] });
    expect(dealbreakerLinesFromPrompt(text)).toEqual(["Remote only"]);
  });
});
