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
}): Promise<ProfilePayload> {
  const res = await apiFetch("/profile", { method: "PUT", body: payload });
  return (await res.json()) as ProfilePayload;
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

export interface AnalyzeDocumentParams {
  file: File;
  profile?: string;
  assumeJobPosting?: boolean;
}

/** POST /api/analyze-document (contracts/analyze-document.md). */
export async function analyzeDocument(
  params: AnalyzeDocumentParams
): Promise<DocumentAnalysisResult> {
  const form = new FormData();
  form.set("file", params.file);
  if (params.profile) form.set("profile", params.profile);
  if (params.assumeJobPosting !== undefined) {
    form.set("assumeJobPosting", String(params.assumeJobPosting));
  }
  const res = await apiFetch("/analyze-document", { method: "POST", rawBody: form });
  return (await res.json()) as DocumentAnalysisResult;
}
