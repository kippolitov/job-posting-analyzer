/** Identity claims the UI needs, decoded from the verified Google ID token. */
export interface AuthenticatedUser {
  sub: string;
  email: string;
}

/**
 * Persisted session in chrome.storage.local (survives browser restarts).
 * `signedInAt` is the timestamp (ms) of the last *interactive* sign-in and
 * anchors the ~30-day session horizon (FR-014a): silent renewal refreshes
 * `idToken`/`expiresAt` but never `signedInAt`.
 */
export interface StoredAuth {
  idToken: string;
  /** Token `exp`, in epoch milliseconds. */
  expiresAt: number;
  /** Interactive sign-in time, in epoch milliseconds. */
  signedInAt: number;
  user: AuthenticatedUser;
}

export type AuthErrorCode =
  | "sign-in-canceled"
  | "sign-in-failed"
  | "session-expired"
  | "not-authorized";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
