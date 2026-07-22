import type { ChangeEvent } from "react";

/** Client-side type/size hints only — the server remains the source of truth (contracts/analyze-document.md). */
export function UploadDropzone({
  onFileSelected,
  disabled,
}: {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = "";
  }

  return (
    <div className="rounded-md border-2 border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
      <label htmlFor="document-upload" className="block cursor-pointer text-sm">
        <span className="font-medium text-blue-600 dark:text-blue-400">Upload a document</span>
        <span className="block text-gray-500 dark:text-gray-400">.docx or .pdf, up to 10 MB</span>
      </label>
      <input
        id="document-upload"
        type="file"
        accept=".pdf,.docx"
        onChange={handleChange}
        disabled={disabled}
        aria-label="Upload a document"
        className="sr-only"
      />
    </div>
  );
}
