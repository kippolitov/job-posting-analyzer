import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { withAuth } from "../../src/services/auth";
import {
  accountHandler,
  billingCheckoutHandler,
  billingPortalHandler,
} from "../../src/billing/index";
import { getOrCreate, setTier, applySubscriptionState } from "../../src/services/usersStore";
import { checkAndIncrement } from "../../src/services/meteringService";
import { MONTHLY_ANALYSES } from "../../src/models/user";
import { startCertsStub, stopCertsStub, signTestIdToken, TEST_CLIENT_ID } from "../helpers/testTokens";

const account = withAuth(accountHandler);
const checkout = withAuth(billingCheckoutHandler);
const portal = withAuth(billingPortalHandler);

function makeRequest(token: string): HttpRequest {
  return {
    method: "GET",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? `Bearer ${token}` : null,
    },
    json: () => Promise.reject(new Error("no body")),
  } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return { log: () => {}, error: () => {}, warn: () => {} } as unknown as InvocationContext;
}

async function makeUser(): Promise<{ email: string; sub: string; token: string }> {
  const email = `${randomUUID()}@example.com`;
  const sub = `sub-${randomUUID()}`;
  await getOrCreate(email, sub);
  return { email, sub, token: signTestIdToken({ email, sub }) };
}

describe("billing endpoints (integration: Azurite + certs stub + stubbed Paddle API)", () => {
  beforeAll(async () => {
    process.env.GOOGLE_OAUTH_CERTS_URL = await startCertsStub();
    process.env.GOOGLE_OAUTH_CLIENT_ID = TEST_CLIENT_ID;
    process.env.REQUIRE_AUTH = "true";
  });

  afterAll(async () => {
    await stopCertsStub();
    delete process.env.GOOGLE_OAUTH_CERTS_URL;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.REQUIRE_AUTH;
  });

  const PADDLE_BASE = "https://sandbox-api.paddle.test";
  const realFetch = globalThis.fetch;

  /**
   * withAuth's token verification also calls `fetch` (Google certs stub);
   * only Paddle-bound requests go through the caller's mock response, so
   * both real crypto and stubbed billing calls coexist in one test.
   */
  function stubPaddleFetch(respond: () => Response | Promise<Response>): void {
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(PADDLE_BASE)) return Promise.resolve(respond());
      return realFetch(input as never, init as never);
    });
  }

  function paddleCall(): [unknown, RequestInit] {
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).startsWith(PADDLE_BASE));
    if (!call) throw new Error("expected a Paddle API call");
    return call as [unknown, RequestInit];
  }

  beforeEach(() => {
    process.env.PADDLE_API_BASE_URL = PADDLE_BASE;
    process.env.PADDLE_API_KEY = "test-key";
    process.env.PADDLE_PREMIUM_PRICE_ID = "pri_test";
    vi.stubGlobal("fetch", vi.fn(realFetch));
  });

  afterEach(() => {
    delete process.env.PADDLE_API_BASE_URL;
    delete process.env.PADDLE_API_KEY;
    delete process.env.PADDLE_PREMIUM_PRICE_ID;
    vi.unstubAllGlobals();
  });

  describe("GET /api/account", () => {
    it("free, no usage yet: count 0 with the free limit, subscription null", async () => {
      const user = await makeUser();
      const res = await account(makeRequest(user.token), makeContext());
      expect(res.status).toBe(200);
      expect(res.jsonBody).toMatchObject({
        email: user.email,
        tier: "free",
        usage: { count: 0, limit: MONTHLY_ANALYSES.free },
        subscription: null,
      });
    });

    it("free, with usage: reflects the current month's count", async () => {
      const user = await makeUser();
      await checkAndIncrement(user.sub, "free");
      await checkAndIncrement(user.sub, "free");
      const res = await account(makeRequest(user.token), makeContext());
      expect(res.jsonBody).toMatchObject({ usage: { count: 2, limit: MONTHLY_ANALYSES.free } });
    });

    it("premium, renewing: usage uses the premium limit and subscription shows renewsAt", async () => {
      const user = await makeUser();
      await setTier(user.email, "premium");
      await applySubscriptionState(user.email, {
        subscriptionStatus: "active",
        renewsAt: "2026-08-03T00:00:00Z",
        paddleEventOccurredAt: new Date().toISOString(),
      });
      const res = await account(makeRequest(user.token), makeContext());
      expect(res.jsonBody).toMatchObject({
        tier: "premium",
        usage: { limit: MONTHLY_ANALYSES.premium },
        subscription: { status: "active", renewsAt: "2026-08-03T00:00:00Z" },
      });
    });
  });

  describe("POST /api/billing/checkout", () => {
    it("200 with the checkout URL; custom_data comes from the verified token, never the request", async () => {
      const user = await makeUser();
      stubPaddleFetch(
        () =>
          new Response(
            JSON.stringify({
              data: { id: "txn_1", checkout: { url: "https://sandbox-checkout.paddle.test/txn_1" } },
            }),
            { status: 200 }
          )
      );
      const res = await checkout(makeRequest(user.token), makeContext());
      expect(res.status).toBe(200);
      expect(res.jsonBody).toMatchObject({
        checkoutUrl: "https://sandbox-checkout.paddle.test/txn_1",
        transactionId: "txn_1",
      });
      const [, init] = paddleCall();
      const body = JSON.parse(init.body as string) as { custom_data: unknown };
      expect(body.custom_data).toEqual({ sub: user.sub, email: user.email });
    });

    it("409 ALREADY_PREMIUM when the account is already premium", async () => {
      const user = await makeUser();
      await setTier(user.email, "premium");
      const res = await checkout(makeRequest(user.token), makeContext());
      expect(res.status).toBe(409);
      expect(res.jsonBody).toMatchObject({ error: { code: "ALREADY_PREMIUM" } });
      expect(
        vi.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith(PADDLE_BASE))
      ).toBe(false);
    });

    it("502 BILLING_UNAVAILABLE when Paddle is unreachable", async () => {
      const user = await makeUser();
      stubPaddleFetch(() => new Response("boom", { status: 503 }));
      const res = await checkout(makeRequest(user.token), makeContext());
      expect(res.status).toBe(502);
      expect(res.jsonBody).toMatchObject({ error: { code: "BILLING_UNAVAILABLE" } });
    });
  });

  describe("POST /api/billing/portal", () => {
    it("200 with the portal URL for a premium account with a stored customer id", async () => {
      const user = await makeUser();
      await setTier(user.email, "premium");
      await applySubscriptionState(user.email, {
        paddleCustomerId: "ctm_1",
        paddleEventOccurredAt: new Date().toISOString(),
      });
      stubPaddleFetch(
        () =>
          new Response(
            JSON.stringify({
              data: { urls: { general: { overview: "https://customer-portal.paddle.test/x" } } },
            }),
            { status: 200 }
          )
      );
      const res = await portal(makeRequest(user.token), makeContext());
      expect(res.status).toBe(200);
      expect(res.jsonBody).toMatchObject({
        portalUrl: "https://customer-portal.paddle.test/x",
      });
      const [url] = paddleCall();
      expect(String(url)).toContain("/customers/ctm_1/portal-sessions");
    });

    it("404 NO_SUBSCRIPTION when there is no stored paddleCustomerId", async () => {
      const user = await makeUser();
      const res = await portal(makeRequest(user.token), makeContext());
      expect(res.status).toBe(404);
      expect(res.jsonBody).toMatchObject({ error: { code: "NO_SUBSCRIPTION" } });
      expect(
        vi.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith(PADDLE_BASE))
      ).toBe(false);
    });

    it("502 BILLING_UNAVAILABLE when Paddle is unreachable", async () => {
      const user = await makeUser();
      await applySubscriptionState(user.email, {
        paddleCustomerId: "ctm_1",
        paddleEventOccurredAt: new Date().toISOString(),
      });
      stubPaddleFetch(() => new Response("boom", { status: 500 }));
      const res = await portal(makeRequest(user.token), makeContext());
      expect(res.status).toBe(502);
      expect(res.jsonBody).toMatchObject({ error: { code: "BILLING_UNAVAILABLE" } });
    });
  });
});
