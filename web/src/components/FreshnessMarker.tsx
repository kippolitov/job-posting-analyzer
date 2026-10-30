import { Link } from "react-router-dom";
import { freshness, rescoreAction, type Freshness } from "shared/fitView";
import type { SavedJobPayload } from "@/api/types";
import { useSaveKey } from "@/lib/saveKey";

const LABELS: Partial<Record<Freshness, string>> = {
  "out-of-date": "Scored against an older profile",
  "version-unknown": "May be out of date",
  "profile-deleted": "Scored against a deleted profile",
};

/**
 * Marker and rescore link for a stale score (FR-002, research R7), plus the
 * unavailable note (FR-005). Renders nothing for a current or unknown fit.
 */
export function FreshnessMarker({
  job,
  currentFingerprint,
}: {
  job: SavedJobPayload;
  currentFingerprint: string | null | undefined;
}) {
  const saveKey = useSaveKey(job.canonicalUrl);
  const state = freshness(job.analysis.fit, currentFingerprint);
  const label = LABELS[state];
  const action = rescoreAction({ ...job, saveKey }, state, "list");

  return (
    <>
      {label && (
        <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {label}
          {action.kind !== "none" && action.kind !== "rescore-here" && (
            <>
              {" · "}
              {action.kind === "open-posting" ? (
                <a
                  href={action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline"
                >
                  {action.label}
                </a>
              ) : (
                <Link to={action.href} className="font-medium underline">
                  {action.label}
                </Link>
              )}
            </>
          )}
        </div>
      )}
      {job.unavailableAt && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Posting no longer available — score can’t be updated
        </div>
      )}
    </>
  );
}
