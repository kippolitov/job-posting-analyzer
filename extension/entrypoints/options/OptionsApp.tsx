import { useEffect, useState } from "react";
import { AccountBar } from "../../components/AccountBar";
import { AuthGate } from "../../components/AuthGate";
import {
  getProfile,
  setProfile,
  clearProfile,
  importResume,
  PROFILE_TEXT_MAX,
} from "../../services/profileStorage";
import { PreferencesFields } from "../../components/PreferencesFields";
import {
  emptyPreferencesForm,
  formFromPreferences,
  preferencesFromForm,
  type PreferencesForm,
} from "../../../shared/preferencesForm";
import { learnedSelectors } from "../../services/learnedSelectors";
import type { LearnedHostSelector } from "../../services/learnedSelectors";

export function OptionsApp() {
  return (
    <AuthGate showSignOut={false}>
      <div className="flex h-full min-h-0 flex-col overflow-y-auto">
        <AccountBar />
        <ProfileEditor />
        <LearnedRegionsSection />
      </div>
    </AuthGate>
  );
}

/**
 * "Clear region for this site" / "Clear all site regions" (spec FR-031).
 * Clearing is immediate with no confirmation dialog — a cleared site simply
 * falls back to automatic extraction, and a future correction re-teaches it
 * in one action (FR-026b), so the action is low-stakes and reversible.
 */
function LearnedRegionsSection() {
  const [hosts, setHosts] = useState<LearnedHostSelector[] | null>(null);

  const refresh = async () => {
    setHosts(await learnedSelectors.list());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleClear = async (host: string) => {
    await learnedSelectors.clear(host);
    await refresh();
  };

  const handleClearAll = async () => {
    await learnedSelectors.clearAll();
    await refresh();
  };

  if (hosts === null) return null;

  return (
    <section className="mx-auto w-full max-w-4xl shrink-0 border-t border-gray-200/70 px-8 py-6 dark:border-gray-800">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
        Always-analyzed regions
      </h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Sites where you taught the extension which part of the page to
        analyze. Stored only on this device (spec FR-033).
      </p>

      {hosts.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">
          No sites are set to always analyze a specific region yet.
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-gray-200 dark:divide-gray-800">
            {hosts.map((h) => (
              <li key={h.host} className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-700 dark:text-gray-200">{h.host}</span>
                <button
                  onClick={() => void handleClear(h.host)}
                  aria-label={`Clear region for ${h.host}`}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-red-400"
                >
                  Clear
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => void handleClearAll()}
            className="mt-3 rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Clear all site regions
          </button>
        </>
      )}
    </section>
  );
}

function ProfileEditor() {
  const [text, setText] = useState("");
  const [dealbreakers, setDealbreakers] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [preferences, setPreferences] = useState<PreferencesForm>(emptyPreferencesForm());
  const [importing, setImporting] = useState(false);
  const [confirmedSkills, setConfirmedSkills] = useState<string[]>([]);
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
        setPreferences(formFromPreferences(profile.preferences));
        setConfirmedSkills(profile.confirmedSkills ?? []);
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

  const overLimit = text.length > PROFILE_TEXT_MAX;

  const handleImport = async (file: File) => {
    setImporting(true);
    setFeedback(null);
    try {
      setText(await importResume(file));
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The file could not be imported. Try again."
      );
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    const parsed = preferencesFromForm(preferences);
    if (parsed.error) {
      setFeedback(null);
      setError(parsed.error);
      return;
    }
    try {
      await setProfile({
        text,
        dealbreakers: dealbreakers.split("\n"),
        preferences: parsed.preferences,
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

  const handleRemoveSkill = async (skill: string) => {
    try {
      const saved = await setProfile({
        text,
        dealbreakers: dealbreakers.split("\n"),
        confirmedSkills: confirmedSkills.filter((s) => s !== skill),
      });
      setConfirmedSkills(saved.confirmedSkills ?? []);
      setError(null);
      setFeedback("Profile saved.");
    } catch (err) {
      setFeedback(null);
      setError(
        err instanceof Error ? err.message : "The profile could not be saved. Try again."
      );
    }
  };

  const handleClear = async () => {
    try {
      await clearProfile();
      setConfirmedSkills([]);
      setText("");
      setDealbreakers("");
      setPreferences(emptyPreferencesForm());
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
      <main className="min-h-0 flex-1 bg-gray-50 px-6 py-8 dark:bg-gray-950">
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

  const SECTION = "mt-6 shrink-0";
  const HEADING = "text-base font-semibold text-gray-800 dark:text-gray-100";
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-8 pt-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
            Candidate profile
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Used to compute the fit score when you analyze a job posting.
            Stored in your account and sent only with analysis requests.
          </p>
        </div>

        <section aria-labelledby="profile-resume-heading" className={SECTION}>
          <h2 id="profile-resume-heading" className={HEADING}>
            Résumé
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label
              htmlFor="profile-import"
              className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              Import a résumé (.pdf or .docx)
            </label>
            <input
              id="profile-import"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={!loaded || importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleImport(file);
              }}
            />
            {importing && (
              <span role="status" className="text-sm text-gray-500 dark:text-gray-400">
                Reading your file…
              </span>
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500">
              The file is read and discarded. Nothing is saved until you save.
            </span>
          </div>
          <label
            htmlFor="profile-text"
            className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            Your background — paste your entire resume here
          </label>
          <textarea
            id="profile-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFeedback(null);
            }}
            placeholder="Paste your full resume, or describe your background: skills, seniority, domains, preferences."
            className="mt-1 h-64 w-full resize-y overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-700 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            disabled={!loaded}
          />
          <p
            className={`mt-1 text-right text-xs ${
              overLimit ? "text-red-600 dark:text-red-400" : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {text.length.toLocaleString()} / {PROFILE_TEXT_MAX.toLocaleString()}
          </p>
          {overLimit && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Profile text must be {PROFILE_TEXT_MAX.toLocaleString()} characters or fewer.
            </p>
          )}
        </section>

        <section aria-labelledby="profile-dealbreakers-heading" className={SECTION}>
          <h2 id="profile-dealbreakers-heading" className={HEADING}>
            Dealbreakers
          </h2>
          <label
            htmlFor="profile-dealbreakers"
            className="mt-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            Dealbreakers (one per line)
          </label>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            A posting that violates a dealbreaker is flagged next to its score.
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
        </section>

        <section aria-labelledby="profile-preferences-heading" className={SECTION}>
          <h2 id="profile-preferences-heading" className={HEADING}>
            Preferences
          </h2>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Checked against each posting. A posting that doesn&apos;t match is flagged like a
            dealbreaker, and the fit score is unchanged.
          </p>
          <PreferencesFields
            form={preferences}
            onChange={(next) => {
              setPreferences(next);
              setFeedback(null);
            }}
            disabled={!loaded}
          />
        </section>

        {confirmedSkills.length > 0 && (
          <section aria-labelledby="profile-skills-heading" className={SECTION}>
            <h2 id="profile-skills-heading" className={HEADING}>
              Confirmed skills
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Skills you added with &ldquo;I have this&rdquo;. They count as part of your profile.
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {confirmedSkills.map((skill) => (
                <li
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  {skill}
                  <button
                    type="button"
                    aria-label={`Remove ${skill}`}
                    onClick={() => void handleRemoveSkill(skill)}
                    className="rounded-full px-2 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="sticky bottom-0 mt-6 border-t border-gray-200/70 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-8 py-4">
          <button
            onClick={() => void handleSave()}
            disabled={overLimit}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
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
