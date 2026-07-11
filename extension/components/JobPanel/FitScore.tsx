import type { Fit } from "../../types/job";

interface FitScoreProps {
  fit: Fit | null;
}

export function scoreStyle(score: number): string {
  if (score >= 70)
    return "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300";
  if (score > 20)
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
  return "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300";
}

type Tone = "green" | "red" | "amber";

const CHIP_TONES: Record<Tone, string> = {
  green:
    "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  amber:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
};

const MARKER_TONES: Record<Tone, string> = {
  green: "text-green-600 dark:text-green-400",
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
};

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
    <div className="space-y-3 rounded-xl border border-gray-200/70 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
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
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          My profile
        </button>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300">{fit.rationale}</p>

      <ChipSection label="Matching skills" items={fit.matching} tone="green" />
      <ChipSection label="Missing (required)" items={fit.missing} tone="red" />
      <ChipSection label="Nice to have" items={fit.desired} tone="amber" />
      <BulletSection
        label="Strengths of this role for you"
        items={fit.strengths}
        tone="green"
      />
      <BulletSection
        label="Weaknesses of this role for you"
        items={fit.weaknesses}
        tone="red"
      />
    </div>
  );
}

function ChipSection({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[] | undefined;
  tone: Tone;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </h4>
      <ul aria-label={label} className="flex flex-wrap gap-1">
        {items.map((item) => (
          <li
            key={item}
            className={`rounded-md px-1.5 py-0.5 text-xs ${CHIP_TONES[tone]}`}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BulletSection({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[] | undefined;
  tone: Tone;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </h4>
      <ul aria-label={label} className="space-y-0.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-1.5 text-xs text-gray-600 dark:text-gray-300"
          >
            <span aria-hidden="true" className={MARKER_TONES[tone]}>
              •
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
