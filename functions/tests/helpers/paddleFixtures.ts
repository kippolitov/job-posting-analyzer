import { randomUUID, createHmac } from "node:crypto";

/**
 * Signed Paddle webhook fixtures (shapes from Paddle's webhook simulator,
 * research.md R4) — raw body + a `Paddle-Signature` header computed with the
 * test secret, so verification in tests runs the production code path over
 * real bytes (contracts/paddle-webhook.md).
 */

export const TEST_WEBHOOK_SECRET = "test-paddle-webhook-secret";

export interface PaddleEventOverrides {
  eventId?: string;
  occurredAt?: string;
  tsSeconds?: number;
}

export function signPaddleSignature(
  rawBody: string,
  tsSeconds: number,
  secret: string = TEST_WEBHOOK_SECRET
): string {
  const h1 = createHmac("sha256", secret).update(`${tsSeconds}:`).update(rawBody).digest("hex");
  return `ts=${tsSeconds};h1=${h1}`;
}

export function buildPaddleEvent(
  eventType: string,
  data: Record<string, unknown>,
  overrides: PaddleEventOverrides = {}
): { rawBody: string; headers: Record<string, string>; eventId: string; occurredAt: string } {
  const eventId = overrides.eventId ?? `evt_${randomUUID()}`;
  const occurredAt = overrides.occurredAt ?? new Date().toISOString();
  const tsSeconds = overrides.tsSeconds ?? Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    occurred_at: occurredAt,
    data,
  });
  return {
    rawBody,
    headers: { "paddle-signature": signPaddleSignature(rawBody, tsSeconds) },
    eventId,
    occurredAt,
  };
}

export function transactionCompleted(
  data: Partial<Record<string, unknown>> = {},
  overrides?: PaddleEventOverrides
) {
  return buildPaddleEvent(
    "transaction.completed",
    {
      id: `txn_${randomUUID()}`,
      customer_id: `ctm_${randomUUID()}`,
      custom_data: { sub: "sub-placeholder", email: "placeholder@example.com" },
      ...data,
    },
    overrides
  );
}

export function subscriptionActivated(
  data: Partial<Record<string, unknown>> = {},
  overrides?: PaddleEventOverrides
) {
  return buildPaddleEvent(
    "subscription.activated",
    {
      id: `sub_${randomUUID()}`,
      customer_id: `ctm_${randomUUID()}`,
      status: "active",
      next_billed_at: "2026-08-03T00:00:00Z",
      scheduled_change: null,
      custom_data: { sub: "sub-placeholder", email: "placeholder@example.com" },
      ...data,
    },
    overrides
  );
}

export function subscriptionUpdated(
  data: Partial<Record<string, unknown>> = {},
  overrides?: PaddleEventOverrides
) {
  return buildPaddleEvent(
    "subscription.updated",
    {
      id: `sub_${randomUUID()}`,
      customer_id: `ctm_${randomUUID()}`,
      status: "active",
      next_billed_at: "2026-08-03T00:00:00Z",
      scheduled_change: null,
      custom_data: { sub: "sub-placeholder", email: "placeholder@example.com" },
      ...data,
    },
    overrides
  );
}

export function subscriptionCanceled(
  data: Partial<Record<string, unknown>> = {},
  overrides?: PaddleEventOverrides
) {
  return buildPaddleEvent(
    "subscription.canceled",
    {
      id: `sub_${randomUUID()}`,
      customer_id: `ctm_${randomUUID()}`,
      status: "canceled",
      custom_data: { sub: "sub-placeholder", email: "placeholder@example.com" },
      ...data,
    },
    overrides
  );
}

export function unknownEvent(
  data: Partial<Record<string, unknown>> = {},
  overrides?: PaddleEventOverrides
) {
  return buildPaddleEvent("payout.paid", { id: `pyt_${randomUUID()}`, ...data }, overrides);
}
