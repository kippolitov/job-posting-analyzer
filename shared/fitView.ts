import type { EvidenceItem, Fit, FitEvidence } from "./types/job";

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
  return {
    score: fit.score,
    rationale: fit.rationale,
    matching: fit.matching ?? [],
    missing: fit.missing ?? [],
    desired: fit.desired ?? [],
    strengths: fit.strengths ?? [],
    weaknesses: fit.weaknesses ?? [],
    dealbreakersViolated: fit.dealbreakersViolated ?? [],
    evidence: fit.evidence ?? {},
    profileFingerprint: fit.profileFingerprint,
  };
}

/** PR3: the quotes behind one chip, or `null` for a legacy fit or an unknown label. */
export function evidenceFor(
  fit: Fit | null | undefined,
  list: keyof FitEvidence,
  label: string
): EvidenceItem | null {
  return fit?.evidence?.[list]?.find((item) => item.label === label) ?? null;
}

/**
 * data-model.md §2: compares the fingerprint a fit was scored against with
 * the current profile's. `current` is `undefined` while not yet known and
 * `null` when the account has no profile.
 */
export function freshness(
  fit: Fit | null | undefined,
  current: string | null | undefined
): Freshness {
  if (!fit || current === undefined) return "unknown";
  const scored = fit.profileFingerprint;
  if (!scored) return "version-unknown";
  if (current === null) return "profile-deleted";
  return scored === current ? "current" : "out-of-date";
}

/** "panel" is the extension panel on the posting's own page. */
export type RescoreSurface = "panel" | "list";

export interface RescoreJob {
  source?: "url" | "document" | "paste";
  sourceUrl: string;
  saveKey: string;
  unavailableAt?: string | null;
}

export type RescoreAction =
  | { kind: "none" }
  | { kind: "rescore-here"; label: "Rescore" }
  | {
      kind: "open-posting" | "upload-again" | "paste-again";
      label: string;
      href: string;
    };

/** Research R7's rescore-path table. */
export function rescoreAction(
  job: RescoreJob,
  fresh: Freshness,
  surface: RescoreSurface
): RescoreAction {
  if (fresh !== "out-of-date" && fresh !== "version-unknown") {
    return { kind: "none" };
  }
  if (job.source === "document") {
    return {
      kind: "upload-again",
      label: "Upload again to rescore",
      href: `/upload?rescore=${job.saveKey}`,
    };
  }
  if (job.source === "paste") {
    return {
      kind: "paste-again",
      label: "Paste again to rescore",
      href: `/upload?mode=paste&rescore=${job.saveKey}`,
    };
  }
  if (surface === "panel") return { kind: "rescore-here", label: "Rescore" };
  return {
    kind: "open-posting",
    label: "Open posting to rescore",
    href: job.sourceUrl,
  };
}

export interface RescoreCostUsage {
  rescoresUsed: number;
  rescoresLimit: number;
  count: number;
  limit: number;
}

/** FR-004a: what a rescore will cost the user right now. */
export function rescoreCostLine(usage: RescoreCostUsage): string {
  const left = usage.rescoresLimit - usage.rescoresUsed;
  if (left > 0) {
    return `Free — ${left} of ${usage.rescoresLimit} free rescores left this month`;
  }
  if (usage.count < usage.limit) return "Uses 1 analysis";
  return "No free rescores or analyses left this month";
}

const VERDICT_LABELS: Record<Verdict, string> = {
  strong: "Strong match",
  "worth-a-shot": "Worth a shot",
  stretch: "Stretch",
  "long-shot": "Long shot",
  dealbreaker: "Dealbreaker",
  unrated: "Unrated — rescore for a verdict",
};

/** FR-009: score plus violations to a verdict; a fit with no recorded profile version has none. */
export function verdictFor(fit: NormalizedFit): Verdict {
  if (!fit.profileFingerprint) return "unrated";
  if (fit.dealbreakersViolated.length > 0) return "dealbreaker";
  if (fit.score >= 85) return "strong";
  if (fit.score >= 65) return "worth-a-shot";
  if (fit.score >= 40) return "stretch";
  return "long-shot";
}

/** The exact user-facing copy for a verdict. */
export function verdictLabel(verdict: Verdict): string {
  return VERDICT_LABELS[verdict];
}

/** Clients map this to colour and icon; the text label is always shown too (FR-010). */
export function scoreTone(fit: NormalizedFit): Verdict {
  return verdictFor(fit);
}

/** Accessible name for the score: the verdict word, not the "Unrated — …" prompt. */
export function ariaFitLabel(fit: Fit | NormalizedFit): string {
  const normalized = normalizeFit(fit)!;
  const verdict = verdictFor(normalized);
  const word = verdict === "unrated" ? "Unrated" : VERDICT_LABELS[verdict];
  return `${word}, fit ${normalized.score} out of 100`;
}

/** Which tier (or, for older analyses, model) produced the score; never affects freshness. */
export function scoredByLabel(analysis: {
  tier?: "free" | "premium";
  model: string;
}): string {
  if (analysis.tier === "premium") return "Scored on Premium";
  if (analysis.tier === "free") return "Scored on Free";
  return `Scored by ${analysis.model}`;
}

/** FR-025: the missing items the default view shows. */
export function previewMissing(fit: Fit | NormalizedFit, n = 3): string[] {
  return (fit.missing ?? []).slice(0, n);
}
