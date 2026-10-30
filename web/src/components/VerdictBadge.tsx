import { ariaFitLabel, normalizeFit, scoreTone, verdictLabel, type Verdict } from "shared/fitView";
import type { Fit } from "shared/types/job";

/**
 * The one place verdict tones become Tailwind classes and icons on the web.
 * Tailwind classes are not shared with the extension (contracts/fit-view.md);
 * the verdict itself comes from the shared mapping, and the text label is
 * always shown so colour is never the only signal (FR-010).
 */
const VERDICT_STYLES: Record<Verdict, { classes: string; icon: string }> = {
  strong: {
    classes: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
    icon: "M20 6 9 17l-5-5",
  },
  "worth-a-shot": {
    classes: "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300",
    icon: "M5 12h14M13 6l6 6-6 6",
  },
  stretch: {
    classes: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    icon: "M4 15 12 5l8 10",
  },
  "long-shot": {
    classes: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    icon: "M12 5v14m0 0-6-6m6 6 6-6",
  },
  dealbreaker: {
    classes: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    icon: "M18 6 6 18M6 6l12 12",
  },
  unrated: {
    classes: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    icon: "M9 9a3 3 0 1 1 4 2.8c-.7.4-1 1-1 1.7M12 17h.01",
  },
};

export function VerdictBadge({ fit, large }: { fit: Fit; large?: boolean }) {
  const normalized = normalizeFit(fit)!;
  const verdict = scoreTone(normalized);
  const style = VERDICT_STYLES[verdict];
  return (
    <span
      role="img"
      aria-label={ariaFitLabel(normalized)}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 font-semibold ${
        large ? "text-base" : "text-xs"
      } ${style.classes}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={style.icon} />
      </svg>
      <span>{normalized.score}</span>
      <span>{verdictLabel(verdict)}</span>
    </span>
  );
}
