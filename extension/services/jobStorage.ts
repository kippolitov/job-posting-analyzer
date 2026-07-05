import { canonicalKey } from "../lib/canonicalUrl";
import type { Arrangement, JobStatus, SavedJob } from "../types/job";

const INDEX_KEY = "job:index";
const JOB_KEY_PREFIX = "job:";

export const SAVED_JOBS_SOFT_CAP = 1_000;

/** The library hit the soft cap; the UI offers export + prune-archived. */
export class LibraryFullError extends Error {
  constructor() {
    super(
      `Your library is full (${SAVED_JOBS_SOFT_CAP.toLocaleString()} postings). Export it or prune archived postings to save more.`
    );
  }
}

export interface JobListFilter {
  arrangement?: Arrangement;
  status?: JobStatus;
}

interface JobIndexEntry {
  canonicalUrl: string;
  savedAt: string;
  arrangement: Arrangement;
  status: JobStatus;
}

type JobIndex = Record<string, JobIndexEntry>;

/**
 * Saved-jobs repository. All access goes through this interface so the
 * chrome.storage.local backing can later swap to a server-side store
 * without touching UI code (see research.md R5).
 */
export interface JobRepository {
  get(canonicalUrl: string): Promise<SavedJob | null>;
  list(filter?: JobListFilter): Promise<SavedJob[]>;
  save(job: SavedJob): Promise<void>;
  update(canonicalUrl: string, patch: Partial<SavedJob>): Promise<void>;
  remove(canonicalUrl: string): Promise<void>;
  exportAll(): Promise<string>;
  pruneArchived(count: number): Promise<number>;
}

async function jobKey(canonicalUrl: string): Promise<string> {
  return `${JOB_KEY_PREFIX}${await canonicalKey(canonicalUrl)}`;
}

function isIndex(value: unknown): value is JobIndex {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value as Record<string, unknown>).every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as JobIndexEntry).canonicalUrl === "string"
    )
  );
}

async function readIndex(): Promise<JobIndex> {
  const data = await chrome.storage.local.get(INDEX_KEY);
  const index = data[INDEX_KEY];
  if (isIndex(index)) return index;
  return rebuildIndex();
}

/** Recovers the index by scanning job:* records (self-healing invariant). */
async function rebuildIndex(): Promise<JobIndex> {
  const all = await chrome.storage.local.get(null);
  const index: JobIndex = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(JOB_KEY_PREFIX) || key === INDEX_KEY) continue;
    const job = value as SavedJob;
    if (typeof job?.canonicalUrl !== "string") continue;
    index[key.slice(JOB_KEY_PREFIX.length)] = indexEntryOf(job);
  }
  await chrome.storage.local.set({ [INDEX_KEY]: index });
  return index;
}

function indexEntryOf(job: SavedJob): JobIndexEntry {
  return {
    canonicalUrl: job.canonicalUrl,
    savedAt: job.savedAt,
    arrangement: job.analysis.arrangement,
    status: job.status,
  };
}

async function get(canonicalUrl: string): Promise<SavedJob | null> {
  const key = await jobKey(canonicalUrl);
  const data = await chrome.storage.local.get(key);
  return (data[key] as SavedJob | undefined) ?? null;
}

async function list(filter?: JobListFilter): Promise<SavedJob[]> {
  const index = await readIndex();
  const hashes = Object.entries(index)
    .filter(
      ([, entry]) =>
        (!filter?.arrangement || entry.arrangement === filter.arrangement) &&
        (!filter?.status || entry.status === filter.status)
    )
    .sort(([, a], [, b]) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .map(([hash]) => hash);

  if (hashes.length === 0) return [];
  const keys = hashes.map((hash) => `${JOB_KEY_PREFIX}${hash}`);
  const records = await chrome.storage.local.get(keys);
  return keys
    .map((key) => records[key] as SavedJob | undefined)
    .filter((job): job is SavedJob => job !== undefined);
}

async function save(job: SavedJob): Promise<void> {
  const key = await jobKey(job.canonicalUrl);
  const hash = key.slice(JOB_KEY_PREFIX.length);
  const index = await readIndex();

  const isNew = !(hash in index);
  if (isNew && Object.keys(index).length >= SAVED_JOBS_SOFT_CAP) {
    throw new LibraryFullError();
  }

  index[hash] = indexEntryOf(job);
  // Single set call keeps the record and index atomic.
  await chrome.storage.local.set({ [key]: job, [INDEX_KEY]: index });
}

async function update(
  canonicalUrl: string,
  patch: Partial<SavedJob>
): Promise<void> {
  const existing = await get(canonicalUrl);
  if (!existing) return;
  const updated: SavedJob = {
    ...existing,
    ...patch,
    canonicalUrl: existing.canonicalUrl,
    savedAt: existing.savedAt,
    updatedAt: new Date().toISOString(),
  };
  const key = await jobKey(canonicalUrl);
  const index = await readIndex();
  index[key.slice(JOB_KEY_PREFIX.length)] = indexEntryOf(updated);
  await chrome.storage.local.set({ [key]: updated, [INDEX_KEY]: index });
}

async function remove(canonicalUrl: string): Promise<void> {
  const key = await jobKey(canonicalUrl);
  const index = await readIndex();
  delete index[key.slice(JOB_KEY_PREFIX.length)];
  await chrome.storage.local.remove(key);
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

async function exportAll(): Promise<string> {
  const jobs = await list();
  return JSON.stringify(
    { schemaVersion: 1, exportedAt: new Date().toISOString(), jobs },
    null,
    2
  );
}

async function pruneArchived(count: number): Promise<number> {
  const archived = await list({ status: "archived" });
  const oldestFirst = [...archived].sort(
    (a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt)
  );
  const victims = oldestFirst.slice(0, count);
  for (const job of victims) {
    await remove(job.canonicalUrl);
  }
  return victims.length;
}

export const jobStorage: JobRepository = {
  get,
  list,
  save,
  update,
  remove,
  exportAll,
  pruneArchived,
};
