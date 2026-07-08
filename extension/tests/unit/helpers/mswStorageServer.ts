import { http, HttpResponse } from "msw";
import { setupServer, type SetupServerApi } from "msw/node";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import type { CandidateProfile, SavedJob } from "../../../types/job";

/**
 * In-memory fake of the storage API, faithful to contracts/storage-api.md:
 * same routes, status codes, error envelopes, cap/409 semantics, and export
 * shape. Contract tests and UI tests run the real fetch-backed repositories
 * against it (Constitution II: real API stubs, not hand-rolled module mocks).
 */

export const TEST_API_BASE = "http://storage.test/api";

export interface FakeStorageApi {
  server: SetupServerApi;
  /** Keyed by sha256(canonicalUrl) — same as the server's RowKey. */
  jobs: Map<string, SavedJob>;
  getProfile(): CandidateProfile | null;
  setProfile(profile: CandidateProfile | null): void;
  /** Force the next matching request to fail with the given status. */
  failNext(status: number, code?: string): void;
  /** Soft cap override so 409 paths don't need 1,000 seeded records. */
  setCap(cap: number): void;
  reset(): void;
  seededKey(canonicalUrl: string): Promise<string>;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createFakeStorageApi(): FakeStorageApi {
  const jobs = new Map<string, SavedJob>();
  let profile: CandidateProfile | null = null;
  let cap = 1_000;
  let forcedFailure: { status: number; code: string } | null = null;

  function takeForcedFailure(): HttpResponse | null {
    if (!forcedFailure) return null;
    const { status, code } = forcedFailure;
    forcedFailure = null;
    return HttpResponse.json(
      { error: { code, message: `forced ${status}` } },
      { status }
    );
  }

  const base = TEST_API_BASE;

  const server = setupServer(
    http.get(`${base}/profile`, () => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      if (!profile) {
        return HttpResponse.json(
          { error: { code: "PROFILE_NOT_FOUND", message: "none" } },
          { status: 404 }
        );
      }
      return HttpResponse.json(profile);
    }),

    http.put(`${base}/profile`, async ({ request }) => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      const body = (await request.json()) as {
        text?: unknown;
        dealbreakers?: unknown;
      };
      if (typeof body?.text !== "string" || !Array.isArray(body.dealbreakers)) {
        return HttpResponse.json(
          { error: { code: "INVALID_REQUEST", message: "bad body" } },
          { status: 400 }
        );
      }
      profile = {
        text: body.text.slice(0, 4_000),
        dealbreakers: (body.dealbreakers as string[])
          .map((d) => d.trim())
          .filter(Boolean),
        updatedAt: new Date().toISOString(),
      };
      return HttpResponse.json(profile);
    }),

    http.delete(`${base}/profile`, () => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      profile = null;
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(`${base}/jobs/export`, () => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      const sorted = [...jobs.values()].sort(
        (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)
      );
      const body = JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          jobs: sorted,
        },
        null,
        2
      );
      return new HttpResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="saved-jobs.json"',
        },
      });
    }),

    http.post(`${base}/jobs/prune`, async ({ request }) => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      const { count } = (await request.json()) as { count?: number };
      if (typeof count !== "number" || count < 1) {
        return HttpResponse.json(
          { error: { code: "INVALID_REQUEST", message: "bad count" } },
          { status: 400 }
        );
      }
      const archived = [...jobs.entries()]
        .filter(([, job]) => job.status === "archived")
        .sort(([, a], [, b]) => Date.parse(a.savedAt) - Date.parse(b.savedAt))
        .slice(0, count);
      for (const [key] of archived) jobs.delete(key);
      return HttpResponse.json({ pruned: archived.length });
    }),

    http.get(`${base}/jobs`, ({ request }) => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      const url = new URL(request.url);
      const arrangement = url.searchParams.get("arrangement");
      const status = url.searchParams.get("status");
      const filtered = [...jobs.values()]
        .filter(
          (job) =>
            (!arrangement || job.analysis.arrangement === arrangement) &&
            (!status || job.status === status)
        )
        .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
      return HttpResponse.json({ jobs: filtered });
    }),

    http.get(`${base}/jobs/:key`, ({ params }) => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      const job = jobs.get(params.key as string);
      if (!job) {
        return HttpResponse.json(
          { error: { code: "JOB_NOT_FOUND", message: "none" } },
          { status: 404 }
        );
      }
      return HttpResponse.json(job);
    }),

    http.put(`${base}/jobs/:key`, async ({ params, request }) => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      const key = params.key as string;
      const body = (await request.json()) as SavedJob;
      const existing = jobs.get(key);
      if (!existing && jobs.size >= cap) {
        return HttpResponse.json(
          { error: { code: "LIBRARY_FULL", message: "cap" } },
          { status: 409 }
        );
      }
      const stored: SavedJob = {
        ...body,
        savedAt: existing ? existing.savedAt : body.savedAt,
        updatedAt: new Date().toISOString(),
      };
      jobs.set(key, stored);
      return HttpResponse.json(stored);
    }),

    http.patch(`${base}/jobs/:key`, async ({ params, request }) => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      const key = params.key as string;
      const existing = jobs.get(key);
      if (!existing) {
        return HttpResponse.json(
          { error: { code: "JOB_NOT_FOUND", message: "none" } },
          { status: 404 }
        );
      }
      const patch = (await request.json()) as Partial<SavedJob>;
      const updated: SavedJob = {
        ...existing,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.analysis !== undefined ? { analysis: patch.analysis } : {}),
        canonicalUrl: existing.canonicalUrl,
        savedAt: existing.savedAt,
        updatedAt: new Date().toISOString(),
      };
      jobs.set(key, updated);
      return HttpResponse.json(updated);
    }),

    http.delete(`${base}/jobs/:key`, ({ params }) => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      jobs.delete(params.key as string);
      return new HttpResponse(null, { status: 204 });
    })
  );

  return {
    server,
    jobs,
    getProfile: () => profile,
    setProfile: (p) => {
      profile = p;
    },
    failNext: (status, code) => {
      forcedFailure = {
        status,
        code:
          code ??
          (status === 401
            ? "UNAUTHENTICATED"
            : status === 403
              ? "NOT_AUTHORIZED"
              : status === 409
                ? "LIBRARY_FULL"
                : "SERVICE_ERROR"),
      };
    },
    setCap: (value) => {
      cap = value;
    },
    reset: () => {
      jobs.clear();
      profile = null;
      cap = 1_000;
      forcedFailure = null;
    },
    seededKey: (canonicalUrl) => sha256Hex(canonicalUrl),
  };
}

/** Points the repositories at the fake API for the current test file. */
export function stubApiBaseGlobals(): void {
  vi.stubGlobal("WXT_API_BASE_URL", TEST_API_BASE);
  vi.stubGlobal("WXT_AZURE_FUNCTION_KEY", "");
}

/**
 * One-liner for suites that exercise UI/flows above the repositories:
 * registers the server lifecycle hooks and per-test reset + base-URL stubs.
 */
export function installFakeStorageApi(): FakeStorageApi {
  const api = createFakeStorageApi();
  beforeAll(() => api.server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => api.server.close());
  beforeEach(() => {
    api.reset();
    stubApiBaseGlobals();
  });
  return api;
}
