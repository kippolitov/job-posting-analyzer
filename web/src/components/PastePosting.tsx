import { useState } from "react";
import { MAIN_TEXT_CAP, MIN_TEXT_CHARS } from "shared/types/job";

/** The same wording and bounds as the extension's paste composer (FR-018a, FR-027). */
export function pasteViolation(length: number): string | null {
  if (length < MIN_TEXT_CHARS) return "Paste more of the posting before analyzing.";
  if (length > MAIN_TEXT_CAP) return "Trim it to the posting itself before analyzing.";
  return null;
}

/** Paste-text alternative to a file upload (FR-027): a labelled textarea, a live count and Analyze. */
export function PastePosting({
  onAnalyze,
  disabled,
}: {
  onAnalyze: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [showViolation, setShowViolation] = useState(false);
  const violation = pasteViolation(text.length);

  function handleAnalyze() {
    if (violation) {
      setShowViolation(true);
      return;
    }
    onAnalyze(text);
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="paste-posting" className="text-sm font-medium">
        Pasted job posting
      </label>
      <textarea
        id="paste-posting"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setShowViolation(false);
        }}
        rows={10}
        disabled={disabled}
        className="rounded-md border border-gray-300 p-3 text-sm dark:border-gray-700 dark:bg-gray-900"
      />
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500" aria-live="polite">
          {text.length.toLocaleString()} characters
        </span>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={disabled || text.length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Analyze
        </button>
      </div>
      {showViolation && violation && (
        <p role="alert" className="text-sm text-red-600">
          {violation}
        </p>
      )}
    </div>
  );
}
