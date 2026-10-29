import type { ScoringProfile } from "./profile";

export type Arrangement = "remote" | "hybrid" | "onsite" | "unspecified";
export type ArrangementConfidence = "explicit" | "inferred" | "none";
export type Seniority =
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | "manager"
  | "director"
  | "executive"
  | "unspecified";
export type SalaryPeriod = "year" | "month" | "day" | "hour";

export type JobStatus =
  | "interested"
  | "applied"
  | "interviewing"
  | "rejected"
  | "ghosted"
  | "archived";

export const JOB_STATUSES: JobStatus[] = [
  "interested",
  "applied",
  "interviewing",
  "rejected",
  "ghosted",
  "archived",
];

const ARRANGEMENT_VALUES: Arrangement[] = ["remote", "hybrid", "onsite", "unspecified"];
export const ARRANGEMENTS: Arrangement[] = ARRANGEMENT_VALUES;

const CONFIDENCES: ArrangementConfidence[] = ["explicit", "inferred", "none"];
const SENIORITIES: Seniority[] = [
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
  "unspecified",
];

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

export interface Fit {
  score: number;
  rationale: string;
  /** Required responsibilities/skills the profile covers. Absent on pre-breakdown snapshots. */
  matching?: string[];
  /** Required responsibilities/skills the profile shows no evidence of. */
  missing?: string[];
  /** Nice-to-have qualifications from the posting the profile does not cover. */
  desired?: string[];
  /** Why this role is a strong choice for this candidate. */
  strengths?: string[];
  /** Risks or downsides of this role for this candidate. */
  weaknesses?: string[];
  /**
   * Violated dealbreakers in the user's own wording; the server maps model
   * output to profile lines (research R8). Never changes `score` (FR-005).
   * Absent on fits scored before 006 (research R4: additive fields only).
   */
  dealbreakersViolated?: string[];
  /**
   * SHA-256 of the whitespace-normalized profile this fit was scored against
   * (research R5). Absent means version-unknown, so no verdict is shown.
   */
  profileFingerprint?: string;
}

/** One verbatim quote backing a fit chip (PR3, data-model.md §1). */
export interface EvidenceItem {
  label: string;
  postingQuote: string | null;
  profileQuote: string | null;
}

export interface FitEvidence {
  matching?: EvidenceItem[];
  missing?: EvidenceItem[];
  desired?: EvidenceItem[];
}

export type StructuredSourceKind = "json-ld" | "microdata";

/** One harvested block of posting data, carrying where it came from. */
export interface StructuredSource {
  kind: StructuredSourceKind;
  /** Pruned posting-shaped subtree. */
  data: Record<string, unknown>;
}

/** How an extraction resolved. Client-side only — see ExtractionProvenance. */
export type ExtractionStrategy =
  | "learned-selector" // user-taught region for this host, applied automatically
  | "picked" // one-off region the user just picked with the overlay
  | "selection" // one-off region the user just highlighted on the page
  | "semantic" // main / [role=main] / article won the scoring
  | "scored" // density scorer picked a non-semantic container
  | "google-overlay" // the SERP dialog branch
  | "body" // last-resort full-body fallback
  | "paste"; // user-supplied text, no page involved

/**
 * Diagnosis record for one extraction. Never persisted and never transmitted
 * (contracts/extraction-payload.md §1) — it carries no analysis value. Consumed
 * by the panel's badges, the error copy, and the eval harness.
 */
export interface ExtractionProvenance {
  strategy: ExtractionStrategy;
  /** Readiness attempts made before returning. */
  attempts: number;
  /** ms from injection to return. */
  elapsedMs: number;
  /** True when the readiness budget expired without stable usable text. */
  budgetExpired: boolean;
  /** A learned selector existed for this host but matched nothing / too little. */
  learnedSelectorMissed: boolean;
}

/**
 * The single argument extractPage receives via executeScript({ args }).
 *
 * extractPage is serialized into the page, so it can neither import
 * learnedSelectors.ts nor reach for chrome.storage. The caller resolves the
 * selector and passes it in; touch/recordMiss stay on the caller's side, where
 * they are testable in jsdom (plan.md Constraints).
 */
export interface ExtractArgs {
  /** Resolved by the caller from `learned:<host>`; absent when nothing is learned. */
  learnedSelector?: string;
}

/** Client-side page extraction payload; never persisted as-is. */
export interface PageExtractPayload {
  url: string;
  canonicalUrl: string;
  title: string;
  jsonLd: Record<string, unknown>[];
  mainText: string;
  extractedAt: string;
  /**
   * Optional on the wire in both directions: older extensions omit it, and the
   * backend treats absence as [] (contracts/extraction-payload.md §1). The
   * extension's own RawPageExtract requires it.
   */
  structuredSources?: StructuredSource[];
  /** Client-side only. Present on the in-page extract, stripped before transmission. */
  provenance?: ExtractionProvenance;
}

export interface AnalyzeJobRequest {
  extract: PageExtractPayload;
  /** Legacy serialized profile; new clients still send it during the deploy window. */
  profile?: string;
  /** Structured profile; when present the server serializes it and ignores `profile` (R5). */
  profileData?: ScoringProfile;
  assumeJobPosting?: boolean;
  /** Rescore intent; eligibility is decided on the server (research R6). */
  rescore?: { priorFingerprint: string | null };
}

/** Model output shape (schema-enforced); server appends model + analyzedAt. */
export interface JobAnalysisPayload {
  isJobPosting: boolean;
  title: string | null;
  company: string | null;
  location: string | null;
  arrangement: Arrangement;
  arrangementConfidence: ArrangementConfidence;
  arrangementEvidence: string | null;
  daysInOffice: number | null;
  daysRemote: number | null;
  remoteRestrictions: string | null;
  salary: Salary | null;
  seniority: Seniority;
  techStack: string[];
  fit: Fit | null;
}

export interface JobAnalysisResponse extends JobAnalysisPayload {
  model: string;
  analyzedAt: string;
  /** The tier that scored this analysis (006 FR-008). Absent on analyses saved before. */
  tier?: "free" | "premium";
}

export const MAIN_TEXT_CAP = 40_000;

/** Below this many characters (with no JSON-LD) a page or paste is not worth analyzing. */
export const MIN_TEXT_CHARS = 300;

const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Structural check for `profileData` (contracts/analyze-api.md §1). A
 * malformed optional field is rejected, never silently ignored. Detailed
 * preference validation lands with PR4.
 */
export function isScoringProfile(value: unknown): value is ScoringProfile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.text === "string" &&
    isStringArray(v.dealbreakers) &&
    (v.preferences === undefined ||
      v.preferences === null ||
      (typeof v.preferences === "object" && !Array.isArray(v.preferences))) &&
    (v.confirmedSkills === undefined || isStringArray(v.confirmedSkills))
  );
}

/** `null` or 64 lowercase hex characters. */
export function isPriorFingerprint(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && FINGERPRINT_RE.test(value));
}

export function isAnalyzeJobRequest(body: unknown): body is AnalyzeJobRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  const extract = b.extract;
  if (typeof extract !== "object" || extract === null) return false;
  const e = extract as Record<string, unknown>;
  if (b.profileData !== undefined && !isScoringProfile(b.profileData)) return false;
  if (b.rescore !== undefined) {
    if (typeof b.rescore !== "object" || b.rescore === null) return false;
    if (!isPriorFingerprint((b.rescore as Record<string, unknown>).priorFingerprint)) {
      return false;
    }
  }
  return (
    typeof e.url === "string" &&
    typeof e.mainText === "string" &&
    typeof e.title === "string" &&
    Array.isArray(e.jsonLd)
  );
}

export function isJobAnalysisPayload(value: unknown): value is JobAnalysisPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.isJobPosting === "boolean" &&
    ARRANGEMENT_VALUES.includes(v.arrangement as Arrangement) &&
    CONFIDENCES.includes(v.arrangementConfidence as ArrangementConfidence) &&
    SENIORITIES.includes(v.seniority as Seniority) &&
    Array.isArray(v.techStack)
  );
}
