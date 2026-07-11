import { useEffect, useState } from "react";
import { AuthGate } from "../../components/AuthGate";
import {
  getProfile,
  setProfile,
  clearProfile,
  PROFILE_TEXT_MAX,
} from "../../services/profileStorage";

export function OptionsApp() {
  return (
    <AuthGate showSignOut={false}>
      <ProfileEditor />
    </AuthGate>
  );
}

function ProfileEditor() {
  const [text, setText] = useState("");
  const [dealbreakers, setDealbreakers] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Server-backed profile: a failed load must show as a failure with Retry,
  // never as an empty form that looks like the profile is gone (FR-015).
  const [loadFailed, setLoadFailed] = useState(false);

  const load = async () => {
    setLoadFailed(false);
    try {
      const profile = await getProfile();
      if (profile) {
        setText(profile.text);
        setDealbreakers(profile.dealbreakers.join("\n"));
      }
      setLoaded(true);
    } catch {
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    try {
      await setProfile({
        text,
        dealbreakers: dealbreakers.split("\n"),
      });
      setError(null);
      setFeedback("Profile saved.");
    } catch (err) {
      setFeedback(null);
      setError(
        err instanceof Error
          ? err.message
          : "The profile could not be saved. Try again."
      );
    }
  };

  const handleClear = async () => {
    try {
      await clearProfile();
      setText("");
      setDealbreakers("");
      setError(null);
      setFeedback("Profile deleted.");
    } catch (err) {
      setFeedback(null);
      setError(
        err instanceof Error
          ? err.message
          : "The profile could not be cleared. Try again."
      );
    }
  };

  if (loadFailed) {
    return (
      <main className="h-full bg-gray-50 px-6 py-8 dark:bg-gray-950">
        <div
          role="alert"
          className="mx-auto max-w-xl rounded-lg border border-red-200 bg-red-50 p-4 text-center dark:border-red-900/60 dark:bg-red-950/40"
        >
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Your profile could not be loaded.
          </p>
          <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
            Check your connection — nothing has been lost.
          </p>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    // Full-height column (inside AuthGate's flex body): the resume editor
    // absorbs all spare height and scrolls internally, so the action buttons
    // in the footer never leave the viewport no matter how long the pasted
    // resume is.
    <main className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col px-8 py-6">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
            Candidate profile
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Used to compute the fit score when you analyze a job posting.
            Stored in your account and sent only with analysis requests.
          </p>
        </div>

        <label
          htmlFor="profile-text"
          className="mt-5 block shrink-0 text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          Your background — paste your entire resume here
        </label>
        <textarea
          id="profile-text"
          value={text}
          maxLength={PROFILE_TEXT_MAX}
          onChange={(e) => {
            setText(e.target.value);
            setFeedback(null);
          }}
          placeholder="Paste your full resume, or describe your background: skills, seniority, domains, preferences."
          className="mt-1 min-h-48 w-full flex-1 resize-none overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-700 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          disabled={!loaded}
        />
        <p className="mt-1 shrink-0 text-right text-xs text-gray-400 dark:text-gray-500">
          {text.length.toLocaleString()} / {PROFILE_TEXT_MAX.toLocaleString()}
        </p>

        <div className="shrink-0">
          <label
            htmlFor="profile-dealbreakers"
            className="mt-2 block text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            Dealbreakers (one per line)
          </label>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            A posting that violates a dealbreaker is capped at a fit score of 20.
          </p>
          <textarea
            id="profile-dealbreakers"
            value={dealbreakers}
            onChange={(e) => {
              setDealbreakers(e.target.value);
              setFeedback(null);
            }}
            rows={3}
            placeholder={"no fully on-site roles\nno defense industry"}
            className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            disabled={!loaded}
          />
        </div>

        <div className="mt-4 flex shrink-0 items-center gap-3 border-t border-gray-200/70 pt-4 dark:border-gray-800">
          <button
            onClick={() => void handleSave()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Save profile
          </button>
          <button
            onClick={() => void handleClear()}
            className="rounded-lg px-5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Delete profile
          </button>
          {feedback && (
            <span role="status" className="text-sm text-green-700 dark:text-green-400">
              {feedback}
            </span>
          )}
          {error && (
            <span role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
