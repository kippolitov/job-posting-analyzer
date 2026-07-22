import { http, HttpResponse } from "msw";
import { setupServer, type SetupServerApi } from "msw/node";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
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
  setAccount(account: AccountPayload): void;
  setDocumentResult(result: DocumentAnalysisResult): void;
  setCheckoutResult(result: CheckoutResult): void;
  setPortalResult(result: PortalResult): void;
  failNext(endpoint: EndpointKey, failure: ForcedFailure): void;
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
  let account: AccountPayload = { ...DEFAULT_ACCOUNT };
  let documentResult: DocumentAnalysisResult | null = null;
  let checkoutResult: CheckoutResult = { ...DEFAULT_CHECKOUT_RESULT };
  let portalResult: PortalResult = { ...DEFAULT_PORTAL_RESULT };
  const forced = new Map<EndpointKey, ForcedFailure>();
  const calls: Record<EndpointKey, number> = {
    jobs: 0,
    profile: 0,
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
      const body = (await request.json()) as { text: string; dealbreakers: string[] };
      profile = { ...body, updatedAt: new Date().toISOString(), schemaVersion: 1 };
      return HttpResponse.json(profile);
    }),

    http.get(`${TEST_API_BASE}/account`, () => takeForced("account") ?? HttpResponse.json(account)),

    http.put(`${TEST_API_BASE}/jobs/:key`, async ({ request }) => {
      const failure = takeForced("jobs-item");
      if (failure) return failure;
      const body = (await request.json()) as SavedJobPayload;
      jobs = [body, ...jobs.filter((j) => j.canonicalUrl !== body.canonicalUrl)];
      return HttpResponse.json(body);
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
    setJobs: (next) => {
      jobs = next;
    },
    setProfile: (next) => {
      profile = next;
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
      account = { ...DEFAULT_ACCOUNT };
      documentResult = null;
      checkoutResult = { ...DEFAULT_CHECKOUT_RESULT };
      portalResult = { ...DEFAULT_PORTAL_RESULT };
      forced.clear();
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
