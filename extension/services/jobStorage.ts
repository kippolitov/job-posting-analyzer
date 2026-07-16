import { canonicalKey } from "../lib/canonicalUrl";
import type { Arrangement, JobStatus, SavedJob } from "../types/job";
import { ApiError, apiFetch } from "./api/apiClient";

/**
 * The library hit its tier cap (100 free / 1,000 premium — data-model.md);
 * the server names the exact cap and the tier-appropriate action (upgrade
 * vs. prune/export) in `message`, so the UI never hardcodes a number.
 */
export class LibraryFullError extends Error {}

export interface JobListFilter {
  arrangement?: Arrangement;
  status?: JobStatus;
}

/**
 * Saved-jobs repository. Same interface as the original chrome.storage.local
 * implementation — since 002 it is backed by the per-account server store
 * (contracts/storage-api.md), so the library follows the signed-in user
 * across devices. UI code above this interface is unchanged.
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

async function get(canonicalUrl: string): Promise<SavedJob | null> {
  const key = await canonicalKey(canonicalUrl);
  const response = await apiFetch(`/jobs/${key}`);
  if (response.status === 404) return null;
  if (!response.ok) await throwUnexpected(response);
  return (await response.json()) as SavedJob;
}

async function list(filter?: JobListFilter): Promise<SavedJob[]> {
  const params = new URLSearchParams();
  if (filter?.arrangement) params.set("arrangement", filter.arrangement);
  if (filter?.status) params.set("status", filter.status);
  const query = params.toString();
  const response = await apiFetch(`/jobs${query ? `?${query}` : ""}`);
  if (!response.ok) await throwUnexpected(response);
  const body = (await response.json()) as { jobs: SavedJob[] };
  return body.jobs;
}

async function save(job: SavedJob): Promise<void> {
  const key = await canonicalKey(job.canonicalUrl);
  const response = await apiFetch(`/jobs/${key}`, { method: "PUT", body: job });
  if (response.status === 409) {
    let message = "Your library is full. Export it or remove a posting to save this one.";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the generic message.
    }
    throw new LibraryFullError(message);
  }
  if (!response.ok) await throwUnexpected(response);
}

async function update(
  canonicalUrl: string,
  patch: Partial<SavedJob>
): Promise<void> {
  const key = await canonicalKey(canonicalUrl);
  const response = await apiFetch(`/jobs/${key}`, {
    method: "PATCH",
    body: {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.analysis !== undefined ? { analysis: patch.analysis } : {}),
    },
  });
  // Matches the previous local semantics: updating a missing record is a no-op.
  if (response.status === 404) return;
  if (!response.ok) await throwUnexpected(response);
}

async function remove(canonicalUrl: string): Promise<void> {
  const key = await canonicalKey(canonicalUrl);
  const response = await apiFetch(`/jobs/${key}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) await throwUnexpected(response);
}

async function exportAll(): Promise<string> {
  const response = await apiFetch("/jobs/export");
  if (!response.ok) await throwUnexpected(response);
  // Raw text: the server emits the byte-exact legacy export format (FR-009).
  return response.text();
}

async function pruneArchived(count: number): Promise<number> {
  const response = await apiFetch("/jobs/prune", {
    method: "POST",
    body: { count },
  });
  if (!response.ok) await throwUnexpected(response);
  const body = (await response.json()) as { pruned: number };
  return body.pruned;
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
