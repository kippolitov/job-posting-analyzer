import type { Fit } from "../../types/job";

interface FitScoreProps {
  fit: Fit | null;
}

function scoreStyle(score: number): string {
  if (score >= 70)
    return "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300";
  if (score > 20)
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
  return "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300";
}

export function FitScore({ fit }: FitScoreProps) {
  if (!fit) {
    return (
      <div className="rounded-xl border border-gray-200/70 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Fit score
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Set up your candidate profile to see how well postings match your
          background.
        </p>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Configure profile
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200/70 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Fit score
        </h3>
        <span
          aria-label={`Fit score: ${fit.score} out of 100`}
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold ${scoreStyle(fit.score)}`}
        >
          {fit.score}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300">{fit.rationale}</p>
    </div>
  );
}
