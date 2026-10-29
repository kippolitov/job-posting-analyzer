import type { Fit } from "./types/job";
import type { NormalizedFit } from "./fitView";

/**
 * Shared test table for `shared/fitView.ts` (contracts/fit-view.md, research
 * R10). Both `extension/tests/unit/fitView.test.ts` and
 * `web/tests/unit/fitView.test.ts` iterate these cases, so a divergence in
 * either client's build fails that client's CI (FR-023).
 */

const FINGERPRINT = "a".repeat(64);

export const NORMALIZE_CASES: [string, Fit | null | undefined, NormalizedFit | null][] = [
  ["null", null, null],
  ["undefined", undefined, null],
  [
    "pre-breakdown fit (score and rationale only)",
    { score: 55, rationale: "Partial overlap." },
    {
      score: 55,
      rationale: "Partial overlap.",
      matching: [],
      missing: [],
      desired: [],
      strengths: [],
      weaknesses: [],
      dealbreakersViolated: [],
      evidence: {},
      profileFingerprint: undefined,
    },
  ],
  [
    "005-era fit with string arrays and no new fields",
    {
      score: 72,
      rationale: "Good overlap.",
      matching: ["TypeScript"],
      missing: ["Kubernetes"],
      desired: ["Go"],
      strengths: ["Remote"],
      weaknesses: ["Long hours"],
    },
    {
      score: 72,
      rationale: "Good overlap.",
      matching: ["TypeScript"],
      missing: ["Kubernetes"],
      desired: ["Go"],
      strengths: ["Remote"],
      weaknesses: ["Long hours"],
      dealbreakersViolated: [],
      evidence: {},
      profileFingerprint: undefined,
    },
  ],
  [
    "fully populated PR2 fit",
    {
      score: 88,
      rationale: "Strong overlap, but on-site.",
      matching: ["TypeScript", "Azure"],
      missing: [],
      desired: ["Rust"],
      strengths: ["Senior scope"],
      weaknesses: [],
      dealbreakersViolated: ["No fully on-site roles"],
      profileFingerprint: FINGERPRINT,
    },
    {
      score: 88,
      rationale: "Strong overlap, but on-site.",
      matching: ["TypeScript", "Azure"],
      missing: [],
      desired: ["Rust"],
      strengths: ["Senior scope"],
      weaknesses: [],
      dealbreakersViolated: ["No fully on-site roles"],
      evidence: {},
      profileFingerprint: FINGERPRINT,
    },
  ],
];
