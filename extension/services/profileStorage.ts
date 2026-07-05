import type { CandidateProfile } from "../types/job";

const PROFILE_KEY = "profile";

export const PROFILE_TEXT_MAX = 4_000;

export async function getProfile(): Promise<CandidateProfile | null> {
  const data = await chrome.storage.local.get(PROFILE_KEY);
  const profile = data[PROFILE_KEY] as CandidateProfile | undefined;
  return profile && profile.text.length > 0 ? profile : null;
}

export async function setProfile(input: {
  text: string;
  dealbreakers: string[];
}): Promise<CandidateProfile> {
  const profile: CandidateProfile = {
    text: input.text.slice(0, PROFILE_TEXT_MAX),
    dealbreakers: input.dealbreakers.map((d) => d.trim()).filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
  return profile;
}

export async function clearProfile(): Promise<void> {
  await chrome.storage.local.remove(PROFILE_KEY);
}

/** Serialized form sent with analysis requests (FR-007: transmitted only there). */
export function profileToPromptText(profile: CandidateProfile): string {
  if (profile.dealbreakers.length === 0) return profile.text;
  return `${profile.text}\n\nDealbreakers:\n${profile.dealbreakers
    .map((d) => `- ${d}`)
    .join("\n")}`;
}
