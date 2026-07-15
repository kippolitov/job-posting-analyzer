import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyPaddleSignature,
  createTransaction,
  createPortalSession,
  PaddleApiError,
} from "../../src/services/paddleClient";

const SECRET = "test-webhook-secret";

function signHeader(rawBody: string, tsSeconds: number, secret = SECRET): string {
  const h1 = createHmac("sha256", secret).update(`${tsSeconds}:`).update(rawBody).digest("hex");
  return `ts=${tsSeconds};h1=${h1}`;
}

describe("verifyPaddleSignature", () => {
  it("accepts a validly signed header over the raw body", () => {
    const rawBody = Buffer.from(JSON.stringify({ event_id: "evt_1" }));
    const now = Math.floor(Date.now() / 1000);
    const header = signHeader(rawBody.toString(), now);
    expect(verifyPaddleSignature(rawBody, header, SECRET)).toBe(true);
  });

  it("rejects a tampered byte in the body", () => {
    const rawBody = Buffer.from(JSON.stringify({ event_id: "evt_1" }));
    const now = Math.floor(Date.now() / 1000);
    const header = signHeader(rawBody.toString(), now);
    const tampered = Buffer.from(JSON.stringify({ event_id: "evt_2" }));
    expect(verifyPaddleSignature(tampered, header, SECRET)).toBe(false);
  });

  it("rejects a stale timestamp outside the 300s replay window", () => {
    const rawBody = Buffer.from(JSON.stringify({ event_id: "evt_1" }));
    const stale = Math.floor(Date.now() / 1000) - 301;
    const header = signHeader(rawBody.toString(), stale);
    expect(verifyPaddleSignature(rawBody, header, SECRET)).toBe(false);
  });

  it("accepts a timestamp exactly at the 300s boundary", () => {
    const rawBody = Buffer.from(JSON.stringify({ event_id: "evt_1" }));
    const boundary = Math.floor(Date.now() / 1000) - 300;
    const header = signHeader(rawBody.toString(), boundary);
    expect(verifyPaddleSignature(rawBody, header, SECRET)).toBe(true);
  });

  it("rejects a missing signature header", () => {
    const rawBody = Buffer.from("{}");
    expect(verifyPaddleSignature(rawBody, undefined, SECRET)).toBe(false);
    expect(verifyPaddleSignature(rawBody, null, SECRET)).toBe(false);
    expect(verifyPaddleSignature(rawBody, "", SECRET)).toBe(false);
  });

  it("rejects a malformed header that doesn't match ts=..;h1=..", () => {
    const rawBody = Buffer.from("{}");
    expect(verifyPaddleSignature(rawBody, "not-a-signature", SECRET)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = Buffer.from(JSON.stringify({ event_id: "evt_1" }));
    const now = Math.floor(Date.now() / 1000);
    const header = signHeader(rawBody.toString(), now, "wrong-secret");
    expect(verifyPaddleSignature(rawBody, header, SECRET)).toBe(false);
  });
});

describe("paddleClient API wrappers", () => {
  beforeEach(() => {
    process.env.PADDLE_API_BASE_URL = "https://sandbox-api.paddle.test";
    process.env.PADDLE_API_KEY = "test-api-key";
    process.env.PADDLE_PREMIUM_PRICE_ID = "pri_test123";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PADDLE_API_BASE_URL;
    delete process.env.PADDLE_API_KEY;
    delete process.env.PADDLE_PREMIUM_PRICE_ID;
  });

  it("createTransaction posts custom_data from the caller and the configured price id", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: "txn_01", checkout: { url: "https://sandbox-checkout.paddle.test/txn_01" } },
        }),
        { status: 200 }
      )
    );

    const result = await createTransaction({ sub: "sub-1", email: "a@example.com" });
    expect(result).toEqual({
      checkoutUrl: "https://sandbox-checkout.paddle.test/txn_01",
      transactionId: "txn_01",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/transactions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-api-key",
    });
    const body = JSON.parse(init.body as string) as {
      custom_data: unknown;
      items: unknown;
    };
    expect(body.custom_data).toEqual({ sub: "sub-1", email: "a@example.com" });
    expect(body.items).toEqual([{ price_id: "pri_test123", quantity: 1 }]);
  });

  it("createTransaction maps a 5xx response to PaddleApiError", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("boom", { status: 503 }));
    await expect(
      createTransaction({ sub: "sub-1", email: "a@example.com" })
    ).rejects.toBeInstanceOf(PaddleApiError);
  });

  it("createTransaction maps a network failure to PaddleApiError", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("failed to fetch"));
    await expect(
      createTransaction({ sub: "sub-1", email: "a@example.com" })
    ).rejects.toBeInstanceOf(PaddleApiError);
  });

  it("createPortalSession posts to the customer's portal-sessions endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { urls: { general: { overview: "https://customer-portal.paddle.test/abc" } } },
        }),
        { status: 200 }
      )
    );

    const result = await createPortalSession("ctm_01");
    expect(result).toEqual({ portalUrl: "https://customer-portal.paddle.test/abc" });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/customers/ctm_01/portal-sessions");
  });

  it("createPortalSession maps a 5xx response to PaddleApiError", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(createPortalSession("ctm_01")).rejects.toBeInstanceOf(PaddleApiError);
  });
});
