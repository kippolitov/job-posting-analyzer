import { profileToPromptText, type Preferences, type ScoringProfile } from "shared/types/profile";
import type { JobAnalysisResponse, JobStatus } from "shared/types/job";
import { ApiError, apiFetch } from "./apiClient";
import type {
  AccountPayload,
  CheckoutResult,
  DocumentAnalysisResult,
  PortalResult,
  ProfilePayload,
  SavedJobPayload,
} from "./types";

export async function fetchJobs(): Promise<SavedJobPayload[]> {
  const res = await apiFetch("/jobs");
  const body = (await res.json()) as { jobs: SavedJobPayload[] };
  return body.jobs;
}

export async function fetchProfile(): Promise<ProfilePayload | null> {
  try {
    const res = await apiFetch("/profile");
    return (await res.json()) as ProfilePayload;
  } catch (err) {
    if (err instanceof ApiError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

export async function saveProfile(payload: {
  text: string;
  dealbreakers: string[];
  /** Omitted keeps the stored preferences, `null` clears them (merge PUT). */
  preferences?: Preferences | null;
  /** Omitted keeps the stored skills, `[]` clears them (merge PUT). */
  confirmedSkills?: string[];
}): Promise<ProfilePayload> {
  const res = await apiFetch("/profile", { method: "PUT", body: payload });
  return (await res.json()) as ProfilePayload;
}

/**
 * POST /api/profile/confirmed-skills ("I have this"): the server appends
 * atomically and answers with the updated profile, including its new
 * fingerprint.
 */
export async function confirmSkill(label: string): Promise<ProfilePayload> {
  const res = await apiFetch("/profile/confirmed-skills", { method: "POST", body: { label } });
  return (await res.json()) as ProfilePayload;
}

/**
 * POST /api/profile/import: the text of a .pdf or .docx résumé. The file is
 * discarded server-side; nothing is stored until the user saves (FR-014).
 */
export async function importResume(file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const res = await apiFetch("/profile/import", { method: "POST", rawBody: form });
  return ((await res.json()) as { text: string }).text;
}

export async function fetchAccount(): Promise<AccountPayload> {
  const res = await apiFetch("/account");
  return (await res.json()) as AccountPayload;
}

/** POST /api/billing/checkout (contracts/consumed-endpoints.md — shared with the extension). */
export async function startCheckout(): Promise<CheckoutResult> {
  const res = await apiFetch("/billing/checkout", { method: "POST" });
  return (await res.json()) as CheckoutResult;
}

/** POST /api/billing/portal — 404 NOT_FOUND when the account has no Paddle customer yet. */
export async function openBillingPortal(): Promise<PortalResult> {
  const res = await apiFetch("/billing/portal", { method: "POST" });
  return (await res.json()) as PortalResult;
}

const UPGRADE_POLL_INTERVAL_MS = 5_000;
const UPGRADE_POLL_TIMEOUT_MS = 60_000;

/**
 * After a checkout tab opens, poll GET /api/account at a short interval until
 * tier flips to premium or the timeout elapses (mirrors extension/services/
 * accountService.ts's pollForUpgrade — same webhook-driven upgrade latency,
 * SC-004). Returns a stop function; a fetch failure is transient and does
 * not end the poll early.
 */
export function pollForUpgrade(
  onUpdate: (account: AccountPayload) => void,
  options: { intervalMs?: number; timeoutMs?: number } = {}
): () => void {
  const intervalMs = options.intervalMs ?? UPGRADE_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? UPGRADE_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped || Date.now() >= deadline) return;
    try {
      const account = await fetchAccount();
      if (stopped) return;
      onUpdate(account);
      if (account.tier === "premium") return;
    } catch {
      // Transient — keep polling until the deadline.
    }
    if (stopped) return;
    setTimeout(() => void tick(), intervalMs);
  };

  void tick();

  return () => {
    stopped = true;
  };
}

export async function saveJob(
  key: string,
  payload: SavedJobPayload
): Promise<SavedJobPayload> {
  const res = await apiFetch(`/jobs/${key}`, { method: "PUT", body: payload });
  return (await res.json()) as SavedJobPayload;
}

/** PATCH /api/jobs/:key body (contracts/saved-jobs-api.md); only the fields given change. */
export interface JobPatch {
  analysis?: JobAnalysisResponse;
  status?: JobStatus;
  notes?: string;
  unavailableAt?: string | null;
}

export async function patchJob(key: string, patch: JobPatch): Promise<SavedJobPayload> {
  const res = await apiFetch(`/jobs/${key}`, { method: "PATCH", body: patch });
  return (await res.json()) as SavedJobPayload;
}

export interface AnalyzeDocumentParams {
  /** Exactly one of `file` and `text` (the paste option, FR-027). */
  file?: File;
  text?: string;
  /** Sent as `profileData`, with `profile` derived from it, exactly as the extension does (FR-001). */
  profileData?: ScoringProfile;
  assumeJobPosting?: boolean;
  /** Rescore intent (research R6); `priorFingerprint` is the saved fit's own. */
  rescore?: boolean;
  priorFingerprint?: string | null;
}

/** POST /api/analyze-document (contracts/analyze-api.md §1). */
export async function analyzeDocument(
  params: AnalyzeDocumentParams
): Promise<DocumentAnalysisResult> {
  const form = new FormData();
  if (params.file) form.set("file", params.file);
  if (params.text !== undefined) form.set("text", params.text);
  if (params.profileData) {
    form.set("profile", profileToPromptText(params.profileData));
    form.set("profileData", JSON.stringify(params.profileData));
  }
  if (params.assumeJobPosting !== undefined) {
    form.set("assumeJobPosting", String(params.assumeJobPosting));
  }
  if (params.rescore) {
    form.set("rescore", "true");
    if (params.priorFingerprint) form.set("priorFingerprint", params.priorFingerprint);
  }
  const res = await apiFetch("/analyze-document", { method: "POST", rawBody: form });
  return (await res.json()) as DocumentAnalysisResult;
}
