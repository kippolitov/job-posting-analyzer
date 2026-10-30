import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rescoreCostLine } from "shared/fitView";
import type { ScoringProfile } from "shared/types/profile";
import { AnalysisView } from "@/components/AnalysisView";
import { PastePosting } from "@/components/PastePosting";
import { UploadDropzone } from "@/components/UploadDropzone";
import { UploadErrors } from "@/components/UploadErrors";
import { analyzeDocument, fetchAccount, fetchProfile, patchJob, saveJob } from "@/api/endpoints";
import type { DocumentAnalysisResult, SavedJobPayload } from "@/api/types";
import { ApiError } from "@/api/apiClient";
import { upsertLibraryJob } from "@/lib/libraryStore";
import { useLibrary } from "@/lib/useLibrary";

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; profile: ScoringProfile | null }
  | { status: "failed" };

type Outcome =
  | { kind: "new" }
  | { kind: "rescored" }
  | { kind: "unavailable" }
  | { kind: "mismatch" };

/**
 * Document-upload and paste-text analysis (FR-017/FR-018/FR-019/FR-027,
 * contracts/analyze-api.md), also the landing place of a document or paste
 * rescore (`?rescore=<key>`, research R7).
 */
export function Upload() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "paste" ? "paste" : "file";
  const rescoreKey = params.get("rescore");

  const library = useLibrary();

  const [profileState, setProfileState] = useState<ProfileState>({ status: "loading" });
  const [costLine, setCostLine] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<DocumentAnalysisResult | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "new" });
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchProfile()
      .then((profile) =>
        setProfileState({
          status: "ready",
          profile:
            profile && profile.text
              ? { text: profile.text, dealbreakers: profile.dealbreakers }
              : null,
        })
      )
      // A profile failure doesn't block analysis; it runs without fit scoring and says so.
      .catch(() => setProfileState({ status: "failed" }));
  }, []);

  // FR-004a: what the rescore will cost, shown before anything is sent.
  useEffect(() => {
    if (!rescoreKey) return;
    let cancelled = false;
    fetchAccount()
      .then(({ usage }) => {
        if (cancelled || usage.rescoresUsed === undefined || usage.rescoresLimit === undefined) {
          return;
        }
        setCostLine(
          rescoreCostLine({
            rescoresUsed: usage.rescoresUsed,
            rescoresLimit: usage.rescoresLimit,
            count: usage.count,
            limit: usage.limit,
          })
        );
      })
      .catch(() => {
        // The cost line is a courtesy.
      });
    return () => {
      cancelled = true;
    };
  }, [rescoreKey]);

  const settled = profileState.status !== "loading";
  const profileData = profileState.status === "ready" ? (profileState.profile ?? undefined) : undefined;

  function setMode(next: "file" | "paste") {
    const nextParams = new URLSearchParams(params);
    if (next === "paste") nextParams.set("mode", "paste");
    else nextParams.delete("mode");
    setParams(nextParams, { replace: true });
  }

  /** The saved entry a rescore targets, found by its key once the library has loaded. */
  async function findRescoreTarget(): Promise<SavedJobPayload | null> {
    if (!rescoreKey || library.status !== "loaded") return null;
    const { saveKeyFor } = await import("@/lib/saveKey");
    for (const job of library.jobs) {
      if ((await saveKeyFor(job.canonicalUrl)) === rescoreKey) return job;
    }
    return null;
  }

  async function run(input: { file: File } | { text: string }) {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setSaved(false);
    setSaveError(null);
    setOutcome({ kind: "new" });
    try {
      const target = await findRescoreTarget();
      const analyzed = await analyzeDocument({
        ...input,
        profileData,
        ...(rescoreKey
          ? {
              rescore: true,
              priorFingerprint: target?.analysis.fit?.profileFingerprint ?? null,
            }
          : {}),
      });
      setResult(analyzed);

      if (rescoreKey && target && analyzed.saveKey === rescoreKey) {
        try {
          if (analyzed.postingUnavailable) {
            // Keep the stored score; only note that the posting is gone (FR-005).
            const updated = await patchJob(rescoreKey, {
              unavailableAt: new Date().toISOString(),
            });
            upsertLibraryJob(updated);
            setOutcome({ kind: "unavailable" });
          } else {
            const updated = await patchJob(rescoreKey, { analysis: analyzed.analysis });
            upsertLibraryJob(updated);
            setOutcome({ kind: "rescored" });
            setSaved(true);
          }
        } catch (err) {
          setSaveError(
            err instanceof ApiError ? err.message : "Couldn't update the saved posting. Try again."
          );
        }
      } else if (rescoreKey) {
        setOutcome({ kind: "mismatch" });
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError(0, "SERVICE_ERROR", "Analysis failed. Try again.", true)
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setSaveError(null);
    try {
      const now = new Date().toISOString();
      const payload: SavedJobPayload = {
        schemaVersion: 1,
        canonicalUrl: result.canonicalUrl,
        sourceUrl: "",
        source: result.source,
        filename: result.source === "document" ? (result.filename ?? "") : "",
        analysis: result.analysis,
        status: "interested",
        notes: "",
        savedAt: now,
        updatedAt: now,
      };
      const savedJob = await saveJob(result.saveKey, payload);
      upsertLibraryJob(savedJob);
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't save this posting. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  const busy = analyzing || !settled;
  const profileFailed = profileState.status === "failed";
  const showSave = result && outcome.kind !== "rescored" && outcome.kind !== "unavailable";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Analyze a posting</h2>

      <div role="radiogroup" aria-label="Posting source" className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="mode"
            checked={mode === "file"}
            onChange={() => setMode("file")}
          />
          Upload a file
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="mode"
            checked={mode === "paste"}
            onChange={() => setMode("paste")}
          />
          Paste text
        </label>
      </div>

      {rescoreKey && costLine && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{costLine}</p>
      )}
      {!settled && <p className="text-sm text-gray-500">Loading your profile…</p>}

      {mode === "paste" ? (
        <PastePosting onAnalyze={(text) => void run({ text })} disabled={busy} />
      ) : (
        <UploadDropzone onFileSelected={(file) => void run({ file })} disabled={busy} />
      )}
      {analyzing && <p className="text-sm text-gray-500">Analyzing…</p>}
      {error && <UploadErrors error={error} />}
      {result && (
        <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
          <p className="mb-2 text-xs uppercase text-gray-400">
            {result.source === "paste" ? "From pasted text" : `From ${result.filename}`}
          </p>
          {outcome.kind === "unavailable" && (
            <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">
              Posting no longer available — score can’t be updated
            </p>
          )}
          {outcome.kind === "mismatch" && (
            <p role="status" className="mb-2 text-sm text-amber-800 dark:text-amber-300">
              This didn’t match the saved posting, so it was analyzed as a new one.
            </p>
          )}
          {profileFailed && !result.analysis.fit && (
            <p role="status" className="mb-2 text-sm text-amber-800 dark:text-amber-300">
              Fit not scored — your profile couldn’t be loaded
            </p>
          )}
          <AnalysisView analysis={result.analysis} />
          <div className="mt-4 flex items-center gap-3">
            {showSave && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || saved}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {saved ? "Saved" : saving ? "Saving…" : "Save to library"}
              </button>
            )}
            {saved && (
              <span role="status" className="text-sm text-green-700 dark:text-green-400">
                {outcome.kind === "rescored"
                  ? "Rescored and updated in your library."
                  : "Saved to your library."}
              </span>
            )}
          </div>
          {saveError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {saveError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
