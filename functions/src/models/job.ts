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

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

export interface Fit {
  score: number;
  rationale: string;
}

export interface PageExtractPayload {
  url: string;
  canonicalUrl: string;
  title: string;
  jsonLd: Record<string, unknown>[];
  mainText: string;
  extractedAt: string;
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

const ARRANGEMENTS: Arrangement[] = ["remote", "hybrid", "onsite", "unspecified"];
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

export function isJobAnalysisPayload(value: unknown): value is JobAnalysisPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.isJobPosting === "boolean" &&
    ARRANGEMENTS.includes(v.arrangement as Arrangement) &&
    CONFIDENCES.includes(v.arrangementConfidence as ArrangementConfidence) &&
    SENIORITIES.includes(v.seniority as Seniority) &&
    Array.isArray(v.techStack)
  );
}
