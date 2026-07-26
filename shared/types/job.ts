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
  profile?: string;
  assumeJobPosting?: boolean;
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
}

export const MAIN_TEXT_CAP = 40_000;

export function isAnalyzeJobRequest(body: unknown): body is AnalyzeJobRequest {
  if (typeof body !== "object" || body === null) return false;
  const extract = (body as { extract?: unknown }).extract;
  if (typeof extract !== "object" || extract === null) return false;
  const e = extract as Record<string, unknown>;
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
