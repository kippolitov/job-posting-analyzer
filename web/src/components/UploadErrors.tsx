import { Link } from "react-router-dom";
import type { ApiError } from "@/api/apiClient";

/** Maps 413/415/422/429 upload failures to plain-language states (FR-020/FR-023, SC-005/SC-007). */
export function UploadErrors({ error }: { error: ApiError }) {
  if (error.code === "USAGE_LIMIT_REACHED") {
    return (
      <div
        role="alert"
        className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      >
        <p>{error.message}</p>
        <Link to="/account" className="mt-2 inline-block font-medium underline">
          Upgrade for a higher monthly limit
        </Link>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {error.message}
    </div>
  );
}
