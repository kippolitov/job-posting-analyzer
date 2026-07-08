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
    <AuthGate>
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
      setFeedback("Profile cleared.");
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
      <main className="min-h-screen bg-gray-50 px-6 py-8 dark:bg-gray-950">
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
    <main className="min-h-screen bg-gray-50 px-6 py-8 dark:bg-gray-950">
      <div className="mx-auto max-w-xl">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
          Candidate profile
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Used to compute the fit score when you analyze a job posting. Stored
          only in this browser and sent only with analysis requests.
        </p>

        <label
          htmlFor="profile-text"
          className="mt-6 block text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          Your background (skills, seniority, domains)
        </label>
        <textarea
          id="profile-text"
          value={text}
          maxLength={PROFILE_TEXT_MAX}
          onChange={(e) => {
            setText(e.target.value);
            setFeedback(null);
          }}
          rows={8}
          placeholder="e.g. Principal-level .NET engineer; 10 years building distributed systems on Azure; strong in C#, Kubernetes, event-driven architecture; prefer product companies."
          className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          disabled={!loaded}
        />
        <p className="mt-1 text-right text-xs text-gray-400 dark:text-gray-500">
          {text.length.toLocaleString()} / {PROFILE_TEXT_MAX.toLocaleString()}
        </p>

        <label
          htmlFor="profile-dealbreakers"
          className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-200"
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
          className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          disabled={!loaded}
        />

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => void handleSave()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Save profile
          </button>
          <button
            onClick={() => void handleClear()}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Clear
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
