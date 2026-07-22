import { fetchJobs } from "@/api/endpoints";
import type { SavedJobPayload } from "@/api/types";

/**
 * Fetch-once, in-memory cache of the signed-in user's library (FR-007: the
 * web app fetches GET /api/jobs once and does search/filter/sort/compare
 * entirely client-side). Shared by Library, PostingDetail, and CompareGrid
 * so navigating between them never re-fetches.
 */
export type LibraryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; jobs: SavedJobPayload[] }
  | { status: "error"; message: string };

let state: LibraryState = { status: "idle" };
const listeners = new Set<(state: LibraryState) => void>();

function setState(next: LibraryState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

export function getLibraryState(): LibraryState {
  return state;
}

export function subscribeLibrary(listener: (state: LibraryState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadLibrary(force = false): Promise<void> {
  if (!force && (state.status === "loading" || state.status === "loaded")) return;
  setState({ status: "loading" });
  try {
    const jobs = await fetchJobs();
    setState({ status: "loaded", jobs });
  } catch (err) {
    setState({
      status: "error",
      message: err instanceof Error ? err.message : "Couldn't load your library.",
    });
  }
}

/** Replaces a single row after a successful save (US5) without a full re-fetch. */
export function upsertLibraryJob(job: SavedJobPayload): void {
  if (state.status !== "loaded") return;
  const withoutExisting = state.jobs.filter((j) => j.canonicalUrl !== job.canonicalUrl);
  setState({ status: "loaded", jobs: [job, ...withoutExisting] });
}

/** Cleared on sign-out so a different account never sees stale cached data. */
export function resetLibrary(): void {
  state = { status: "idle" };
}
