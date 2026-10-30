import { createHash } from "node:crypto";
import type { ScoringProfile } from "../../../shared/types/profile";
import { profileToPromptText } from "../../../shared/types/profile";

/**
 * Profile fingerprints (research R5): lowercase hex SHA-256 of the
 * whitespace-normalized serialized profile. Computed on every read and on
 * every analysis, never stored as the current value — only previous values
 * land in `Profiles.fingerprintHistory` for rescore eligibility (R6).
 */

export function profileFingerprint(serialized: string): string {
  return createHash("sha256")
    .update(serialized.replace(/\s+/g, " ").trim(), "utf8")
    .digest("hex");
}

interface ProfileCarrier {
  profile?: string;
  profileData?: ScoringProfile;
}

/**
 * The profile text the model actually sees: `profileData` serialized with the
 * shared profileToPromptText when present (new clients), otherwise the legacy
 * `profile` string as sent (older extensions). Empty means no profile.
 */
export function resolveScoringProfile(body: ProfileCarrier): string | undefined {
  const serialized = body.profileData ? profileToPromptText(body.profileData) : body.profile;
  return serialized ? serialized : undefined;
}

export function fingerprintForRequest(body: ProfileCarrier): string | undefined {
  const serialized = resolveScoringProfile(body);
  return serialized === undefined ? undefined : profileFingerprint(serialized);
}
