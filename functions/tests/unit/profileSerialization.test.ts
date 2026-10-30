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
