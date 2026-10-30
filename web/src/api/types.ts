import type { JobAnalysisResponse, JobStatus } from "shared/types/job";

export type PostingSource = "url" | "document" | "paste";

/** Wire shape of a saved job — mirrors functions/src/models/user.ts SavedJobPayload (data-model.md §2). */
export interface SavedJobPayload {
  schemaVersion: number;
  canonicalUrl: string;
  sourceUrl: string;
  source: PostingSource;
  filename: string;
  analysis: JobAnalysisResponse;
  status: JobStatus;
  notes: string;
  savedAt: string;
  updatedAt: string;
  /** Set after a rescore found no posting (006 contracts/saved-jobs-api.md). */
  unavailableAt?: string | null;
}

export interface ProfilePayload {
  text: string;
  dealbreakers: string[];
  updatedAt: string;
  schemaVersion: number;
  /** Server-derived (006 R5). Optional on read so an older backend still type-checks. */
  fingerprint?: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  transactionId: string;
}

export interface PortalResult {
  portalUrl: string;
}

export interface AccountPayload {
  email: string;
  tier: "free" | "premium";
  usage: {
    count: number;
    limit: number;
    resetsAt: string;
    /** 006 FR-004a; optional so an older backend still type-checks. */
    rescoresUsed?: number;
    rescoresLimit?: number;
  };
  subscription: { status: string; renewsAt: string | null; endsAt: string | null } | null;
}

export interface UsageEcho {
  count: number;
  limit: number;
  resetsAt: string;
  tier: string;
  /** 006 contracts/analyze-api.md §3: which counter paid for this analysis. */
  charged?: "rescore" | "analysis" | "none";
  rescoresUsed?: number;
  rescoresLimit?: number;
}

export interface DocumentAnalysisResult {
  analysis: JobAnalysisResponse;
  source: "document" | "paste";
  /** Absent for a paste (FR-027). */
  filename?: string;
  /** `doc:<sha256 of the extracted text>` — round-tripped verbatim into the save body. */
  canonicalUrl: string;
  saveKey: string;
  usage: UsageEcho;
  /** Only on a rescore that found no posting (FR-003a). */
  postingUnavailable?: true;
}
