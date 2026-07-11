import type { CandidateProfile } from "../types/job";
import { ApiError, apiFetch } from "./api/apiClient";

// Sized for a full pasted resume (a dense multi-page resume is ~15k chars).
// Must match PROFILE_TEXT_MAX in functions/src/models/user.ts — the server
// silently truncates at its own limit.
export const PROFILE_TEXT_MAX = 20_000;

/**
 * Candidate-profile storage. Same exported functions as the original
 * chrome.storage.local implementation — since 002 the profile lives in the
 * per-account server store (contracts/storage-api.md) and follows the
 * signed-in user across devices.
 */

async function throwUnexpected(response: Response): Promise<never> {
  let message = "The storage service rejected the request.";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    // Keep the generic message.
  }
  throw new ApiError(response.status, "SERVICE_ERROR", message, false);
}

export async function getProfile(): Promise<CandidateProfile | null> {
  const response = await apiFetch("/profile");
  if (response.status === 404) return null;
  if (!response.ok) await throwUnexpected(response);
  const profile = (await response.json()) as CandidateProfile;
  return profile.text.length > 0 ? profile : null;
}

export async function setProfile(input: {
  text: string;
  dealbreakers: string[];
}): Promise<CandidateProfile> {
  const response = await apiFetch("/profile", { method: "PUT", body: input });
  if (!response.ok) await throwUnexpected(response);
  return (await response.json()) as CandidateProfile;
}

export async function clearProfile(): Promise<void> {
  const response = await apiFetch("/profile", { method: "DELETE" });
  if (!response.ok && response.status !== 204) await throwUnexpected(response);
}

/** Serialized form sent with analysis requests (unchanged; pure function). */
export function profileToPromptText(profile: CandidateProfile): string {
  if (profile.dealbreakers.length === 0) return profile.text;
  return `${profile.text}\n\nDealbreakers:\n${profile.dealbreakers
    .map((d) => `- ${d}`)
    .join("\n")}`;
}
