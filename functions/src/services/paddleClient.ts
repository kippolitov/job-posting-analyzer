import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paddle Billing integration (research.md R3/R4): signature verification is
 * HMAC-SHA256 over the raw webhook body via Node `crypto`; the two API
 * calls (create transaction, create portal session) are plain `fetch`
 * against PADDLE_API_BASE_URL. No SDK dependency (R3).
 *
 * Response shapes (transaction `checkout.url`, portal session
 * `urls.general.overview`) follow Paddle's documented Billing API; research
 * flags these as verify-at-implementation against Paddle's current API
 * reference before the live cutover (plan.md Rollout PR 3).
 */

const SIGNATURE_PATTERN = /^ts=(\d+);h1=([0-9a-f]+)$/;
const REPLAY_WINDOW_SECONDS = 300;

export class PaddleApiError extends Error {
  constructor(message = "Couldn't reach Paddle. Please try again.") {
    super(message);
    this.name = "PaddleApiError";
  }
}

/**
 * Verifies the `Paddle-Signature` header (`ts=<unix>;h1=<hex>`) over the raw
 * request bytes — never a re-serialized body (contracts/paddle-webhook.md).
 * Constant-time comparison; rejects a stale `ts` (replay window) and any
 * malformed or missing header.
 */
export function verifyPaddleSignature(
  rawBody: Buffer,
  header: string | null | undefined,
  secret: string,
  now: Date = new Date()
): boolean {
  if (!header) return false;
  const match = SIGNATURE_PATTERN.exec(header);
  if (!match) return false;

  const ts = Number(match[1]);
  const providedHex = match[2];
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - ts) > REPLAY_WINDOW_SECONDS) return false;

  const expectedHex = createHmac("sha256", secret)
    .update(`${ts}:`)
    .update(rawBody)
    .digest("hex");

  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHex, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new PaddleApiError(`${name} is not configured.`);
  return value;
}

async function paddleFetch(path: string, body: unknown): Promise<Record<string, unknown>> {
  const baseUrl = requireEnv("PADDLE_API_BASE_URL");
  const apiKey = requireEnv("PADDLE_API_KEY");

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PaddleApiError("Could not reach Paddle. Please try again.");
  }

  if (!response.ok) {
    throw new PaddleApiError(`Paddle API responded with HTTP ${response.status}.`);
  }

  const json = (await response.json()) as { data?: Record<string, unknown> };
  if (!json.data || typeof json.data !== "object") {
    throw new PaddleApiError("Unexpected Paddle API response shape.");
  }
  return json.data;
}

export interface CreateTransactionResult {
  checkoutUrl: string;
  transactionId: string;
}

/** POST /transactions — custom_data carries the verified sub/email (never client input). */
export async function createTransaction(customData: {
  sub: string;
  email: string;
}): Promise<CreateTransactionResult> {
  const priceId = requireEnv("PADDLE_PREMIUM_PRICE_ID");
  const data = await paddleFetch("/transactions", {
    items: [{ price_id: priceId, quantity: 1 }],
    custom_data: customData,
  });

  const checkoutUrl = (data.checkout as { url?: unknown } | undefined)?.url;
  const transactionId = data.id;
  if (typeof checkoutUrl !== "string" || typeof transactionId !== "string") {
    throw new PaddleApiError("Unexpected Paddle transaction response shape.");
  }
  return { checkoutUrl, transactionId };
}

export interface CreatePortalSessionResult {
  portalUrl: string;
}

/** POST /customers/{id}/portal-sessions — cancel/payment-method/invoices (no in-extension billing UI). */
export async function createPortalSession(
  customerId: string
): Promise<CreatePortalSessionResult> {
  const data = await paddleFetch(
    `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
    {}
  );

  const urls = data.urls as { general?: { overview?: unknown } } | undefined;
  const portalUrl = urls?.general?.overview;
  if (typeof portalUrl !== "string") {
    throw new PaddleApiError("Unexpected Paddle portal session response shape.");
  }
  return { portalUrl };
}
