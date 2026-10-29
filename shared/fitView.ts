import type { Fit, FitEvidence } from "./types/job";

/**
 * The single source of fit display logic (contracts/fit-view.md, research
 * R10). Pure and framework-free: no DOM, `chrome.*` or `fetch`, so both
 * extension/ and web/ import it. Tailwind classes stay in each client; this
 * module returns semantic values only.
 */

export type Verdict =
  | "strong"
  | "worth-a-shot"
  | "stretch"
  | "long-shot"
  | "dealbreaker"
  | "unrated";

export type Freshness =
  | "current"
  | "out-of-date"
  | "version-unknown"
  | "profile-deleted"
  | "unknown";

/** A Fit with every list present, so surfaces never branch on legacy shapes. */
export interface NormalizedFit {
  score: number;
  rationale: string;
  matching: string[];
  missing: string[];
  desired: string[];
  strengths: string[];
  weaknesses: string[];
  dealbreakersViolated: string[];
  evidence: FitEvidence;
  /** Absent means version-unknown (data-model.md §2). */
  profileFingerprint: string | undefined;
}

/** Never throws on legacy input: pre-breakdown and 005-era fits both normalize. */
export function normalizeFit(fit: Fit | null | undefined): NormalizedFit | null {
  if (!fit) return null;
  const evidence = (fit as Fit & { evidence?: FitEvidence }).evidence;
  return {
    score: fit.score,
    rationale: fit.rationale,
    matching: fit.matching ?? [],
    missing: fit.missing ?? [],
    desired: fit.desired ?? [],
    strengths: fit.strengths ?? [],
    weaknesses: fit.weaknesses ?? [],
    dealbreakersViolated: fit.dealbreakersViolated ?? [],
    evidence: evidence ?? {},
    profileFingerprint: fit.profileFingerprint,
  };
}
