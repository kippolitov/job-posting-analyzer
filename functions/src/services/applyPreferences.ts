import type { JobAnalysisPayload } from "../../../shared/types/job";
import {
  PREFERENCE_SENIORITIES,
  seniorityRangeLabel,
  type Preferences,
} from "../../../shared/types/profile";

/**
 * Deterministic preference checks (research R11, FR-016): arrangement, office
 * days, salary and seniority. Locations and visa sponsorship are judged by the
 * model and reach the banner through the dealbreaker judge, so they are never
 * checked here. A violation needs a stated fact: an unstated one becomes an
 * "Unverified: …" weakness instead. Never reads or writes `score` (FR-005).
 */

const WEAKNESSES_MAX = 5;

export function applyPreferences(
  payload: JobAnalysisPayload,
  preferences: Preferences | null | undefined
): JobAnalysisPayload {
  if (!preferences || !payload.fit) return payload;

  const violations: string[] = [];
  const unverified: string[] = [];

  const arrangementViolated = checkArrangement(payload, preferences, violations, unverified);
  checkOfficeDays(payload, preferences, arrangementViolated, violations, unverified);
  checkSalary(payload, preferences, violations, unverified);
  checkSeniority(payload, preferences, violations, unverified);

  if (violations.length === 0 && unverified.length === 0) return payload;

  const existing = payload.fit.dealbreakersViolated ?? [];
  const dealbreakersViolated = [
    ...existing,
    ...violations.filter((v) => !existing.includes(v)),
  ];
  const weaknesses = [...unverified, ...(payload.fit.weaknesses ?? [])].slice(0, WEAKNESSES_MAX);
  return { ...payload, fit: { ...payload.fit, dealbreakersViolated, weaknesses } };
}

function checkArrangement(
  payload: JobAnalysisPayload,
  { arrangements }: Preferences,
  violations: string[],
  unverified: string[]
): boolean {
  if (!arrangements?.length) return false;
  if (payload.arrangement === "unspecified") {
    unverified.push("Unverified: arrangement not stated");
    return false;
  }
  if (
    !arrangements.includes(payload.arrangement) &&
    payload.arrangementConfidence !== "none"
  ) {
    violations.push(`Arrangement: ${arrangements.join(" or ")} only`);
    return true;
  }
  return false;
}

function checkOfficeDays(
  payload: JobAnalysisPayload,
  { maxOfficeDays }: Preferences,
  arrangementViolated: boolean,
  violations: string[],
  unverified: string[]
): void {
  if (maxOfficeDays === undefined) return;
  let days: number | null = null;
  if (payload.arrangement === "hybrid") {
    days = payload.daysInOffice;
    if (days === null) {
      unverified.push("Unverified: office days not stated");
      return;
    }
  } else if (payload.arrangement === "onsite" && payload.arrangementConfidence !== "none") {
    if (arrangementViolated) return;
    days = 5;
  }
  if (days !== null && days > maxOfficeDays) {
    violations.push(`Office days: at most ${maxOfficeDays} per week`);
  }
}

function checkSalary(
  payload: JobAnalysisPayload,
  { minSalary }: Preferences,
  violations: string[],
  unverified: string[]
): void {
  if (!minSalary) return;
  const posted = payload.salary;
  const top = posted ? (posted.max ?? posted.min) : null;
  if (!posted || top === null) {
    unverified.push("Unverified: salary not stated");
    return;
  }
  if (posted.currency !== minSalary.currency || posted.period !== minSalary.period) {
    unverified.push("Unverified: salary currency or period differs from your minimum");
    return;
  }
  if (top < minSalary.amount) {
    violations.push(`Minimum salary: ${minSalary.amount} ${minSalary.currency} per ${minSalary.period}`);
  }
}

function checkSeniority(
  payload: JobAnalysisPayload,
  { seniority }: Preferences,
  violations: string[],
  unverified: string[]
): void {
  if (!seniority || (!seniority.min && !seniority.max)) return;
  if (payload.seniority === "unspecified") {
    unverified.push("Unverified: seniority not stated");
    return;
  }
  const rank = PREFERENCE_SENIORITIES.indexOf(payload.seniority);
  const below = seniority.min && rank < PREFERENCE_SENIORITIES.indexOf(seniority.min);
  const above = seniority.max && rank > PREFERENCE_SENIORITIES.indexOf(seniority.max);
  if (below || above) violations.push(`Seniority: ${seniorityRangeLabel(seniority)}`);
}
