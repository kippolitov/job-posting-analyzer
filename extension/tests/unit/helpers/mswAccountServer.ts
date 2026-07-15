import { http, HttpResponse } from "msw";
import { setupServer, type SetupServerApi } from "msw/node";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import type { AccountState } from "../../../services/accountService";

/**
 * In-memory fake of the account/billing API, faithful to
 * contracts/billing-api.md: GET /api/account, POST /api/billing/checkout,
 * POST /api/billing/portal (Constitution II: real API stubs).
 */

export const TEST_API_BASE = "http://storage.test/api";

export interface FakeAccountApi {
  server: SetupServerApi;
  setAccount(account: AccountState): void;
  /** Simulates the webhook flipping tier — the very next GET reflects it. */
  setTier(tier: AccountState["tier"]): void;
  failNext(status: number, code?: string): void;
  reset(): void;
}

const DEFAULT_ACCOUNT: AccountState = {
  email: "user@example.com",
  tier: "free",
  usage: { count: 0, limit: 50, resetsAt: "2026-08-01T00:00:00Z" },
  subscription: null,
};

export function createFakeAccountApi(): FakeAccountApi {
  let account: AccountState = { ...DEFAULT_ACCOUNT };
  let forcedFailure: { status: number; code: string } | null = null;

  function takeForcedFailure(): HttpResponse | null {
    if (!forcedFailure) return null;
    const { status, code } = forcedFailure;
    forcedFailure = null;
    return HttpResponse.json({ error: { code, message: `forced ${status}` } }, { status });
  }

  const base = TEST_API_BASE;

  const server = setupServer(
    http.get(`${base}/account`, () => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      return HttpResponse.json(account);
    }),

    http.post(`${base}/billing/checkout`, () => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      if (account.tier === "premium") {
        return HttpResponse.json(
          { error: { code: "ALREADY_PREMIUM", message: "already premium" } },
          { status: 409 }
        );
      }
      return HttpResponse.json({
        checkoutUrl: "https://sandbox-checkout.paddle.test/txn_1",
        transactionId: "txn_1",
      });
    }),

    http.post(`${base}/billing/portal`, () => {
      const failure = takeForcedFailure();
      if (failure) return failure;
      if (!account.subscription) {
        return HttpResponse.json(
          { error: { code: "NO_SUBSCRIPTION", message: "no subscription" } },
          { status: 404 }
        );
      }
      return HttpResponse.json({ portalUrl: "https://customer-portal.paddle.test/x" });
    })
  );

  return {
    server,
    setAccount: (next) => {
      account = next;
    },
    setTier: (tier) => {
      account = { ...account, tier };
    },
    failNext: (status, code) => {
      forcedFailure = {
        status,
        code: code ?? (status === 404 ? "NO_SUBSCRIPTION" : "SERVICE_ERROR"),
      };
    },
    reset: () => {
      account = { ...DEFAULT_ACCOUNT };
      forcedFailure = null;
    },
  };
}

export function stubApiBaseGlobals(): void {
  vi.stubGlobal("WXT_API_BASE_URL", TEST_API_BASE);
  vi.stubGlobal("WXT_AZURE_FUNCTION_KEY", "");
}

export function installFakeAccountApi(): FakeAccountApi {
  const api = createFakeAccountApi();
  beforeAll(() => api.server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => api.server.close());
  beforeEach(() => {
    api.reset();
    stubApiBaseGlobals();
  });
  return api;
}
