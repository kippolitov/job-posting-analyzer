import { RestError } from "@azure/data-tables";
import type { ProfileEntity, ProfilePutBody } from "../models/user";
import { PROFILE_TEXT_MAX } from "../models/user";
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
 */

const TABLE = "Profiles";
const ROW_KEY = "profile";

export interface StoredProfile {
  text: string;
  dealbreakers: string[];
  updatedAt: string;
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 404;
}

export async function getProfile(sub: string): Promise<StoredProfile | null> {
  const client = await ensureTable(TABLE);
  try {
    const entity = await client.getEntity<ProfileEntity>(sub, ROW_KEY);
    return {
      text: entity.text,
      dealbreakers: decodeJsonProperty<string[]>(entity.dealbreakers, []),
      updatedAt: entity.updatedAt,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function putProfile(
  sub: string,
  input: ProfilePutBody
): Promise<StoredProfile> {
  const profile: StoredProfile = {
    text: input.text.slice(0, PROFILE_TEXT_MAX),
    dealbreakers: input.dealbreakers.map((d) => d.trim()).filter(Boolean),
    updatedAt: nowIso(),
  };
  const client = await ensureTable(TABLE);
  await client.upsertEntity(
    {
      partitionKey: sub,
      rowKey: ROW_KEY,
      text: profile.text,
      dealbreakers: encodeJsonProperty(profile.dealbreakers),
      updatedAt: profile.updatedAt,
      schemaVersion: 1,
    },
    "Replace"
  );
  return profile;
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
