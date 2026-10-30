import { RestError } from "@azure/data-tables";
import type { ProfileEntity, ProfilePutBody } from "../models/user";
import { PROFILE_TEXT_MAX } from "../models/user";
import { profileToPromptText, type Preferences } from "../../../shared/types/profile";
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
  const base = {
    text: entity.text,
    dealbreakers: decodeJsonProperty<string[]>(entity.dealbreakers, []),
    ...(preferences ? { preferences } : {}),
  };
  const confirmedSkills = decodeJsonProperty<string[]>(entity.confirmedSkills, []);
  return {
    ...base,
    updatedAt: entity.updatedAt,
    fingerprint: profileFingerprint(profileToPromptText(base)),
    ...(confirmedSkills.length > 0 ? { confirmedSkills } : {}),
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

  const confirmedSkills =
    input.confirmedSkills === undefined
      ? existing?.confirmedSkills
      : input.confirmedSkills.length === 0
        ? undefined
        : encodeJsonProperty(input.confirmedSkills);
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
