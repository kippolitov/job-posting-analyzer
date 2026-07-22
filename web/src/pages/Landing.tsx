import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { renderSignInButton } from "@/auth/googleIdentity";

/**
 * Public landing page (FR-002): explains the product and routes to sign-in.
 * Fetches nothing — no account API call fires until a session exists.
 */
export function Landing() {
  const { session, initializing, promptSignIn, authError, dismissAuthError } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initializing && buttonRef.current) {
      renderSignInButton(buttonRef.current);
    }
  }, [initializing]);

  if (session) {
    return <Navigate to="/library" replace />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-semibold">Job Posting Analyzer</h1>
      <p className="text-gray-600 dark:text-gray-300">
        Sign in with the same Google account you use in the browser extension to see your saved
        postings and candidate profile, and analyze a job posting from an uploaded document — all
        in one place.
      </p>
      {authError && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {authError}{" "}
          <button type="button" onClick={dismissAuthError} className="underline">
            Dismiss
          </button>
        </p>
      )}
      <div ref={buttonRef} />
      <button
        type="button"
        onClick={promptSignIn}
        disabled={initializing}
        className="rounded-md bg-blue-600 px-6 py-3 text-white disabled:opacity-50"
      >
        Sign in with Google
      </button>
    </div>
  );
}
