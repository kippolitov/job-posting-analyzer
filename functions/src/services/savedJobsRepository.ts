import { createHash } from "node:crypto";
import { RestError } from "@azure/data-tables";
import type {
  Arrangement,
  JobStatus,
  SavedJobAnalysis,
  SavedJobEntity,
  SavedJobPatchBody,
  SavedJobPayload,
} from "../models/user";
import { SAVED_JOBS_SOFT_CAP } from "../models/user";
import {
  decodeJsonProperty,
  encodeJsonProperty,
  ensureTable,
  nowIso,
} from "./tablesService";

export { SAVED_JOBS_SOFT_CAP };

/**
 * SavedJobs table CRUD (data-model.md): PK = Google sub, RK = server-computed
 * sha256(canonicalUrl) — identical to the client's canonicalKey() digest, and
 * recomputed here so a client cannot plant mismatched keys (research.md R3).
 * Upserts are last-write-wins per record (spec concurrency edge case).
 */

const TABLE = "SavedJobs";

/** The partition is at the soft cap and the save would create a new row. */
export class LibraryCapError extends Error {
  constructor() {
    super(`Library is at the ${SAVED_JOBS_SOFT_CAP.toLocaleString()}-posting cap.`);
  }
}

/** `{key}` in the URL does not equal sha256(body.canonicalUrl). */
export class KeyMismatchError extends Error {
  constructor() {
    super("The job key does not match the canonical URL.");
  }
}

/** PATCH tried to change an immutable field (canonicalUrl, savedAt). */
export class ImmutableFieldError extends Error {
  constructor(field: string) {
    super(`${field} is immutable.`);
  }
}

export interface JobListFilter {
  arrangement?: Arrangement;
  status?: JobStatus;
}

export interface JobsExport {
  schemaVersion: 1;
  exportedAt: string;
  jobs: SavedJobPayload[];
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 404;
}

function entityFromPayload(
  sub: string,
  key: string,
  payload: SavedJobPayload,
  savedAt: string,
  updatedAt: string
): SavedJobEntity {
  return {
    partitionKey: sub,
    rowKey: key,
    canonicalUrl: payload.canonicalUrl,
    sourceUrl: payload.sourceUrl,
    title: payload.analysis.title ?? "",
    company: payload.analysis.company ?? "",
    arrangement: payload.analysis.arrangement,
    status: payload.status,
    notes: payload.notes,
    analysisJson: encodeJsonProperty(payload.analysis),
    savedAt,
    updatedAt,
    schemaVersion: payload.schemaVersion,
  };
}

function payloadFromEntity(entity: SavedJobEntity): SavedJobPayload {
  return {
    schemaVersion: entity.schemaVersion,
    canonicalUrl: entity.canonicalUrl,
    sourceUrl: entity.sourceUrl,
    analysis: decodeJsonProperty<SavedJobAnalysis>(
      entity.analysisJson,
      {} as SavedJobAnalysis
    ),
    status: entity.status as JobStatus,
    notes: entity.notes,
    savedAt: entity.savedAt,
    updatedAt: entity.updatedAt,
  };
}

async function getEntityOrNull(
  sub: string,
  key: string
): Promise<SavedJobEntity | null> {
  const client = await ensureTable(TABLE);
  try {
    return await client.getEntity<SavedJobEntity>(sub, key);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function getJob(
  sub: string,
  key: string
): Promise<SavedJobPayload | null> {
  const entity = await getEntityOrNull(sub, key);
  return entity ? payloadFromEntity(entity) : null;
}

export async function countJobs(sub: string): Promise<number> {
  const client = await ensureTable(TABLE);
  let count = 0;
  const rows = client.listEntities<SavedJobEntity>({
    queryOptions: {
      filter: `PartitionKey eq '${sub.replace(/'/g, "''")}'`,
      select: ["rowKey"],
    },
  });
  for await (const _row of rows) count++;
  return count;
}

/**
 * Create or full replace (LWW). Preserves the stored savedAt on replace and
 * always sets updatedAt server-side. A new row beyond the soft cap throws
 * LibraryCapError; replaces are always allowed (contract PUT semantics).
 */
export async function saveJob(
  sub: string,
  key: string,
  payload: SavedJobPayload
): Promise<SavedJobPayload> {
  if (sha256Hex(payload.canonicalUrl) !== key) {
    throw new KeyMismatchError();
  }
  const existing = await getEntityOrNull(sub, key);
  if (!existing && (await countJobs(sub)) >= SAVED_JOBS_SOFT_CAP) {
    throw new LibraryCapError();
  }
  const savedAt = existing ? existing.savedAt : payload.savedAt;
  const updatedAt = nowIso();
  const client = await ensureTable(TABLE);
  await client.upsertEntity(
    entityFromPayload(sub, key, payload, savedAt, updatedAt),
    "Replace"
  );
  return { ...payload, savedAt, updatedAt };
}

export async function listJobs(
  sub: string,
  filter: JobListFilter
): Promise<SavedJobPayload[]> {
  const client = await ensureTable(TABLE);
  const clauses = [`PartitionKey eq '${sub.replace(/'/g, "''")}'`];
  if (filter.arrangement) clauses.push(`arrangement eq '${filter.arrangement}'`);
  if (filter.status) clauses.push(`status eq '${filter.status}'`);
  const rows = client.listEntities<SavedJobEntity>({
    queryOptions: { filter: clauses.join(" and ") },
  });
  const jobs: SavedJobPayload[] = [];
  for await (const row of rows) {
    jobs.push(payloadFromEntity(row));
  }
  // Table Storage has no server-side sort; per-user partitions are ≤ 1,000
  // rows, so sorting in the handler is trivial (plan.md Risks).
  jobs.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  return jobs;
}

/**
 * Partial update of status/notes/analysis. Returns null when the record does
 * not exist. canonicalUrl and savedAt are immutable: echoing the stored value
 * back is tolerated, changing it throws ImmutableFieldError.
 */
export async function patchJob(
  sub: string,
  key: string,
  patch: SavedJobPatchBody
): Promise<SavedJobPayload | null> {
  const existing = await getEntityOrNull(sub, key);
  if (!existing) return null;
  if (patch.canonicalUrl !== undefined && patch.canonicalUrl !== existing.canonicalUrl) {
    throw new ImmutableFieldError("canonicalUrl");
  }
  if (patch.savedAt !== undefined && patch.savedAt !== existing.savedAt) {
    throw new ImmutableFieldError("savedAt");
  }
  const current = payloadFromEntity(existing);
  const updated: SavedJobPayload = {
    ...current,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.analysis !== undefined ? { analysis: patch.analysis } : {}),
    canonicalUrl: current.canonicalUrl,
    savedAt: current.savedAt,
    updatedAt: nowIso(),
  };
  const client = await ensureTable(TABLE);
  await client.upsertEntity(
    entityFromPayload(sub, key, updated, updated.savedAt, updated.updatedAt),
    "Replace"
  );
  return updated;
}

export async function deleteJob(sub: string, key: string): Promise<void> {
  const client = await ensureTable(TABLE);
  try {
    await client.deleteEntity(sub, key);
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
}

export async function exportJobs(sub: string): Promise<JobsExport> {
  return {
    schemaVersion: 1,
    exportedAt: nowIso(),
    jobs: await listJobs(sub, {}),
  };
}

/** Deletes the user's oldest-savedAt archived rows, up to count. */
export async function pruneArchived(sub: string, count: number): Promise<number> {
  const archived = await listJobs(sub, { status: "archived" });
  const oldestFirst = [...archived].sort(
    (a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt)
  );
  const victims = oldestFirst.slice(0, count);
  for (const job of victims) {
    await deleteJob(sub, sha256Hex(job.canonicalUrl));
  }
  return victims.length;
}
