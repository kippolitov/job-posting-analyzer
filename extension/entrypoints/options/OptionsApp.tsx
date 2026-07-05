import { useEffect, useState } from "react";
import {
  getProfile,
  setProfile,
  clearProfile,
  PROFILE_TEXT_MAX,
} from "../../services/profileStorage";

export function OptionsApp() {
  const [text, setText] = useState("");
  const [dealbreakers, setDealbreakers] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const profile = await getProfile();
      if (profile) {
        setText(profile.text);
        setDealbreakers(profile.dealbreakers.join("\n"));
      }
      setLoaded(true);
    })();
  }, []);

  const handleSave = async () => {
    await setProfile({
      text,
      dealbreakers: dealbreakers.split("\n"),
    });
    setFeedback("Profile saved.");
  };

  const handleClear = async () => {
    await clearProfile();
    setText("");
    setDealbreakers("");
    setFeedback("Profile cleared.");
  };

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
        </div>
      </div>
    </main>
  );
}
