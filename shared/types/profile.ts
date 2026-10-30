export type PreferenceArrangement = "remote" | "hybrid" | "onsite";
export type PreferenceSeniority =
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | "manager"
  | "director"
  | "executive";
export type PreferencePeriod = "year" | "month" | "day" | "hour";

/** Seniority in the enum's declared order, management levels last (research R11). */
export const PREFERENCE_SENIORITIES: PreferenceSeniority[] = [
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
];

/**
 * Structured preferences (data-model.md §3, research R11). Arrangement, office
 * days, salary and seniority are checked in code; locations and sponsorship
 * are judged by the model.
 */
export interface Preferences {
  arrangements?: PreferenceArrangement[];
  /** Integer 0..5. On-site counts as 5. */
  maxOfficeDays?: number;
  minSalary?: { amount: number; currency: string; period: PreferencePeriod };
  seniority?: { min?: PreferenceSeniority; max?: PreferenceSeniority };
  locations?: string[];
  needsSponsorship?: true;
}

/**
 * The structured profile a client sends as `profileData` (contracts/
 * analyze-api.md §1). The server serializes it with profileToPromptText, so
 * every surface scores against the same prompt (research R5, SC-006).
 * `preferences` arrived in PR4; `confirmedSkills` arrives in PR5 and is opaque
 * here until then.
 */
export interface ScoringProfile {
  text: string;
  dealbreakers: string[];
  preferences?: Preferences | null;
  confirmedSkills?: string[];
}

/** The `profileData` an analysis request carries: the scoring fields only. */
export function toScoringProfile(profile: ScoringProfile): ScoringProfile {
  return {
    text: profile.text,
    dealbreakers: profile.dealbreakers,
    ...(profile.preferences ? { preferences: profile.preferences } : {}),
    ...(profile.confirmedSkills?.length ? { confirmedSkills: profile.confirmedSkills } : {}),
  };
}

const DEALBREAKERS_HEADING = "Dealbreakers:";
const PREFERENCES_HEADING = "Preferences:";
/** Judged by the model, so the banner shows exactly this text (research R11). */
export const SPONSORSHIP_LINE = "Work authorization: needs visa sponsorship";

/**
 * Serialized candidate profile sent with analysis requests. Single source for
 * every surface that requests a fit score (extension analyze-job, web
 * analyze-document) so the same profile always yields the same prompt.
 *
 * Invariant (data-model.md §3): for `{text, dealbreakers}` the output is
 * byte-identical to the pre-006 implementation, so fingerprints stay stable.
 */
export function profileToPromptText<P extends ScoringProfile>(profile: P): string {
  const sections = [profile.text];
  if (profile.dealbreakers.length > 0) {
    sections.push(
      `${DEALBREAKERS_HEADING}\n${profile.dealbreakers.map((d) => `- ${d}`).join("\n")}`
    );
  }
  const preferences = preferenceLines(profile.preferences);
  if (preferences.length > 0) {
    sections.push(`${PREFERENCES_HEADING}\n${preferences.map((l) => `- ${l}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

/** Seniority range as the user reads it: "senior to staff", "senior or above". */
export function seniorityRangeLabel(range: NonNullable<Preferences["seniority"]>): string {
  if (range.min && range.max) return `${range.min} to ${range.max}`;
  if (range.min) return `${range.min} or above`;
  return `${range.max} or below`;
}

export function preferenceLines(preferences: Preferences | null | undefined): string[] {
  if (!preferences) return [];
  const lines: string[] = [];
  if (preferences.arrangements?.length) {
    lines.push(`Work arrangement: ${preferences.arrangements.join(" or ")}`);
  }
  if (preferences.maxOfficeDays !== undefined) {
    lines.push(`Office days: at most ${preferences.maxOfficeDays} per week`);
  }
  if (preferences.minSalary) {
    const { amount, currency, period } = preferences.minSalary;
    lines.push(`Minimum salary: ${amount} ${currency} per ${period}`);
  }
  if (preferences.seniority && (preferences.seniority.min || preferences.seniority.max)) {
    lines.push(`Seniority: ${seniorityRangeLabel(preferences.seniority)}`);
  }
  if (preferences.locations?.length) {
    lines.push(`Locations or timezones: ${preferences.locations.join("; ")}`);
  }
  if (preferences.needsSponsorship) {
    lines.push(SPONSORSHIP_LINE);
  }
  return lines;
}

/**
 * Inverse of profileToPromptText for the Dealbreakers section only. The
 * server uses it to recover dealbreaker lines from a legacy string-only
 * request (research R8). Reads the last Dealbreakers heading, since the
 * serializer always appends that section after the résumé text.
 */
export function dealbreakerLinesFromPrompt(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.lastIndexOf(DEALBREAKERS_HEADING);
  if (start === -1) return [];
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) break;
    result.push(line.slice(2));
  }
  return result;
}

const ARRANGEMENT_CHOICES: string[] = ["remote", "hybrid", "onsite"];
const PERIODS: string[] = ["year", "month", "day", "hour"];
const PREFERENCE_KEYS = [
  "arrangements",
  "maxOfficeDays",
  "minSalary",
  "seniority",
  "locations",
  "needsSponsorship",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural and semantic check for `preferences` (data-model.md §3). Unknown
 * keys are rejected, so a typo cannot be stored and silently ignored.
 */
export function isPreferences(value: unknown): value is Preferences {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((k) => !PREFERENCE_KEYS.includes(k))) return false;

  const { arrangements, maxOfficeDays, minSalary, seniority, locations, needsSponsorship } = value;
  if (
    arrangements !== undefined &&
    !(
      Array.isArray(arrangements) &&
      arrangements.length > 0 &&
      arrangements.every((a) => typeof a === "string" && ARRANGEMENT_CHOICES.includes(a))
    )
  ) {
    return false;
  }
  if (
    maxOfficeDays !== undefined &&
    !(Number.isInteger(maxOfficeDays) && (maxOfficeDays as number) >= 0 && (maxOfficeDays as number) <= 5)
  ) {
    return false;
  }
  if (minSalary !== undefined) {
    if (!isRecord(minSalary)) return false;
    if (
      typeof minSalary.amount !== "number" ||
      !Number.isFinite(minSalary.amount) ||
      minSalary.amount <= 0 ||
      typeof minSalary.currency !== "string" ||
      !/^[A-Z]{3}$/.test(minSalary.currency) ||
      typeof minSalary.period !== "string" ||
      !PERIODS.includes(minSalary.period)
    ) {
      return false;
    }
  }
  if (seniority !== undefined) {
    if (!isRecord(seniority)) return false;
    const levels = PREFERENCE_SENIORITIES as string[];
    const { min, max } = seniority;
    if (min !== undefined && !(typeof min === "string" && levels.includes(min))) return false;
    if (max !== undefined && !(typeof max === "string" && levels.includes(max))) return false;
    if (min !== undefined && max !== undefined && levels.indexOf(min as string) > levels.indexOf(max as string)) {
      return false;
    }
  }
  if (
    locations !== undefined &&
    !(Array.isArray(locations) && locations.every((l) => typeof l === "string"))
  ) {
    return false;
  }
  if (needsSponsorship !== undefined && needsSponsorship !== true) return false;
  return true;
}
