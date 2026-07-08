import { RestError } from "@azure/data-tables";
import { ensureTable } from "./tablesService";

/**
 * AllowedUsers table access (data-model.md): PK "AllowedUser", RK lowercased
 * email. Read per request by the auth middleware — uncached, so removals take
 * effect on the very next request (SC-006).
 */

const TABLE = "AllowedUsers";
const PARTITION = "AllowedUser";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 404;
}

export async function isAllowed(email: string): Promise<boolean> {
  const client = await ensureTable(TABLE);
  try {
    await client.getEntity(PARTITION, normalizeEmail(email));
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/**
 * Records the account's stable `sub` on its allowlist row the first time the
 * account signs in (Merge update). No-ops when the row is absent or the sub
 * is already recorded — the first-seen sub is authoritative.
 */
export async function recordSignIn(email: string, sub: string): Promise<void> {
  const client = await ensureTable(TABLE);
  const rowKey = normalizeEmail(email);
  let existingSub: unknown;
  try {
    const row = await client.getEntity(PARTITION, rowKey);
    existingSub = row.sub;
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
  if (typeof existingSub === "string" && existingSub.length > 0) return;
  await client.updateEntity({ partitionKey: PARTITION, rowKey, sub }, "Merge");
}
