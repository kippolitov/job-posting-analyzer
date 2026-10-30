import { http, HttpResponse } from "msw";
import { setupServer, type SetupServerApi } from "msw/node";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import type { CandidateProfile, SavedJob } from "../../../types/job";
import { profileToPromptText, type Preferences } from "../../../../shared/types/profile";

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
  /** GET /api/account tier — free by default (contracts/billing-api.md). */
  setAccountTier(tier: "free" | "premium"): void;
  /** GET /api/account usage overrides, e.g. rescore counts (006 FR-004a). */
  setAccountUsage(usage: Partial<AccountUsage>): void;
  /** What POST /api/profile/import answers next; default is a 200 with some text. */
  setImportResponse(response: { status: number; body: unknown }): void;
  /** Number of POST /api/profile/import calls received. */
  importCalls(): number;
  reset(): void;
  seededKey(canonicalUrl: string): Promise<string>;
}

interface AccountUsage {
  count: number;
  limit: number;
  resetsAt: string;
  rescoresUsed: number;
  rescoresLimit: number;
}

/** The server's profile fingerprint (006 research R5), recomputed the same way. */
export async function fakeFingerprint(profile: {
  text: string;
  dealbreakers: string[];
  preferences?: Preferences;
}): Promise<string> {
  return sha256Hex(profileToPromptText(profile).replace(/\s+/g, " ").trim());
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

function mergedPreferences(
  stored: Preferences | undefined,
  sent: Preferences | null | undefined
): { preferences?: Preferences } {
  const next = sent === undefined ? stored : (sent ?? undefined);
  return next ? { preferences: next } : {};
}

export function createFakeStorageApi(): FakeStorageApi {
  const jobs = new Map<string, SavedJob>();
  let profile: CandidateProfile | null = null;
  let cap = 1_000;
  let accountTier: "free" | "premium" = "free";
  let accountUsage: Partial<AccountUsage> = {};
  let forcedFailure: { status: number; code: string } | null = null;
  const DEFAULT_IMPORT = { status: 200, body: { text: "Imported resume text", charCount: 20 } };
  let importResponse: { status: number; body: unknown } = DEFAULT_IMPORT;
  let importCalls = 0;

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
    http.get(`${base}/profile`, async () => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      if (!profile) {
        return HttpResponse.json(
          { error: { code: "PROFILE_NOT_FOUND", message: "none" } },
          { status: 404 }
        );
      }
      return HttpResponse.json({ ...profile, fingerprint: await fakeFingerprint(profile) });
    }),

    http.put(`${base}/profile`, async ({ request }) => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      const body = (await request.json()) as {
        text?: unknown;
        dealbreakers?: unknown;
        preferences?: Preferences | null;
      };
      if (typeof body?.text !== "string" || !Array.isArray(body.dealbreakers)) {
        return HttpResponse.json(
          { error: { code: "INVALID_REQUEST", message: "bad body" } },
          { status: 400 }
        );
      }
      profile = {
        text: body.text.slice(0, 20_000),
        dealbreakers: (body.dealbreakers as string[])
          .map((d) => d.trim())
          .filter(Boolean),
        updatedAt: new Date().toISOString(),
        // Merge semantics (contracts/profile-api.md §2): omitted keeps, null clears.
        ...mergedPreferences(profile?.preferences, body.preferences),
      };
      return HttpResponse.json({ ...profile, fingerprint: await fakeFingerprint(profile) });
    }),

    http.post(`${base}/profile/import`, () => {
      importCalls += 1;
      return HttpResponse.json(importResponse.body as Record<string, unknown>, { status: importResponse.status });
    }),

    http.delete(`${base}/profile`, () => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      profile = null;
      return new HttpResponse(null, { status: 204 });
    }),

    // Minimal AccountBar support (contracts/billing-api.md) — a fixed free
    // account with no usage. Deliberately does not consume failNext()/setCap
    // state: those are for the jobs/profile contract this fake exists to
    // serve, and account fetches race jobs/profile fetches on every mount,
    // so sharing the single-shot failure switch would make failures land on
    // whichever request wins the race. Suites that exercise billing failure
    // behavior use the dedicated mswAccountServer fake instead.
    http.get(`${base}/account`, () => {
      return HttpResponse.json({
        email: "user@example.com",
        tier: accountTier,
        usage: {
          count: 0,
          limit: accountTier === "premium" ? 300 : 50,
          resetsAt: "2026-08-01T00:00:00Z",
          rescoresUsed: 0,
          rescoresLimit: 10,
          ...accountUsage,
        },
        subscription:
          accountTier === "premium"
            ? { status: "active", renewsAt: "2026-08-03T00:00:00Z", endsAt: null }
            : null,
      });
    }),

    http.post(`${base}/billing/checkout`, () =>
      HttpResponse.json({
        checkoutUrl: "https://sandbox-checkout.paddle.test/txn_1",
        transactionId: "txn_1",
      })
    ),

    http.post(`${base}/billing/portal`, () =>
      HttpResponse.json(
        { error: { code: "NO_SUBSCRIPTION", message: "no subscription" } },
        { status: 404 }
      )
    ),

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
          {
            error: {
              code: "LIBRARY_FULL",
              message:
                `Library is at the ${cap.toLocaleString()}-posting cap. ` +
                "Upgrade to Premium for a 1,000-job library, or remove a posting to save this one.",
            },
          },
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
      // contracts/saved-jobs-api.md: writing an analysis always clears the flag.
      const { unavailableAt: _previous, ...rest } = existing;
      const unavailableAt =
        patch.analysis !== undefined
          ? null
          : patch.unavailableAt !== undefined
            ? patch.unavailableAt
            : (existing.unavailableAt ?? null);
      const updated: SavedJob = {
        ...rest,
        ...(unavailableAt ? { unavailableAt } : {}),
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
    setAccountTier: (tier) => {
      accountTier = tier;
    },
    setAccountUsage: (usage) => {
      accountUsage = usage;
    },
    reset: () => {
      jobs.clear();
      profile = null;
      cap = 1_000;
      accountTier = "free";
      accountUsage = {};
      forcedFailure = null;
      importResponse = DEFAULT_IMPORT;
      importCalls = 0;
    },
    setImportResponse: (next) => {
      importResponse = next;
    },
    importCalls: () => importCalls,
    seededKey: (canonicalUrl) => sha256Hex(canonicalUrl),
  };
}

/** Points the repositories at the fake API for the current test file. */
export function stubApiBaseGlobals(): void {
  vi.stubGlobal("WXT_API_BASE_URL", TEST_API_BASE);
  vi.stubGlobal("WXT_AZURE_FUNCTION_KEY", "");
  vi.stubGlobal("WXT_WEB_APP_URL", "https://web-app.test");
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
