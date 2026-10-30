import { describe, it, expect } from "vitest";
import {
  decideRescoreCharge,
  type RescoreDecisionInput,
} from "../../src/services/rescoreEligibility";
import { FREE_RESCORES_PER_MONTH } from "../../src/models/user";

const CURRENT = "c".repeat(64);
const OLD = "0".repeat(64);
const OTHER = "1".repeat(64);

const fit = (profileFingerprint?: string) => ({
  score: 70,
  rationale: "r",
  ...(profileFingerprint ? { profileFingerprint } : {}),
});

const base: RescoreDecisionInput = {
  intent: { priorFingerprint: OLD },
  currentFingerprint: CURRENT,
  savedFit: undefined,
  fingerprintHistory: [OLD],
  rescoresUsed: 0,
};

/** research R6's eligibility rule, one row per case. */
const CASES: [string, Partial<RescoreDecisionInput>, "rescore" | "analysis"][] = [
  ["no rescore intent", { intent: undefined }, "analysis"],
  ["no profile sent", { currentFingerprint: undefined }, "analysis"],
  ["saved fit with no fingerprint (pre-006)", { savedFit: fit() }, "rescore"],
  ["saved fit with a different fingerprint", { savedFit: fit(OLD) }, "rescore"],
  [
    "saved fit with the current fingerprint, even if the claimed prior differs",
    { savedFit: fit(CURRENT), intent: { priorFingerprint: OLD } },
    "analysis",
  ],
  ["no saved row, claimed prior in history", {}, "rescore"],
  [
    "no saved row, claimed prior not in history",
    { intent: { priorFingerprint: OTHER } },
    "analysis",
  ],
  [
    "no saved row, claimed prior equals current",
    { intent: { priorFingerprint: CURRENT }, fingerprintHistory: [CURRENT] },
    "analysis",
  ],
  ["no saved row, null claimed prior", { intent: { priorFingerprint: null } }, "analysis"],
  [
    "eligible, but the free rescores are used up",
    { savedFit: fit(OLD), rescoresUsed: FREE_RESCORES_PER_MONTH },
    "analysis",
  ],
  [
    "eligible, over the cap",
    { savedFit: fit(OLD), rescoresUsed: FREE_RESCORES_PER_MONTH + 3 },
    "analysis",
  ],
  ["saved row whose fit is null (a first scoring)", { savedFit: null }, "analysis"],
  [
    "saved row's fingerprint wins over a claimed prior that is in history",
    { savedFit: fit(CURRENT), intent: { priorFingerprint: OLD }, fingerprintHistory: [OLD] },
    "analysis",
  ],
];

describe("decideRescoreCharge (research R6)", () => {
  it("allows 10 free rescores per month", () => {
    expect(FREE_RESCORES_PER_MONTH).toBe(10);
  });

  it.each(CASES)("%s", (_name, overrides, expected) => {
    expect(decideRescoreCharge({ ...base, ...overrides })).toBe(expected);
  });

  it("takes no tier input, so both tiers get the same decision (FR-026)", () => {
    // The input type has no tier field; this pins it so a tier-dependent
    // rule would need a deliberate contract change.
    const keys: (keyof RescoreDecisionInput)[] = [
      "intent",
      "currentFingerprint",
      "savedFit",
      "fingerprintHistory",
      "rescoresUsed",
    ];
    expect(Object.keys(base).sort()).toEqual([...keys].sort());
  });
});
