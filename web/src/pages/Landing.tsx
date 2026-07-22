import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { renderSignInButton } from "@/auth/googleIdentity";

/**
 * Public landing page (FR-002): explains the product and routes to sign-in.
 * Fetches nothing — no account API call fires until a session exists.
 */
export function Landing() {
  const { session, initializing, promptSignIn, authError, dismissAuthError } =
    useAuth();
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
        Sign in with the same Google account you use in the browser extension to
        see your saved postings and candidate profile, and analyze a job posting
        from an uploaded document — all in one place.
      </p>
      <DataPracticesDisclosure />
      {authError && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {authError}{" "}
          <button
            type="button"
            onClick={dismissAuthError}
            className="underline"
          >
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

const PRIVACY_POLICY_URL =
  "https://kippolitov.github.io/job-posting-analyzer/legal/privacy-policy.html";
const TERMS_URL =
  "https://kippolitov.github.io/job-posting-analyzer/legal/terms.html";

/**
 * CWS-disclosure-style consent copy (docs/compliance/prominent-disclosure.md
 * "The web app surface"), mirroring extension/components/AuthGate.tsx for
 * this second sign-in surface — shown before the first sign-in action, not
 * collapsed behind a link.
 */
function DataPracticesDisclosure() {
  return (
    <p className="max-w-lg text-left text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      <strong className="text-gray-700 dark:text-gray-300">
        Signing in creates a free account
      </strong>{" "}
      — the same one your browser extension uses, if you have it installed. We
      store your email address, entitlement tier (free or Premium), and monthly
      analysis usage count. If you subscribe to Premium ($5/month), Paddle — our
      payment processor and merchant of record — handles payment; we never see
      your card details, only your subscription status. If you upload a document
      to analyze, its text is extracted and analyzed but the file itself is not
      kept. By continuing, you agree to our{" "}
      <a
        href={PRIVACY_POLICY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Privacy Policy
      </a>{" "}
      and{" "}
      <a
        href={TERMS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Terms of Service
      </a>
      , including the terms of sale for Premium.
    </p>
  );
}
