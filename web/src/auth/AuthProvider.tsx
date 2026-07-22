import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type AuthSession,
  clearSession as clearStoredSession,
  getAuthError,
  getSession,
  setAuthError,
  setSession as storeSession,
  subscribe,
  subscribeAuthError,
} from "./authStore";
import { disableAutoSelect, initGoogleIdentity, promptSilent } from "./googleIdentity";
import { resetLibrary } from "@/lib/libraryStore";
import { clearCompareSelection } from "@/lib/compareStore";

interface AuthContextValue {
  session: AuthSession | null;
  /** True until the first silent-refresh attempt (or its absence) resolves. */
  initializing: boolean;
  signOut: () => void;
  /** Explicit prompt (One Tap / button flow) — the landing page's sign-in action. */
  promptSignIn: () => void;
  /** Plain-language message from the last 401/403 (contracts/web-auth.md); dismissible. */
  authError: string | null;
  dismissAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** ~1 min before `exp`, attempt a silent re-issue (research.md R2). */
const SILENT_REFRESH_WINDOW_MS = 60_000;

export function AuthProvider({
  clientId,
  children,
}: {
  clientId: string;
  children: React.ReactNode;
}) {
  const [session, setSessionState] = useState<AuthSession | null>(getSession());
  const [initializing, setInitializing] = useState(true);
  const [authError, setAuthErrorState] = useState<string | null>(getAuthError());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeAuthError(setAuthErrorState), []);

  const scheduleRefresh = useCallback((current: AuthSession | null) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (!current) return;
    const delay = Math.max(0, current.exp * 1000 - Date.now() - SILENT_REFRESH_WINDOW_MS);
    refreshTimer.current = setTimeout(() => promptSilent(), delay);
  }, []);

  useEffect(() => {
    return subscribe((next) => {
      setSessionState(next);
      scheduleRefresh(next);
    });
  }, [scheduleRefresh]);

  useEffect(() => {
    let cancelled = false;
    initGoogleIdentity({
      clientId,
      onCredential: (idToken) => storeSession(idToken),
    })
      .then(() => {
        if (cancelled) return;
        // A live Google browser session re-mints an ID token silently
        // (research.md R2); if none exists this simply no-ops.
        promptSilent();
      })
      .catch(() => {
        // GIS failed to load (offline, blocked script) — the user still
        // sees the signed-out landing page and can retry sign-in.
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const signOut = useCallback(() => {
    disableAutoSelect();
    clearStoredSession();
    resetLibrary();
    clearCompareSelection();
  }, []);

  const promptSignIn = useCallback(() => {
    promptSilent();
  }, []);

  const dismissAuthError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider
      value={{ session, initializing, signOut, promptSignIn, authError, dismissAuthError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
