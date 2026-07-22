import type { JobAnalysisResponse, JobStatus } from "shared/types/job";

export type PostingSource = "url" | "document";

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
}

export interface ProfilePayload {
  text: string;
  dealbreakers: string[];
  updatedAt: string;
  schemaVersion: number;
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
  usage: { count: number; limit: number; resetsAt: string };
  subscription: { status: string; renewsAt: string | null; endsAt: string | null } | null;
}

export interface UsageEcho {
  count: number;
  limit: number;
  resetsAt: string;
  tier: string;
}

export interface DocumentAnalysisResult {
  analysis: JobAnalysisResponse;
  source: "document";
  filename: string;
  /** `doc:<sha256 of the extracted text>` — round-tripped verbatim into the save body. */
  canonicalUrl: string;
  saveKey: string;
  usage: UsageEcho;
}
