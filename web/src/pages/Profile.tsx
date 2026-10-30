import { useEffect, useState } from "react";
import { fetchProfile, importResume, saveProfile } from "@/api/endpoints";
import { ApiError } from "@/api/apiClient";
import { PreferencesFields } from "@/components/PreferencesFields";
import {
  emptyPreferencesForm,
  formFromPreferences,
  preferencesFromForm,
  type PreferencesForm,
} from "shared/preferencesForm";

// Must match PROFILE_TEXT_MAX in functions/src/models/user.ts and the
// extension's services/profileStorage.ts — the server enforces this too.
const PROFILE_TEXT_MAX = 20_000;

/** Profile view + editor (FR-014/FR-015, US3 scenarios 2–3): one shared profile. */
export function Profile() {
  const [text, setText] = useState("");
  const [dealbreakers, setDealbreakers] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preferences, setPreferences] = useState<PreferencesForm>(emptyPreferencesForm());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((result) => {
        if (cancelled) return;
        setText(result?.text ?? "");
        setDealbreakers(result?.dealbreakers.join("\n") ?? "");
        setPreferences(formFromPreferences(result?.preferences));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load your profile.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const overLimit = text.length > PROFILE_TEXT_MAX;

  async function handleImport(file: File) {
    setImporting(true);
    setImportError(null);
    setSaved(false);
    try {
      setText(await importResume(file));
    } catch (err) {
      setImportError(
        err instanceof ApiError ? err.message : "The file could not be imported. Try again."
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleSave() {
    setSaveError(null);
    setSaved(false);
    if (overLimit) {
      setSaveError(`Profile text must be ${PROFILE_TEXT_MAX.toLocaleString()} characters or fewer.`);
      return;
    }
    const parsed = preferencesFromForm(preferences);
    if (parsed.error) {
      setSaveError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const updated = await saveProfile({
        text,
        // Blank lines are dropped server-side; the extension sends raw lines too.
        dealbreakers: dealbreakers.split("\n"),
        preferences: parsed.preferences,
      });
      // Reflect the server-normalized dealbreakers (trimmed, blanks dropped).
      setDealbreakers(updated.dealbreakers.join("\n"));
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't save your profile. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading your profile…</div>;
  }

  if (loadError) {
    return (
      <div role="alert" className="p-6 text-red-600">
        {loadError}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Candidate profile</h2>

      <section aria-labelledby="profile-resume-heading" className="flex flex-col gap-2">
        <h3 id="profile-resume-heading" className="text-base font-semibold">
          Résumé
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="profile-import"
            className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Import a résumé (.pdf or .docx)
          </label>
          <input
            id="profile-import"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleImport(file);
            }}
          />
          {importing && (
            <span role="status" className="text-sm text-gray-500">
              Reading your file…
            </span>
          )}
          <span className="text-xs text-gray-500">
            The file is read and discarded. Nothing is saved until you save.
          </span>
        </div>
        {importError && (
          <p role="alert" className="text-sm text-red-600">
            {importError}
          </p>
        )}
        <label className="flex flex-col gap-1">
          <span className="sr-only">Profile</span>
          <textarea
            aria-label="Profile"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            className="w-full rounded-md border border-gray-300 p-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <span
            className={`text-xs ${overLimit ? "text-red-600" : "text-gray-500"}`}
            aria-live="polite"
          >
            {text.length.toLocaleString()} / {PROFILE_TEXT_MAX.toLocaleString()}
          </span>
        </label>
        {overLimit && (
          <p className="text-xs text-red-600">
            Profile text must be {PROFILE_TEXT_MAX.toLocaleString()} characters or fewer.
          </p>
        )}
      </section>

      <section aria-labelledby="profile-dealbreakers-heading" className="flex flex-col gap-1">
        <h3 id="profile-dealbreakers-heading" className="text-base font-semibold">
          Dealbreakers
        </h3>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Dealbreakers (one per line)</span>
          <span className="text-xs text-gray-500">
            A posting that violates a dealbreaker is flagged next to its score.
          </span>
          <textarea
            aria-label="Dealbreakers"
            value={dealbreakers}
            onChange={(e) => setDealbreakers(e.target.value)}
            rows={3}
            placeholder={"no fully on-site roles\nno defense industry"}
            className="w-full rounded-md border border-gray-300 p-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      </section>

      <section aria-labelledby="profile-preferences-heading" className="flex flex-col gap-1">
        <h3 id="profile-preferences-heading" className="text-base font-semibold">
          Preferences
        </h3>
        <p className="text-xs text-gray-500">
          Checked against each posting. A posting that doesn&apos;t match is flagged like a
          dealbreaker, and the fit score is unchanged.
        </p>
        <PreferencesFields
          form={preferences}
          onChange={(next) => {
            setPreferences(next);
            setSaved(false);
          }}
        />
      </section>

      {saveError && (
        <p role="alert" className="text-sm text-red-600">
          {saveError}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          Saved.
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || overLimit}
          className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
