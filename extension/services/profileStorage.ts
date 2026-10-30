import type { CandidateProfile } from "../types/job";
import {
  confirmedSkillLabel,
  NO_PROFILE_FOR_SKILL,
  type Preferences,
} from "../../shared/types/profile";
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

/**
 * Session-scoped copy of the current profile's fingerprint (006 R7), so the
 * panel can mark stale scores and react to a profile edit made elsewhere via
 * `chrome.storage.onChanged`. `value: null` means the account has no profile.
 */
export const FINGERPRINT_KEY = "profile:fingerprint";

interface CachedFingerprint {
  value: string | null;
  fetchedAt: number;
}

async function writeCachedFingerprint(value: string | null): Promise<void> {
  try {
    const entry: CachedFingerprint = { value, fetchedAt: Date.now() };
    await chrome.storage.session.set({ [FINGERPRINT_KEY]: entry });
  } catch {
    // The cache is an optimisation; a storage failure must not fail the call.
  }
}

/** `undefined` while unknown, `null` when the account has no profile. */
export async function getCachedFingerprint(): Promise<string | null | undefined> {
  try {
    const stored = await chrome.storage.session.get(FINGERPRINT_KEY);
    const entry = stored[FINGERPRINT_KEY] as CachedFingerprint | undefined;
    return entry ? entry.value : undefined;
  } catch {
    return undefined;
  }
}

export async function getProfile(): Promise<CandidateProfile | null> {
  const response = await apiFetch("/profile");
  if (response.status === 404) {
    await writeCachedFingerprint(null);
    return null;
  }
  if (!response.ok) await throwUnexpected(response);
  const profile = (await response.json()) as CandidateProfile;
  if (profile.text.length === 0) {
    await writeCachedFingerprint(null);
    return null;
  }
  await writeCachedFingerprint(profile.fingerprint ?? null);
  return profile;
}

export async function setProfile(input: {
  text: string;
  dealbreakers: string[];
  /** Omitted keeps the stored preferences, `null` clears them (merge PUT). */
  preferences?: Preferences | null;
  /** Omitted keeps the stored skills, `[]` clears them (merge PUT). */
  confirmedSkills?: string[];
}): Promise<CandidateProfile> {
  const response = await apiFetch("/profile", { method: "PUT", body: input });
  if (!response.ok) await throwUnexpected(response);
  const saved = (await response.json()) as CandidateProfile;
  await writeCachedFingerprint(saved.fingerprint ?? null);
  return saved;
}

/**
 * POST /api/profile/confirmed-skills ("I have this"). The server appends
 * atomically, so quick clicks on different skills can't overwrite each other.
 * The new fingerprint goes into the session cache, which marks every score
 * made against the old profile as out of date (FR-007).
 */
export async function confirmSkill(label: string): Promise<CandidateProfile> {
  const response = await apiFetch("/profile/confirmed-skills", {
    method: "POST",
    body: { label: confirmedSkillLabel(label) },
  });
  if (response.status === 404) {
    throw new ApiError(404, "SERVICE_ERROR", NO_PROFILE_FOR_SKILL, false);
  }
  if (!response.ok) await throwUnexpected(response);
  const saved = (await response.json()) as CandidateProfile;
  await writeCachedFingerprint(saved.fingerprint ?? null);
  return saved;
}

export async function clearProfile(): Promise<void> {
  const response = await apiFetch("/profile", { method: "DELETE" });
  if (!response.ok && response.status !== 204) await throwUnexpected(response);
  await writeCachedFingerprint(null);
}

/**
 * POST /api/profile/import: the text of a .pdf or .docx résumé. The file is
 * discarded server-side; nothing is stored until the user saves (FR-014).
 */
export async function importResume(file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const response = await apiFetch("/profile/import", { method: "POST", rawBody: form });
  if (!response.ok) await throwUnexpected(response);
  return ((await response.json()) as { text: string }).text;
}

/** The shape analysis requests carry as `profileData`. */
export { toScoringProfile } from "../../shared/types/profile";

/** Serialized form sent with analysis requests (pure; shared with the web app). */
export { profileToPromptText } from "../../shared/types/profile";
