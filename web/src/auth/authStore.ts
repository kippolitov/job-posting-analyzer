/**
 * In-memory-only auth session store (research.md R2, contracts/web-auth.md):
 * the Google ID token and its decoded claims live in a module-level variable
 * only — never localStorage/sessionStorage/cookies — so a page reload always
 * starts signed-out until GIS re-issues (or the user signs in again).
 */

export interface AuthSession {
  idToken: string;
  sub: string;
  email: string;
  /** `exp` claim, epoch seconds. */
  exp: number;
}

type Listener = (session: AuthSession | null) => void;

let session: AuthSession | null = null;
const listeners = new Set<Listener>();

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  return atob(padded);
}

/**
 * Decodes (never verifies) an ID token's payload — the server is the only
 * party that verifies the signature; the client only reads claims to know
 * who is signed in and when the token expires.
 */
export function decodeIdToken(
  idToken: string
): { sub: string; email: string; exp: number } | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as {
      sub?: string;
      email?: string;
      exp?: number;
    };
    if (!payload.sub || !payload.email || typeof payload.exp !== "number") {
      return null;
    }
    return { sub: payload.sub, email: payload.email, exp: payload.exp };
  } catch {
    return null;
  }
}

export function setSession(idToken: string): AuthSession | null {
  const decoded = decodeIdToken(idToken);
  session = decoded ? { idToken, ...decoded } : null;
  notify();
  return session;
}

export function clearSession(): void {
  session = null;
  notify();
}

export function getSession(): AuthSession | null {
  return session;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener(session);
}

let authError: string | null = null;
const errorListeners = new Set<(message: string | null) => void>();

/** Last plain-language auth failure (401/403) — shown once on the landing page. */
export function setAuthError(message: string | null): void {
  authError = message;
  for (const listener of errorListeners) listener(authError);
}

export function getAuthError(): string | null {
  return authError;
}

export function subscribeAuthError(listener: (message: string | null) => void): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

/** True once the token is within `withinMs` of `exp` (default ~1 min, research.md R2). */
export function needsSilentRefresh(withinMs = 60_000, now: number = Date.now()): boolean {
  if (!session) return false;
  return session.exp * 1000 - now <= withinMs;
}

export function isExpired(now: number = Date.now()): boolean {
  if (!session) return true;
  return session.exp * 1000 <= now;
}
