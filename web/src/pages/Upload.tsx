import { useEffect, useState } from "react";
import { AnalysisView } from "@/components/AnalysisView";
import { UploadDropzone } from "@/components/UploadDropzone";
import { UploadErrors } from "@/components/UploadErrors";
import { analyzeDocument, fetchProfile, saveJob } from "@/api/endpoints";
import type { DocumentAnalysisResult, SavedJobPayload } from "@/api/types";
import { ApiError } from "@/api/apiClient";
import { upsertLibraryJob } from "@/lib/libraryStore";

/** Document-upload analysis (FR-017/FR-018/FR-019, contracts/analyze-document.md). */
export function Upload() {
  const [profileText, setProfileText] = useState<string | undefined>(undefined);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<DocumentAnalysisResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchProfile()
      .then((profile) => setProfileText(profile?.text))
      .catch(() => {
        // A profile fetch failure shouldn't block document analysis — it
        // just runs without fit scoring (fit: null), as analyze-job does.
      });
  }, []);

  async function handleFile(file: File) {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setSaved(false);
    setSaveError(null);
    try {
      const analyzed = await analyzeDocument({ file, profile: profileText });
      setResult(analyzed);
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
        source: "document",
        filename: result.filename,
        analysis: result.analysis,
        status: "interested",
        notes: "",
        savedAt: now,
        updatedAt: now,
      };
      const saved = await saveJob(result.saveKey, payload);
      upsertLibraryJob(saved);
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't save this posting. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Analyze a document</h2>
      <UploadDropzone onFileSelected={handleFile} disabled={analyzing} />
      {analyzing && <p className="text-sm text-gray-500">Analyzing…</p>}
      {error && <UploadErrors error={error} />}
      {result && (
        <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
          <p className="mb-2 text-xs uppercase text-gray-400">From {result.filename}</p>
          <AnalysisView analysis={result.analysis} />
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || saved}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saved ? "Saved" : saving ? "Saving…" : "Save to library"}
            </button>
            {saved && (
              <span role="status" className="text-sm text-green-700 dark:text-green-400">
                Saved to your library.
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
