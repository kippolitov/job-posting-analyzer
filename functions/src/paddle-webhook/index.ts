import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { RestError } from "@azure/data-tables";
import { verifyPaddleSignature } from "../services/paddleClient";
import { ensureTable, nowIso } from "../services/tablesService";
import { applySubscriptionState, findByPaddleCustomerId, getByEmail } from "../services/usersStore";
import type { UserEntity } from "../models/user";

/**
 * POST /api/paddle-webhook (contracts/paddle-webhook.md): Paddle is the only
 * caller — anonymous auth level, no withAuth, no function key boundary; the
 * HMAC signature IS the authentication (research.md R4). Registered
 * separately from the other HTTP functions since it takes no Bearer token.
 */

const EVENTS_TABLE = "PaddleEvents";
const EVENTS_PARTITION = "PaddleEvent";

interface PaddleEventPayload {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

function isPaddleEventPayload(value: unknown): value is PaddleEventPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.event_id === "string" &&
    typeof v.event_type === "string" &&
    typeof v.occurred_at === "string" &&
    typeof v.data === "object" &&
    v.data !== null
  );
}

function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return { status, headers: { "Content-Type": "application/json" }, jsonBody: body };
}

const SUBSCRIPTION_STATUSES = ["active", "past_due", "paused", "canceled"] as const;

function isSubscriptionStatus(
  value: unknown
): value is (typeof SUBSCRIPTION_STATUSES)[number] {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Maps a handled event to a Users-row patch. `null` means "acknowledged but
 * ignored" (unknown event types) — no user resolution or write is needed.
 */
function buildEventPatch(
  eventType: string,
  data: Record<string, unknown>
): Partial<Omit<UserEntity, "partitionKey" | "rowKey">> | null {
  const customerId = typeof data.customer_id === "string" ? data.customer_id : undefined;

  if (eventType === "transaction.completed") {
    return {
      tier: "premium",
      ...(customerId ? { paddleCustomerId: customerId } : {}),
    };
  }

  if (eventType === "subscription.activated") {
    return {
      tier: "premium",
      subscriptionStatus: "active",
      // Empty string is this table's "cleared" convention (Table Storage
      // Merge has no first-class property deletion) — any scheduled-cancel
      // display state from a prior downgrade attempt no longer applies.
      endsAt: "",
      ...(customerId ? { paddleCustomerId: customerId } : {}),
      ...(typeof data.id === "string" ? { paddleSubscriptionId: data.id } : {}),
      ...(typeof data.next_billed_at === "string" ? { renewsAt: data.next_billed_at } : {}),
    };
  }

  if (eventType === "subscription.updated") {
    // Display state only — never flips tier (contracts/paddle-webhook.md).
    const scheduledChange = data.scheduled_change as
      | { action?: unknown; effective_at?: unknown }
      | null
      | undefined;
    const effectiveAt =
      scheduledChange?.action === "cancel" && typeof scheduledChange.effective_at === "string"
        ? scheduledChange.effective_at
        : "";
    return {
      ...(isSubscriptionStatus(data.status)
        ? { subscriptionStatus: data.status }
        : {}),
      ...(typeof data.next_billed_at === "string"
        ? { renewsAt: data.next_billed_at }
        : {}),
      // Cleared (empty string) when no scheduled cancel is present.
      endsAt: effectiveAt,
    };
  }

  if (eventType === "subscription.canceled") {
    // Paddle sends this when the cancellation takes effect (period end by
    // default) — paid-through is honored by event timing, not our clock.
    return {
      tier: "free",
      subscriptionStatus: "canceled",
      renewsAt: "",
      endsAt: "",
    };
  }

  return null;
}

/** custom_data (from the verified token at checkout) then paddleCustomerId fallback. */
async function resolveUserEmail(data: Record<string, unknown>): Promise<string | null> {
  const customData = data.custom_data as { email?: unknown } | undefined;
  if (typeof customData?.email === "string" && customData.email.length > 0) {
    const user = await getByEmail(customData.email);
    if (user) return user.rowKey;
  }
  const customerId = data.customer_id;
  if (typeof customerId === "string") {
    const user = await findByPaddleCustomerId(customerId);
    if (user) return user.rowKey;
  }
  return null;
}

export async function paddleWebhookHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const rawBodyText = await request.text();
  const secret = process.env.PADDLE_WEBHOOK_SECRET ?? "";
  const signatureHeader = request.headers.get("paddle-signature");

  if (
    !secret ||
    !verifyPaddleSignature(Buffer.from(rawBodyText, "utf-8"), signatureHeader, secret)
  ) {
    context.warn("paddle-webhook: signature verification failed");
    return jsonResponse(400, {
      error: { code: "INVALID_SIGNATURE", message: "Invalid or missing signature." },
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBodyText);
  } catch {
    return jsonResponse(400, {
      error: { code: "INVALID_REQUEST", message: "Body is not valid JSON." },
    });
  }
  if (!isPaddleEventPayload(payload)) {
    return jsonResponse(400, {
      error: { code: "INVALID_REQUEST", message: "Malformed webhook event." },
    });
  }

  try {
    const eventsClient = await ensureTable(EVENTS_TABLE);
    try {
      await eventsClient.createEntity({
        partitionKey: EVENTS_PARTITION,
        rowKey: payload.event_id,
        eventType: payload.event_type,
        occurredAt: payload.occurred_at,
        processedAt: nowIso(),
      });
    } catch (err) {
      if (err instanceof RestError && err.statusCode === 409) {
        return jsonResponse(200, { received: true }); // duplicate delivery
      }
      throw err;
    }

    const patch = buildEventPatch(payload.event_type, payload.data);
    if (!patch) {
      return jsonResponse(200, { received: true }); // unhandled event type
    }

    const email = await resolveUserEmail(payload.data);
    if (!email) {
      context.warn(`paddle.orphan_event: ${payload.event_id} (${payload.event_type})`);
      return jsonResponse(200, { received: true });
    }

    const user = await getByEmail(email);
    if (
      user?.paddleEventOccurredAt &&
      Date.parse(user.paddleEventOccurredAt) >= Date.parse(payload.occurred_at)
    ) {
      return jsonResponse(200, { received: true }); // stale (out-of-order)
    }

    await applySubscriptionState(email, {
      ...patch,
      paddleEventOccurredAt: payload.occurred_at,
    });
    return jsonResponse(200, { received: true });
  } catch (err) {
    context.error("paddle-webhook storage failure:", err);
    return jsonResponse(500, {
      error: { code: "SERVICE_ERROR", message: "Webhook processing failed." },
    });
  }
}

app.http("paddle-webhook", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "paddle-webhook",
  handler: paddleWebhookHandler,
});
