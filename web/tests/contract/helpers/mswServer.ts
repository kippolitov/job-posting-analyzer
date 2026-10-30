import { http, HttpResponse } from "msw";
import { setupServer, type SetupServerApi } from "msw/node";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { saveKeyFor } from "@/lib/saveKey";
import type {
  AccountPayload,
  CheckoutResult,
  DocumentAnalysisResult,
  PortalResult,
  ProfilePayload,
  SavedJobPayload,
} from "@/api/types";

/**
 * In-memory fake of the API surface the web app consumes, faithful to
 * contracts/consumed-endpoints.md and contracts/analyze-document.md
 * (Constitution II: real API stubs, not hollow mocks).
 */

export const TEST_API_BASE = "http://api.test";

type EndpointKey =
  | "jobs"
  | "profile"
  | "profile-import"
  | "profile-confirm"
  | "account"
  | "analyze-document"
  | "jobs-item"
  | "billing-checkout"
  | "billing-portal";

interface ForcedFailure {
  status: number;
  code: string;
  message: string;
  usage?: DocumentAnalysisResult["usage"];
}

export interface FakeApi {
  server: SetupServerApi;
  /** Per-endpoint call counters — used to assert zero-account-data-fetched (SC-010). */
  calls: Record<EndpointKey, number>;
  setJobs(jobs: SavedJobPayload[]): void;
  setProfile(profile: ProfilePayload | null): void;
  /** The currently stored profile (reflects PUTs). */
  getProfile(): ProfilePayload | null;
  /** The text POST /api/profile/import extracts next (contracts/profile-api.md §4). */
  setImportText(text: string): void;
  setAccount(account: AccountPayload): void;
  setDocumentResult(result: DocumentAnalysisResult): void;
  setCheckoutResult(result: CheckoutResult): void;
  setPortalResult(result: PortalResult): void;
  failNext(endpoint: EndpointKey, failure: ForcedFailure): void;
  /** Labels received by POST /api/profile/confirmed-skills, in order. */
  confirmedLabels: string[];
  /** Every PATCH /api/jobs/:key received, in order (006 rescore-in-place). */
  patches: { key: string; body: Record<string, unknown> }[];
  reset(): void;
}

const DEFAULT_ACCOUNT: AccountPayload = {
  email: "user@example.com",
  tier: "free",
  usage: { count: 0, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z" },
  subscription: null,
};

const DEFAULT_CHECKOUT_RESULT: CheckoutResult = {
  checkoutUrl: "https://sandbox-checkout.paddle.test/txn_1",
  transactionId: "txn_1",
};

const DEFAULT_PORTAL_RESULT: PortalResult = {
  portalUrl: "https://customer-portal.paddle.test/x",
};

export function createFakeApi(): FakeApi {
  let jobs: SavedJobPayload[] = [];
  let profile: ProfilePayload | null = null;
  let importText = "Imported resume text";
  let account: AccountPayload = { ...DEFAULT_ACCOUNT };
  let documentResult: DocumentAnalysisResult | null = null;
  let checkoutResult: CheckoutResult = { ...DEFAULT_CHECKOUT_RESULT };
  let portalResult: PortalResult = { ...DEFAULT_PORTAL_RESULT };
  const forced = new Map<EndpointKey, ForcedFailure>();
  const patches: { key: string; body: Record<string, unknown> }[] = [];
  const confirmedLabels: string[] = [];
  const calls: Record<EndpointKey, number> = {
    jobs: 0,
    profile: 0,
    "profile-import": 0,
    "profile-confirm": 0,
    account: 0,
    "analyze-document": 0,
    "jobs-item": 0,
    "billing-checkout": 0,
    "billing-portal": 0,
  };

  function takeForced(endpoint: EndpointKey): HttpResponse | null {
    calls[endpoint]++;
    const failure = forced.get(endpoint);
    if (!failure) return null;
    forced.delete(endpoint);
    return HttpResponse.json(
      { error: { code: failure.code, message: failure.message }, ...(failure.usage ? { usage: failure.usage } : {}) },
      { status: failure.status }
    );
  }

  const server = setupServer(
    http.get(`${TEST_API_BASE}/jobs`, () => takeForced("jobs") ?? HttpResponse.json({ jobs })),

    http.get(`${TEST_API_BASE}/profile`, () => {
      const failure = takeForced("profile");
      if (failure) return failure;
      return profile
        ? HttpResponse.json(profile)
        : HttpResponse.json(
            { error: { code: "PROFILE_NOT_FOUND", message: "No profile is stored." } },
            { status: 404 }
          );
    }),

    http.put(`${TEST_API_BASE}/profile`, async ({ request }) => {
      const failure = takeForced("profile");
      if (failure) return failure;
      const body = (await request.json()) as {
        text: string;
        dealbreakers: string[];
        preferences?: ProfilePayload["preferences"];
        confirmedSkills?: string[];
      };
      // Merge semantics (contracts/profile-api.md §2): omitted keeps, [] clears.
      const skills = body.confirmedSkills ?? profile?.confirmedSkills;
      profile = {
        ...body,
        ...(skills && skills.length > 0 ? { confirmedSkills: skills } : {}),
        updatedAt: new Date().toISOString(),
        schemaVersion: 1,
      };
      if (!(skills && skills.length > 0)) delete profile.confirmedSkills;
      return HttpResponse.json(profile);
    }),

    http.post(`${TEST_API_BASE}/profile/confirmed-skills`, async ({ request }) => {
      const failure = takeForced("profile-confirm");
      if (failure) return failure;
      const { label } = (await request.json()) as { label: string };
      confirmedLabels.push(label);
      if (!profile) {
        return HttpResponse.json(
          { error: { code: "PROFILE_NOT_FOUND", message: "No profile is stored." } },
          { status: 404 }
        );
      }
      const skills = profile.confirmedSkills ?? [];
      if (!skills.some((s) => s.toLowerCase() === label.trim().toLowerCase())) {
        // A new fingerprint, as the server derives one from the new serialization.
        profile = {
          ...profile,
          confirmedSkills: [...skills, label.trim()],
          fingerprint: String(skills.length + 1).padStart(64, "n"),
        };
      }
      return HttpResponse.json(profile);
    }),

    http.post(`${TEST_API_BASE}/profile/import`, () => {
      const failure = takeForced("profile-import");
      if (failure) return failure;
      return HttpResponse.json({ text: importText, charCount: importText.length });
    }),

    http.get(`${TEST_API_BASE}/account`, () => takeForced("account") ?? HttpResponse.json(account)),

    http.put(`${TEST_API_BASE}/jobs/:key`, async ({ request }) => {
      const failure = takeForced("jobs-item");
      if (failure) return failure;
      const body = (await request.json()) as SavedJobPayload;
      jobs = [body, ...jobs.filter((j) => j.canonicalUrl !== body.canonicalUrl)];
      return HttpResponse.json(body);
    }),

    http.patch(`${TEST_API_BASE}/jobs/:key`, async ({ request, params }) => {
      const failure = takeForced("jobs-item");
      if (failure) return failure;
      const body = (await request.json()) as Record<string, unknown>;
      const key = String(params.key);
      patches.push({ key, body });
      const keys = await Promise.all(jobs.map((j) => saveKeyFor(j.canonicalUrl)));
      const index = keys.indexOf(key);
      if (index < 0) {
        return HttpResponse.json(
          { error: { code: "NOT_FOUND", message: "No such posting." } },
          { status: 404 }
        );
      }
      const merged = {
        ...jobs[index]!,
        ...body,
        updatedAt: new Date().toISOString(),
      } as SavedJobPayload;
      jobs = jobs.map((j, i) => (i === index ? merged : j));
      return HttpResponse.json(merged);
    }),

    http.post(`${TEST_API_BASE}/analyze-document`, () => {
      const failure = takeForced("analyze-document");
      if (failure) return failure;
      return HttpResponse.json(documentResult);
    }),

    http.post(`${TEST_API_BASE}/billing/checkout`, () => {
      const failure = takeForced("billing-checkout");
      if (failure) return failure;
      return HttpResponse.json(checkoutResult);
    }),

    http.post(`${TEST_API_BASE}/billing/portal`, () => {
      const failure = takeForced("billing-portal");
      if (failure) return failure;
      return HttpResponse.json(portalResult);
    })
  );

  return {
    server,
    calls,
    patches,
    confirmedLabels,
    setJobs: (next) => {
      jobs = next;
    },
    setProfile: (next) => {
      profile = next;
    },
    getProfile: () => profile,
    setImportText: (next) => {
      importText = next;
    },
    setAccount: (next) => {
      account = next;
    },
    setDocumentResult: (next) => {
      documentResult = next;
    },
    setCheckoutResult: (next) => {
      checkoutResult = next;
    },
    setPortalResult: (next) => {
      portalResult = next;
    },
    failNext: (endpoint, failure) => {
      forced.set(endpoint, failure);
    },
    reset: () => {
      jobs = [];
      profile = null;
      importText = "Imported resume text";
      account = { ...DEFAULT_ACCOUNT };
      documentResult = null;
      checkoutResult = { ...DEFAULT_CHECKOUT_RESULT };
      portalResult = { ...DEFAULT_PORTAL_RESULT };
      forced.clear();
      patches.length = 0;
      confirmedLabels.length = 0;
      for (const key of Object.keys(calls) as EndpointKey[]) calls[key] = 0;
    },
  };
}

export function installFakeApi(): FakeApi {
  const api = createFakeApi();
  beforeAll(() => api.server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => api.server.close());
  beforeEach(() => {
    api.reset();
    vi.stubEnv("VITE_API_BASE_URL", TEST_API_BASE);
  });
  return api;
}
