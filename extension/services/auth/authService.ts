import { AuthError, type AuthenticatedUser, type StoredAuth } from "../../types/auth";

declare const WXT_GOOGLE_OAUTH_CLIENT_ID: string;

/**
 * Google sign-in via chrome.identity.launchWebAuthFlow running an OIDC
 * implicit id_token flow (research.md R1 — getAuthToken returns an access
 * token, which the server-side JWKS verification cannot accept).
 *
 * The session lives in chrome.storage.local so it survives browser restarts;
 * silent renewal (interactive:false) keeps it alive for up to ~30 days from
 * the interactive sign-in (FR-014a). The client only *decodes* the token for
 * display/expiry — verification is exclusively server-side (FR-003).
 */

export const AUTH_SESSION_KEY = "auth:session";
export const NOT_AUTHORIZED_KEY = "auth:notAuthorized";

/** ~30 days: past this, silent renewal stops and interactive sign-in is required. */
export const SESSION_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
/** Renew slightly before exp so in-flight requests don't race expiry. */
const EXPIRY_SKEW_MS = 60_000;

interface IdTokenClaims {
  sub: string;
  email: string;
  exp: number;
  nonce?: string;
}

function decodeIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");
  const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
  const claims = JSON.parse(payloadJson) as Partial<IdTokenClaims>;
  if (
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string" ||
    typeof claims.exp !== "number"
  ) {
    throw new Error("ID token is missing required claims");
  }
  return claims as IdTokenClaims;
}

function freshNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildAuthUrl(nonce: string, options: { loginHint?: string; silent?: boolean }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", WXT_GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("redirect_uri", chrome.identity.getRedirectURL());
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("nonce", nonce);
  if (options.silent) {
    url.searchParams.set("prompt", "none");
  }
  if (options.loginHint) {
    url.searchParams.set("login_hint", options.loginHint);
  }
  return url.toString();
}

function extractIdToken(redirectUrl: string, expectedNonce: string): string {
  const hash = new URL(redirectUrl).hash.replace(/^#/, "");
  const idToken = new URLSearchParams(hash).get("id_token");
  if (!idToken) {
    throw new AuthError("sign-in-failed", "Google did not return an ID token.");
  }
  const claims = decodeIdToken(idToken);
  if (claims.nonce !== expectedNonce) {
    throw new AuthError("sign-in-failed", "Sign-in response failed the nonce check.");
  }
  return idToken;
}

async function runAuthFlow(options: {
  interactive: boolean;
  loginHint?: string;
}): Promise<{ idToken: string; user: AuthenticatedUser; expiresAt: number }> {
  const nonce = freshNonce();
  const url = buildAuthUrl(nonce, {
    loginHint: options.loginHint,
    silent: !options.interactive,
  });
  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url,
    interactive: options.interactive,
  });
  if (!redirectUrl) {
    throw new AuthError("sign-in-canceled", "Sign-in was canceled.");
  }
  const idToken = extractIdToken(redirectUrl, nonce);
  const claims = decodeIdToken(idToken);
  return {
    idToken,
    user: { sub: claims.sub, email: claims.email },
    expiresAt: claims.exp * 1000,
  };
}

async function persist(auth: StoredAuth): Promise<void> {
  await chrome.storage.local.set({ [AUTH_SESSION_KEY]: auth });
}

export async function getStoredAuth(): Promise<StoredAuth | null> {
  const data = await chrome.storage.local.get(AUTH_SESSION_KEY);
  return (data[AUTH_SESSION_KEY] as StoredAuth | undefined) ?? null;
}

/** Interactive sign-in: anchors a new ~30-day session (sets signedInAt). */
export async function signIn(): Promise<StoredAuth> {
  let result;
  try {
    result = await runAuthFlow({ interactive: true });
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("sign-in-canceled", "Sign-in was canceled.");
  }
  const auth: StoredAuth = { ...result, signedInAt: Date.now() };
  await chrome.storage.local.remove(NOT_AUTHORIZED_KEY);
  await persist(auth);
  return auth;
}

/**
 * Non-interactive renewal. Never throws: returns null when there is no
 * session, the ~30-day horizon has passed (FR-014a), or Google refuses the
 * silent flow — callers fall back to the sign-in gate.
 */
export async function signInSilently(): Promise<StoredAuth | null> {
  const stored = await getStoredAuth();
  if (!stored) return null;
  if (Date.now() - stored.signedInAt > SESSION_HORIZON_MS) return null;
  try {
    const result = await runAuthFlow({
      interactive: false,
      loginHint: stored.user.email,
    });
    const auth: StoredAuth = { ...result, signedInAt: stored.signedInAt };
    await persist(auth);
    return auth;
  } catch {
    return null;
  }
}

/** Fresh Bearer token for a request, renewing silently when needed. */
export async function getIdToken(): Promise<string | null> {
  const stored = await getStoredAuth();
  if (stored && stored.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return stored.idToken;
  }
  const renewed = await signInSilently();
  return renewed?.idToken ?? null;
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove([AUTH_SESSION_KEY, NOT_AUTHORIZED_KEY]);
}

/** Server said 403: end the session and remember the invitation state. */
export async function markNotAuthorized(): Promise<void> {
  await chrome.storage.local.remove(AUTH_SESSION_KEY);
  await chrome.storage.local.set({ [NOT_AUTHORIZED_KEY]: true });
}

export async function isNotAuthorized(): Promise<boolean> {
  const data = await chrome.storage.local.get(NOT_AUTHORIZED_KEY);
  return data[NOT_AUTHORIZED_KEY] === true;
}
