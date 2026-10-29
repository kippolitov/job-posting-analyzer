import type { Fit } from "./types/job";
import type {
  Freshness,
  NormalizedFit,
  Verdict,
  RescoreAction,
  RescoreCostUsage,
  RescoreJob,
  RescoreSurface,
} from "./fitView";

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

const CURRENT = "c".repeat(64);
const OLDER = "0".repeat(64);
const fitWith = (profileFingerprint?: string): Fit => ({
  score: 70,
  rationale: "r",
  ...(profileFingerprint ? { profileFingerprint } : {}),
});

/** data-model.md §2 freshness table: [name, fit, current fingerprint, expected]. */
export const FRESHNESS_CASES: [string, Fit | null, string | null | undefined, Freshness][] = [
  ["current fingerprint not yet known", fitWith(CURRENT), undefined, "unknown"],
  ["version-unknown fit, current not known", fitWith(), undefined, "unknown"],
  ["no fingerprint on the fit, profile exists", fitWith(), CURRENT, "version-unknown"],
  ["no fingerprint on the fit, no profile", fitWith(), null, "version-unknown"],
  ["fingerprinted fit, profile deleted", fitWith(CURRENT), null, "profile-deleted"],
  ["same fingerprint", fitWith(CURRENT), CURRENT, "current"],
  ["different fingerprint", fitWith(OLDER), CURRENT, "out-of-date"],
  ["null fit has no marker", null, CURRENT, "unknown"],
];

const KEY = "k".repeat(64);
const urlJob = { source: "url" as const, sourceUrl: "https://jobs.example.com/1", saveKey: KEY };
const docJob = { source: "document" as const, sourceUrl: "", saveKey: KEY };
const pasteJob = { source: "paste" as const, sourceUrl: "", saveKey: KEY };
const NONE: RescoreAction = { kind: "none" };

/** research R7's rescore-path table: [name, job, freshness, surface, expected]. */
export const RESCORE_ACTION_CASES: [
  string,
  RescoreJob,
  Freshness,
  RescoreSurface,
  RescoreAction,
][] = [
  ["current fit needs nothing", urlJob, "current", "list", NONE],
  ["unknown freshness needs nothing", urlJob, "unknown", "panel", NONE],
  ["a deleted profile has nothing to rescore against", urlJob, "profile-deleted", "list", NONE],
  [
    "out-of-date URL posting on the posting's own page",
    urlJob,
    "out-of-date",
    "panel",
    { kind: "rescore-here", label: "Rescore" },
  ],
  [
    "version-unknown URL posting on the posting's own page",
    urlJob,
    "version-unknown",
    "panel",
    { kind: "rescore-here", label: "Rescore" },
  ],
  [
    "out-of-date URL posting in a list",
    urlJob,
    "out-of-date",
    "list",
    { kind: "open-posting", label: "Open posting to rescore", href: urlJob.sourceUrl },
  ],
  [
    "legacy URL row without a source field",
    { sourceUrl: urlJob.sourceUrl, saveKey: KEY },
    "out-of-date",
    "list",
    { kind: "open-posting", label: "Open posting to rescore", href: urlJob.sourceUrl },
  ],
  [
    "a taken-down URL posting still offers the page, which may come back",
    { ...urlJob, unavailableAt: "2026-10-29T10:00:00.000Z" },
    "out-of-date",
    "list",
    { kind: "open-posting", label: "Open posting to rescore", href: urlJob.sourceUrl },
  ],
  [
    "out-of-date document posting",
    docJob,
    "out-of-date",
    "list",
    { kind: "upload-again", label: "Upload again to rescore", href: `/upload?rescore=${KEY}` },
  ],
  [
    "out-of-date document posting seen from the extension",
    docJob,
    "version-unknown",
    "panel",
    { kind: "upload-again", label: "Upload again to rescore", href: `/upload?rescore=${KEY}` },
  ],
  [
    "out-of-date paste posting in a list",
    pasteJob,
    "out-of-date",
    "list",
    {
      kind: "paste-again",
      label: "Paste again to rescore",
      href: `/upload?mode=paste&rescore=${KEY}`,
    },
  ],
  [
    "out-of-date paste posting in the panel reads the same",
    pasteJob,
    "out-of-date",
    "panel",
    {
      kind: "paste-again",
      label: "Paste again to rescore",
      href: `/upload?mode=paste&rescore=${KEY}`,
    },
  ],
];

/** FR-004a cost line: [name, usage, expected]. */
export const COST_LINE_CASES: [string, RescoreCostUsage, string][] = [
  [
    "free rescores left",
    { rescoresUsed: 3, rescoresLimit: 10, count: 12, limit: 50 },
    "Free — 7 of 10 free rescores left this month",
  ],
  [
    "free rescores left even with the allowance used up",
    { rescoresUsed: 9, rescoresLimit: 10, count: 50, limit: 50 },
    "Free — 1 of 10 free rescores left this month",
  ],
  [
    "no free rescores, allowance left",
    { rescoresUsed: 10, rescoresLimit: 10, count: 12, limit: 50 },
    "Uses 1 analysis",
  ],
  [
    "both used up",
    { rescoresUsed: 10, rescoresLimit: 10, count: 50, limit: 50 },
    "No free rescores or analyses left this month",
  ],
];

const verdictFit = (
  score: number,
  extra: Partial<Fit> = {},
  fingerprint: string | null = FINGERPRINT
): Fit => ({
  score,
  rationale: "r",
  ...(fingerprint ? { profileFingerprint: fingerprint } : {}),
  ...extra,
});

/** FR-009 mapping: [name, fit, expected verdict, expected aria label]. */
export const VERDICT_CASES: [string, Fit, Verdict, string][] = [
  ["0 is a long shot", verdictFit(0), "long-shot", "Long shot, fit 0 out of 100"],
  ["39 is a long shot", verdictFit(39), "long-shot", "Long shot, fit 39 out of 100"],
  ["40 is a stretch", verdictFit(40), "stretch", "Stretch, fit 40 out of 100"],
  ["64 is a stretch", verdictFit(64), "stretch", "Stretch, fit 64 out of 100"],
  ["65 is worth a shot", verdictFit(65), "worth-a-shot", "Worth a shot, fit 65 out of 100"],
  ["84 is worth a shot", verdictFit(84), "worth-a-shot", "Worth a shot, fit 84 out of 100"],
  ["85 is a strong match", verdictFit(85), "strong", "Strong match, fit 85 out of 100"],
  ["86 reads as in the contract", verdictFit(86), "strong", "Strong match, fit 86 out of 100"],
  ["100 is a strong match", verdictFit(100), "strong", "Strong match, fit 100 out of 100"],
  [
    "a dealbreaker overrides a score of 95",
    verdictFit(95, { dealbreakersViolated: ["No fully on-site roles"] }),
    "dealbreaker",
    "Dealbreaker, fit 95 out of 100",
  ],
  [
    "no fingerprint is unrated, whatever the score",
    verdictFit(72, {}, null),
    "unrated",
    "Unrated, fit 72 out of 100",
  ],
  [
    "no fingerprint wins over a dealbreaker",
    verdictFit(72, { dealbreakersViolated: ["x"] }, null),
    "unrated",
    "Unrated, fit 72 out of 100",
  ],
];

/** The exact user-facing copy for every verdict (spec vocabulary table). */
export const VERDICT_LABELS: [Verdict, string][] = [
  ["strong", "Strong match"],
  ["worth-a-shot", "Worth a shot"],
  ["stretch", "Stretch"],
  ["long-shot", "Long shot"],
  ["dealbreaker", "Dealbreaker"],
  ["unrated", "Unrated — rescore for a verdict"],
];

/** FR-025: the default view's missing items. */
export const PREVIEW_MISSING_CASES: [string, Fit, string[]][] = [
  ["fewer than three", verdictFit(50, { missing: ["a", "b"] }), ["a", "b"]],
  ["more than three keeps the first three", verdictFit(50, { missing: ["a", "b", "c", "d"] }), ["a", "b", "c"]],
  ["a legacy fit without the list", { score: 50, rationale: "r" }, []],
];

/** Which model or tier scored this: [name, analysis, expected]. */
export const SCORED_BY_CASES: [string, { tier?: "free" | "premium"; model: string }, string][] = [
  ["premium", { tier: "premium", model: "gpt-6-luna-premium" }, "Scored on Premium"],
  ["free", { tier: "free", model: "gpt-6-luna" }, "Scored on Free"],
  ["analysis saved before tier was recorded", { model: "gpt-4o-mini" }, "Scored by gpt-4o-mini"],
];
