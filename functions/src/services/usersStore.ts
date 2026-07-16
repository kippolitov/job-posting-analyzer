import { RestError } from "@azure/data-tables";
import type { Tier, UserEntity } from "../models/user";
import { ensureTable, nowIso } from "./tablesService";

/**
 * Users table access (data-model.md): PK "User", RK lowercased email.
 * Replaces AllowedUsers as the withAuth point-read — auto-created on first
 * sign-in (self-serve signup), read uncached so tier flips (webhook/CLI) are
 * effective on the very next request (SC-004, mirrors 002's revocation
 * property).
 */

const TABLE = "Users";
const PARTITION = "User";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 404;
}

function isConflict(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 409;
}

async function getEntityOrNull(rowKey: string): Promise<UserEntity | null> {
  const client = await ensureTable(TABLE);
  try {
    return await client.getEntity<UserEntity>(PARTITION, rowKey);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function getByEmail(email: string): Promise<UserEntity | null> {
  return getEntityOrNull(normalizeEmail(email));
}

/**
 * Self-serve signup: returns the existing row, or auto-creates
 * {sub, tier: "free", createdAt} on first sign-in. A migrated row that has
 * never signed in (no recorded sub) has its sub filled in on this call —
 * the first-seen sub is authoritative, mirroring allowedUsersStore's
 * recordSignIn semantics.
 */
export async function getOrCreate(email: string, sub: string): Promise<UserEntity> {
  const rowKey = normalizeEmail(email);
  const existing = await getEntityOrNull(rowKey);
  if (existing) {
    if (!existing.sub) {
      const client = await ensureTable(TABLE);
      await client.updateEntity(
        { partitionKey: PARTITION, rowKey, sub },
        "Merge"
      );
      return { ...existing, sub };
    }
    return existing;
  }

  const entity: UserEntity = {
    partitionKey: PARTITION,
    rowKey,
    sub,
    tier: "free",
    createdAt: nowIso(),
  };
  const client = await ensureTable(TABLE);
  try {
    await client.createEntity(entity);
    return entity;
  } catch (err) {
    if (isConflict(err)) {
      // Create race: another concurrent sign-in won — read its row.
      const row = await getEntityOrNull(rowKey);
      if (row) return row;
    }
    throw err;
  }
}

/** Admin override (CLI): flips the entitlement tier. */
export async function setTier(email: string, tier: Tier): Promise<void> {
  const client = await ensureTable(TABLE);
  await client.updateEntity(
    { partitionKey: PARTITION, rowKey: normalizeEmail(email), tier },
    "Merge"
  );
}

/** Admin override (CLI): block/unblock — 403 in withAuth when true. */
export async function setBlocked(email: string, blocked: boolean): Promise<void> {
  const client = await ensureTable(TABLE);
  await client.updateEntity(
    { partitionKey: PARTITION, rowKey: normalizeEmail(email), blocked },
    "Merge"
  );
}

/**
 * Single Merge write applying webhook-derived subscription state (tier,
 * Paddle identifiers, display fields, the paddleEventOccurredAt stale
 * guard) — contracts/paddle-webhook.md. The row must already exist (users
 * are created at first sign-in / migration); callers resolve the user
 * before calling this.
 */
export async function applySubscriptionState(
  email: string,
  patch: Partial<Omit<UserEntity, "partitionKey" | "rowKey">>
): Promise<void> {
  const client = await ensureTable(TABLE);
  await client.updateEntity(
    { partitionKey: PARTITION, rowKey: normalizeEmail(email), ...patch },
    "Merge"
  );
}

/** Webhook fallback resolution path: match by stored paddleCustomerId. */
export async function findByPaddleCustomerId(
  customerId: string
): Promise<UserEntity | null> {
  const client = await ensureTable(TABLE);
  const rows = client.listEntities<UserEntity>({
    queryOptions: {
      filter: `PartitionKey eq '${PARTITION}' and paddleCustomerId eq '${customerId.replace(/'/g, "''")}'`,
    },
  });
  for await (const row of rows) {
    return row;
  }
  return null;
}

/** All user rows, for the admin CLI's `list` command. */
export async function listUsers(): Promise<UserEntity[]> {
  const client = await ensureTable(TABLE);
  const rows = client.listEntities<UserEntity>({
    queryOptions: { filter: `PartitionKey eq '${PARTITION}'` },
  });
  const users: UserEntity[] = [];
  for await (const row of rows) users.push(row);
  return users;
}
