import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import type { AuthenticatedUser } from "../models/user";
import { withAuth } from "../services/auth";
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  preflightResponse,
  requestOrigin,
} from "../services/http";
import { getByEmail } from "../services/usersStore";
import { peekUsage } from "../services/meteringService";
import { PaddleApiError, createPortalSession, createTransaction } from "../services/paddleClient";
import { withRateLimit } from "../services/rateLimiter";

/**
 * GET /api/account · POST /api/billing/checkout · POST /api/billing/portal
 * (contracts/billing-api.md) — all behind withAuth; never metered.
 */

export async function accountHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") return preflightResponse(origin);
  try {
    const row = await getByEmail(user.email);
    const usage = await peekUsage(user.sub, user.tier);
    const subscription = row?.subscriptionStatus
      ? {
          status: row.subscriptionStatus,
          renewsAt: row.renewsAt || null,
          endsAt: row.endsAt || null,
        }
      : null;
    return jsonResponse(
      200,
      {
        email: user.email,
        tier: user.tier,
        usage: { count: usage.count, limit: usage.limit, resetsAt: usage.resetsAt },
        subscription,
      },
      origin
    );
  } catch (err) {
    context.error("account lookup failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Couldn't load your account. Please try again.", origin);
  }
}

export async function billingCheckoutHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") return preflightResponse(origin);
  if (user.tier === "premium") {
    return errorResponse(409, "ALREADY_PREMIUM", "You're already on Premium.", origin);
  }
  try {
    const { checkoutUrl, transactionId } = await createTransaction({
      sub: user.sub,
      email: user.email,
    });
    return jsonResponse(200, { checkoutUrl, transactionId }, origin);
  } catch (err) {
    if (err instanceof PaddleApiError) {
      context.error("checkout creation failed:", err.message);
      return errorResponse(502, "BILLING_UNAVAILABLE", "Couldn't open checkout. Try again.", origin);
    }
    context.error("checkout creation failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Checkout failed. Please try again.", origin);
  }
}

export async function billingPortalHandler(
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
): Promise<HttpResponseInit> {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") return preflightResponse(origin);
  try {
    const row = await getByEmail(user.email);
    if (!row?.paddleCustomerId) {
      return errorResponse(404, "NO_SUBSCRIPTION", "No subscription to manage yet.", origin);
    }
    const { portalUrl } = await createPortalSession(row.paddleCustomerId);
    return jsonResponse(200, { portalUrl }, origin);
  } catch (err) {
    if (err instanceof PaddleApiError) {
      context.error("portal session creation failed:", err.message);
      return errorResponse(502, "BILLING_UNAVAILABLE", "Couldn't open the portal. Try again.", origin);
    }
    context.error("portal session creation failed:", err);
    return errorResponse(500, "SERVICE_ERROR", "Request failed. Please try again.", origin);
  }
}

const preflight = (request: HttpRequest) => ({
  status: 204,
  headers: corsHeaders(requestOrigin(request)),
});

app.http("account", {
  methods: ["GET"],
  authLevel: "anonymous", // withAuth (Google ID token) is the real gate; anonymous so the public web SPA can call this route too
  route: "account",
  handler: withRateLimit("billing", withAuth(accountHandler)),
});
app.http("account-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "account",
  handler: preflight,
});

app.http("billing-checkout", {
  methods: ["POST"],
  authLevel: "anonymous", // withAuth (Google ID token) is the real gate; anonymous so the public web SPA can call this route too
  route: "billing/checkout",
  handler: withRateLimit("billing", withAuth(billingCheckoutHandler)),
});
app.http("billing-checkout-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "billing/checkout",
  handler: preflight,
});

app.http("billing-portal", {
  methods: ["POST"],
  authLevel: "anonymous", // withAuth (Google ID token) is the real gate; anonymous so the public web SPA can call this route too
  route: "billing/portal",
  handler: withRateLimit("billing", withAuth(billingPortalHandler)),
});
app.http("billing-portal-preflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "billing/portal",
  handler: preflight,
});
