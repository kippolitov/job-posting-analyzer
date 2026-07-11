import { useEffect, useRef, useState, type ReactNode } from "react";
import { signIn, signOut } from "../services/auth/authService";
import {
  onAuthChange,
  readAuthSnapshot,
  type AuthSnapshot,
} from "../services/auth/authState";
import { detectLegacyData, type LegacyData } from "../services/migrationService";
import { AuthError } from "../types/auth";
import { MigrationPrompt } from "./MigrationPrompt";

const REQUEST_ACCESS_MAILTO =
  "mailto:kippolitov@gmail.com?subject=Job%20Posting%20Analyzer%20access%20request";

/**
 * Wraps every user surface (FR-001): children render only for a signed-in
 * session. Session expiry while children are mounted shows a re-sign-in
 * overlay WITHOUT unmounting them, so in-progress form input survives
 * re-authentication (FR-014). Explicit sign-out and revocation unmount
 * children — personal data leaves the view.
 */
export function AuthGate({
  children,
  showSignOut = true,
}: {
  children: ReactNode;
  /** The options page hides sign-out — the side panel is the account surface. */
  showSignOut?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while children have been shown this session: distinguishes expiry
  // (overlay, keep children) from a fresh signed-out visit (full gate).
  const wasSignedInRef = useRef(false);
  // One-time migration offer (FR-010): checked once after sign-in, before
  // the features render.
  const [migration, setMigration] = useState<{
    checked: boolean;
    data: LegacyData | null;
  }>({ checked: false, data: null });

  useEffect(() => {
    if (snapshot?.status !== "signed-in" || migration.checked) return;
    let mounted = true;
    detectLegacyData()
      .then((data) => {
        if (mounted) setMigration({ checked: true, data });
      })
      .catch(() => {
        // Detection failure must not block the app; the offer is best-effort
        // and will fire on the next panel open.
        if (mounted) setMigration({ checked: true, data: null });
      });
    return () => {
      mounted = false;
    };
  }, [snapshot, migration.checked]);

  useEffect(() => {
    let mounted = true;
    void readAuthSnapshot().then((s) => {
      if (mounted) setSnapshot(s);
    });
    const unsubscribe = onAuthChange((s) => {
      if (mounted) setSnapshot(s);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signIn();
      setSnapshot(await readAuthSnapshot());
    } catch (err) {
      setError(
        err instanceof AuthError && err.code === "sign-in-canceled"
          ? "Sign-in was canceled."
          : "Sign-in failed. Please try again."
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    wasSignedInRef.current = false;
    await signOut();
    setSnapshot(await readAuthSnapshot());
  };

  if (snapshot === null) {
    return (
      <div
        className="flex h-full min-h-32 items-center justify-center"
        role="status"
        aria-label="Checking sign-in status"
      >
        <span className="text-sm text-gray-400 dark:text-gray-500">Loading…</span>
      </div>
    );
  }

  if (snapshot.status === "not-authorized") {
    wasSignedInRef.current = false;
    return (
      <GateCard>
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Access is by invitation
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          This extension is currently limited to invited users. Your Google
          account is not on the invitation list.
        </p>
        <a
          href={REQUEST_ACCESS_MAILTO}
          className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Request access
        </a>
        <button
          onClick={() => void handleSignIn()}
          className="mt-2 block text-xs text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Sign in with a different account
        </button>
      </GateCard>
    );
  }

  if (snapshot.status === "signed-in" || wasSignedInRef.current) {
    // One stable tree for both the live session and the expired-session
    // overlay: children keep their position, so React never remounts them and
    // in-progress input survives re-authentication (FR-014).
    const expired = snapshot.status !== "signed-in";
    if (!expired) wasSignedInRef.current = true;

    let body: ReactNode;
    if (!expired && !migration.checked) {
      body = (
        <div
          role="status"
          aria-label="Checking for local data to migrate"
          className="flex h-full min-h-32 items-center justify-center"
        >
          <span className="text-sm text-gray-400 dark:text-gray-500">Loading…</span>
        </div>
      );
    } else if (!expired && migration.data) {
      body = (
        <MigrationPrompt
          data={migration.data}
          onDone={() => setMigration({ checked: true, data: null })}
        />
      );
    } else {
      body = children;
    }

    return (
      <div className="relative flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200/70 bg-white px-3 py-1.5 dark:border-gray-800 dark:bg-gray-900">
          <span
            className="truncate text-xs text-gray-500 dark:text-gray-400"
            title={snapshot.user?.email}
          >
            {expired ? "Signed out" : snapshot.user?.email}
          </span>
          {!expired && showSignOut && (
            <button
              onClick={() => void handleSignOut()}
              aria-label="Sign out"
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              Sign out
            </button>
          )}
        </div>
        <div
          className={`min-h-0 flex-1 ${expired ? "pointer-events-none opacity-40" : ""}`}
          aria-hidden={expired || undefined}
        >
          {body}
        </div>
        {expired && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/30 p-4">
            <div
              role="dialog"
              aria-label="Session ended"
              className="w-full max-w-xs rounded-xl border border-gray-200 bg-white p-4 text-center shadow-lg dark:border-gray-700 dark:bg-gray-900"
            >
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                Your session ended.
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Sign in to continue. Your unsaved changes are still here.
              </p>
              <SignInButton signingIn={signingIn} onClick={() => void handleSignIn()} />
              {error && <GateError message={error} />}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <GateCard>
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
        Sign in to continue
      </h2>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        Job Posting Analyzer requires a Google sign-in. Your profile and saved
        postings follow your account across devices.
      </p>
      <SignInButton signingIn={signingIn} onClick={() => void handleSignIn()} />
      {error && <GateError message={error} />}
    </GateCard>
  );
}

function GateCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-64 items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 text-center dark:border-gray-800 dark:bg-gray-900">
        {children}
      </div>
    </div>
  );
}

function SignInButton({
  signingIn,
  onClick,
}: {
  signingIn: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={signingIn}
      aria-label="Sign in with Google"
      aria-busy={signingIn}
      className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70"
    >
      {signingIn ? (
        <span role="status">Signing in…</span>
      ) : (
        "Sign in with Google"
      )}
    </button>
  );
}

function GateError({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}
