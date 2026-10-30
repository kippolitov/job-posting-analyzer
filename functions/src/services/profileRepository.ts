import { RestError } from "@azure/data-tables";
import type { ProfileEntity, ProfilePutBody } from "../models/user";
import { PROFILE_TEXT_MAX } from "../models/user";
import {
  normalizeConfirmedSkills,
  profileCapLength,
  profileToPromptText,
  type Preferences,
} from "../../../shared/types/profile";
import { profileFingerprint } from "./profileFingerprint";
import {
  decodeJsonProperty,
  encodeJsonProperty,
  ensureTable,
  nowIso,
} from "./tablesService";

/**
 * Profiles table CRUD (data-model.md): PK = Google sub, RK = "profile", one
 * row per user. Normalization mirrors the extension's setProfile exactly so
 * the swap is behavior-preserving.
 *
 * PUT merges (contracts/profile-api.md §2): an older client's
 * `{text, dealbreakers}` save must not erase columns it doesn't know about,
 * so the write is a read-merge-write conditional on the row's ETag.
 */

const TABLE = "Profiles";
const ROW_KEY = "profile";
const FINGERPRINT_HISTORY_MAX = 20;
/** Same retry budget as metering's 412 loop. */
const MAX_RETRIES = 4;

export interface StoredProfile {
  text: string;
  dealbreakers: string[];
  updatedAt: string;
  /** Derived on every read, never stored (research R5). */
  fingerprint: string;
  preferences?: Preferences;
  confirmedSkills?: string[];
}

/** A write that includes confirmed skills would pass the profile cap (contracts/profile-api.md §2). */
export class ProfileTooLongError extends Error {
  constructor() {
    super(`Profile text must be ${PROFILE_TEXT_MAX.toLocaleString("en-US")} characters or fewer.`);
    this.name = "ProfileTooLongError";
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 404;
}
function isConflict(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 409;
}
function isPreconditionFailed(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 412;
}

function storedFromEntity(entity: ProfileEntity): StoredProfile {
  const preferences = decodeJsonProperty<Preferences | null>(
    entity.preferences,
    null
  );
  const confirmedSkills = decodeJsonProperty<string[]>(entity.confirmedSkills, []);
  const base = {
    text: entity.text,
    dealbreakers: decodeJsonProperty<string[]>(entity.dealbreakers, []),
    ...(preferences ? { preferences } : {}),
    ...(confirmedSkills.length > 0 ? { confirmedSkills } : {}),
  };
  return {
    ...base,
    updatedAt: entity.updatedAt,
    fingerprint: profileFingerprint(profileToPromptText(base)),
  };
}

async function readEntity(
  sub: string
): Promise<(ProfileEntity & { etag?: string }) | null> {
  const client = await ensureTable(TABLE);
  try {
    return await client.getEntity<ProfileEntity>(sub, ROW_KEY);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function getProfile(sub: string): Promise<StoredProfile | null> {
  const entity = await readEntity(sub);
  return entity ? storedFromEntity(entity) : null;
}

export async function putProfile(
  sub: string,
  input: ProfilePutBody
): Promise<StoredProfile> {
  const client = await ensureTable(TABLE);
  for (let attempt = 0; ; attempt++) {
    const existing = await readEntity(sub);
    const entity = mergeEntity(sub, existing, input);
    try {
      if (existing) {
        await client.updateEntity(entity, "Replace", { etag: existing.etag });
      } else {
        await client.createEntity(entity);
      }
      return storedFromEntity(entity);
    } catch (err) {
      const lostRace = existing ? isPreconditionFailed(err) : isConflict(err);
      if (lostRace && attempt < MAX_RETRIES) continue;
      throw err;
    }
  }
}

/**
 * Appends one confirmed skill ("I have this", contracts/profile-api.md §4a).
 * Unlike PUT it never rewrites text or dealbreakers, so quick clicks on
 * different skills cannot overwrite each other: the read-append-write is
 * conditional on the ETag and retried. Returns null when no profile exists.
 */
export async function addConfirmedSkill(
  sub: string,
  label: string
): Promise<StoredProfile | null> {
  const client = await ensureTable(TABLE);
  for (let attempt = 0; ; attempt++) {
    const existing = await readEntity(sub);
    if (!existing) return null;
    const stored = storedFromEntity(existing);
    const skills = stored.confirmedSkills ?? [];
    const next = normalizeConfirmedSkills([...skills, label]);
    if (next.length === skills.length) return stored;

    const entity = mergeEntity(sub, existing, {
      text: stored.text,
      dealbreakers: stored.dealbreakers,
      confirmedSkills: next,
    });
    try {
      await client.updateEntity(entity, "Replace", { etag: existing.etag });
      return storedFromEntity(entity);
    } catch (err) {
      if (isPreconditionFailed(err) && attempt < MAX_RETRIES) continue;
      throw err;
    }
  }
}

/** Body fields replace stored ones; omitted optional fields keep their stored value. */
function mergeEntity(
  sub: string,
  existing: ProfileEntity | null,
  input: ProfilePutBody
): ProfileEntity {
  const entity: ProfileEntity = {
    partitionKey: sub,
    rowKey: ROW_KEY,
    text: input.text.slice(0, PROFILE_TEXT_MAX),
    dealbreakers: encodeJsonProperty(
      input.dealbreakers.map((d) => d.trim()).filter(Boolean)
    ),
    updatedAt: nowIso(),
    schemaVersion: 2,
  };

  const preferences =
    input.preferences === undefined
      ? existing?.preferences
      : input.preferences === null || Object.keys(input.preferences).length === 0
        ? undefined
        : encodeJsonProperty(input.preferences);
  if (preferences) entity.preferences = preferences;

  let confirmedSkills = existing?.confirmedSkills;
  if (input.confirmedSkills !== undefined) {
    const normalized = normalizeConfirmedSkills(input.confirmedSkills);
    if (profileCapLength(input.text, normalized) > PROFILE_TEXT_MAX) {
      throw new ProfileTooLongError();
    }
    confirmedSkills = normalized.length === 0 ? undefined : encodeJsonProperty(normalized);
  }
  if (confirmedSkills) entity.confirmedSkills = confirmedSkills;

  let history = decodeJsonProperty<string[]>(existing?.fingerprintHistory, []);
  if (existing) {
    const previous = storedFromEntity(existing).fingerprint;
    if (previous !== storedFromEntity(entity).fingerprint) {
      history = [previous, ...history].slice(0, FINGERPRINT_HISTORY_MAX);
    }
  }
  if (history.length > 0) entity.fingerprintHistory = encodeJsonProperty(history);
  return entity;
}

/** Previous fingerprints, newest first — only rescore eligibility reads this (R6). */
export async function getFingerprintHistory(sub: string): Promise<string[]> {
  const entity = await readEntity(sub);
  return decodeJsonProperty<string[]>(entity?.fingerprintHistory, []);
}

export async function deleteProfile(sub: string): Promise<void> {
  const client = await ensureTable(TABLE);
  try {
    await client.deleteEntity(sub, ROW_KEY);
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
}
