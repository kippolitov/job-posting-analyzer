import { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { OAuth2Client } from "google-auth-library";
import type { AuthenticatedUser } from "../models/user";
import { corsHeaders, requestOrigin } from "./http";
import { getOrCreate, normalizeEmail } from "./usersStore";

/**
 * withAuth(handler) — the single auth/authorization boundary for every HTTP
 * function (contracts/auth.md). Verifies the Google ID token (signature via
 * JWKS, iss, aud, exp — real crypto, offline after the certs cache warms),
 * requires email_verified, then point-reads the Users table (uncached; tier
 * flips and blocks are effective on the next request) — auto-creating the
 * row on first sign-in (self-serve signup, plan.md R1). No allowlist: any
 * verified-email Google account may sign up; the admin CLI's `block` is the
 * only override. Failures return 401/403 BEFORE the wrapped handler — for
 * analyze-job, before any OpenAI spend.
 *
 * `REQUIRE_AUTH` (default false until the gated extension version ships —
 * plan.md Rollout) bypasses *enforcement* only: a valid token still yields
 * the real identity; absence or failure falls back to a local-dev identity.
 */

export type AuthedHandler = (
  request: HttpRequest,
  context: InvocationContext,
  user: AuthenticatedUser
) => Promise<HttpResponseInit>;

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const DEFAULT_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const CERTS_TTL_MS = 60 * 60 * 1000;

const LOCAL_DEV_USER: AuthenticatedUser = {
  sub: "local-dev",
  email: "local-dev@localhost",
  tier: "free",
};

const oauthClient = new OAuth2Client();

let certsCache: { certs: Record<string, string>; fetchedAt: number } | null = null;

async function getGoogleCerts(): Promise<Record<string, string>> {
  if (certsCache && Date.now() - certsCache.fetchedAt < CERTS_TTL_MS) {
    return certsCache.certs;
  }
  const url = process.env.GOOGLE_OAUTH_CERTS_URL || DEFAULT_CERTS_URL;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Google certs: HTTP ${response.status}`);
  }
  const certs = (await response.json()) as Record<string, string>;
  certsCache = { certs, fetchedAt: Date.now() };
  return certs;
}

interface VerifiedToken {
  sub: string;
  email: string;
  emailVerified: boolean;
}

/**
 * GOOGLE_OAUTH_CLIENT_IDS (comma-separated) accepts a token minted for
 * either the extension's client ID or the web app's client ID; falls back
 * to the single GOOGLE_OAUTH_CLIENT_ID (contracts/web-auth.md, research.md
 * R3). Signature / iss / exp / email_verified checks are unchanged.
 */
function configuredClientIds(): string[] {
  const raw = process.env.GOOGLE_OAUTH_CLIENT_IDS ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function verifyIdToken(idToken: string): Promise<VerifiedToken> {
  const clientIds = configuredClientIds();
  if (clientIds.length === 0) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
  }
  // verifySignedJwtWithCertsAsync = the internals of verifyIdToken with the
  // certs supplied by us, so GOOGLE_OAUTH_CERTS_URL can point verification at
  // a locally served stub in tests (research.md R9) while the signature,
  // aud, iss, and exp checks all still run.
  const ticket = await oauthClient.verifySignedJwtWithCertsAsync(
    idToken,
    await getGoogleCerts(),
    clientIds,
    GOOGLE_ISSUERS
  );
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("Token payload is missing sub or email");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
  };
}

function extractBearerToken(request: HttpRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function authErrorResponse(
  status: 401 | 403,
  code: "UNAUTHENTICATED" | "NOT_AUTHORIZED",
  message: string,
  origin: string | null
): HttpResponseInit {
  return {
    status,
    headers: corsHeaders(origin),
    jsonBody: { error: { code, message } },
  };
}

function authRequired(): boolean {
  return process.env.REQUIRE_AUTH === "true";
}

export function withAuth(handler: AuthedHandler) {
  return async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    // Preflight carries no credentials; the handler answers it with 204.
    if (request.method === "OPTIONS") {
      return handler(request, context, LOCAL_DEV_USER);
    }

    const token = extractBearerToken(request);
    const origin = requestOrigin(request);

    if (!authRequired()) {
      if (token) {
        try {
          const verified = await verifyIdToken(token);
          return handler(request, context, {
            sub: verified.sub,
            email: normalizeEmail(verified.email),
            tier: "free",
          });
        } catch {
          // Bypass mode never blocks — fall through to the dev identity.
        }
      }
      return handler(request, context, LOCAL_DEV_USER);
    }

    if (!token) {
      return authErrorResponse(
        401,
        "UNAUTHENTICATED",
        "Sign-in required. Send a Google ID token as a Bearer token.",
        origin
      );
    }

    let verified: VerifiedToken;
    try {
      verified = await verifyIdToken(token);
    } catch (err) {
      context.warn(
        "Token verification failed:",
        err instanceof Error ? err.message : err
      );
      return authErrorResponse(
        401,
        "UNAUTHENTICATED",
        "Your session is invalid or has expired. Sign in again.",
        origin
      );
    }

    if (!verified.emailVerified) {
      return authErrorResponse(
        403,
        "NOT_AUTHORIZED",
        "Sign-in requires a verified Google email address. Verify your email in your Google Account settings (myaccount.google.com), then try again.",
        origin
      );
    }

    const email = normalizeEmail(verified.email);
    let user: Awaited<ReturnType<typeof getOrCreate>>;
    try {
      user = await getOrCreate(email, verified.sub);
    } catch (err) {
      context.error("Users lookup failed:", err);
      return {
        status: 500,
        headers: corsHeaders(origin),
        jsonBody: {
          error: {
            code: "SERVICE_ERROR",
            message: "Authorization check failed. Please try again.",
          },
        },
      };
    }

    if (user.blocked) {
      return authErrorResponse(
        403,
        "NOT_AUTHORIZED",
        "Your access has been suspended. Contact the developer to request access.",
        origin
      );
    }

    return handler(request, context, {
      sub: verified.sub,
      email,
      tier: user.tier,
    });
  };
}
