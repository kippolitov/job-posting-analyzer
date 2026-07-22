import { useEffect, useState } from "react";
import { fetchProfile, saveProfile } from "@/api/endpoints";
import type { ProfilePayload } from "@/api/types";
import { ApiError } from "@/api/apiClient";

// Must match PROFILE_TEXT_MAX in functions/src/models/user.ts and the
// extension's services/profileStorage.ts — the server enforces this too.
const PROFILE_TEXT_MAX = 20_000;

/** Profile view + editor (FR-014/FR-015, US3 scenarios 2–3): one shared profile. */
export function Profile() {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((result) => {
        if (cancelled) return;
        setProfile(result);
        setText(result?.text ?? "");
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

  async function handleSave() {
    setSaveError(null);
    setSaved(false);
    if (overLimit) {
      setSaveError(`Profile text must be ${PROFILE_TEXT_MAX.toLocaleString()} characters or fewer.`);
      return;
    }
    setSaving(true);
    try {
      const updated = await saveProfile({ text, dealbreakers: profile?.dealbreakers ?? [] });
      setProfile(updated);
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
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Candidate profile</h2>
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
