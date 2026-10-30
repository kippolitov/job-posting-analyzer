import type { Fit } from "../../types/job";
import { useState } from "react";
import {
  ariaFitLabel,
  evidenceFor,
  normalizeFit,
  previewMissing,
  scoreTone,
  verdictLabel,
  type Freshness,
  type RescoreAction,
  type Verdict,
} from "../../../shared/fitView";

declare const WXT_WEB_APP_URL: string;

interface FitScoreProps {
  fit: Fit | null;
  freshness?: Freshness;
  /** What to offer for an out-of-date score; see `rescoreAction` in shared/fitView. */
  action?: RescoreAction;
  /** FR-004a: what the rescore will cost, from `rescoreCostLine`. */
  costLine?: string | null;
  onRescore?: () => void;
  /** FR-005: the posting is gone, so the score can't be updated. */
  unavailable?: boolean;
  /** The profile could not be loaded, so the fit was not scored. */
  profileUnavailable?: boolean;
  /** `scoredByLabel(analysis)`, shown in the fit details. */
  scoredBy?: string;
}

const FRESHNESS_LABELS: Partial<Record<Freshness, string>> = {
  "out-of-date": "Scored against an older profile",
  "version-unknown": "May be out of date",
  "profile-deleted": "Scored against a deleted profile",
};

/** The marker text for a stale score; `null` when the score is current or unknown. */
export function freshnessLabel(freshness: Freshness): string | null {
  return FRESHNESS_LABELS[freshness] ?? null;
}

/** Hrefs that start with "/" belong to the web app, not the extension. */
function resolveHref(href: string): string {
  return href.startsWith("/") ? `${WXT_WEB_APP_URL}${href}` : href;
}

/**
 * The one place verdict tones become Tailwind classes and icons (FR-010: the
 * text label is always shown, so neither colour nor icon carries meaning alone).
 */
const VERDICT_STYLES: Record<Verdict, { classes: string; icon: string }> = {
  strong: {
    classes: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
    icon: "M20 6 9 17l-5-5",
  },
  "worth-a-shot": {
    classes: "bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-300",
    icon: "M5 12h14M13 6l6 6-6 6",
  },
  stretch: {
    classes: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    icon: "M4 15 12 5l8 10",
  },
  "long-shot": {
    classes: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    icon: "M12 5v14m0 0-6-6m6 6 6-6",
  },
  dealbreaker: {
    classes: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
    icon: "M18 6 6 18M6 6l12 12",
  },
  unrated: {
    classes: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    icon: "M9 9a3 3 0 1 1 4 2.8c-.7.4-1 1-1 1.7M12 17h.01",
  },
};

/** Score number, verdict icon and verdict label, with the accessible name from `ariaFitLabel`. */
export function VerdictBadge({ fit, compact }: { fit: Fit; compact?: boolean }) {
  const normalized = normalizeFit(fit)!;
  const verdict = scoreTone(normalized);
  const style = VERDICT_STYLES[verdict];
  return (
    <span
      role="img"
      aria-label={ariaFitLabel(normalized)}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-bold ${
        compact ? "text-xs" : "text-sm"
      } ${style.classes}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
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
      <span className="font-semibold">{verdictLabel(verdict)}</span>
    </span>
  );
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

export function FitScore({
  fit,
  freshness = "unknown",
  action = { kind: "none" },
  costLine,
  onRescore,
  unavailable,
  profileUnavailable,
  scoredBy,
}: FitScoreProps) {
  const [expanded, setExpanded] = useState(false);
  if (!fit && profileUnavailable) {
    return (
      <div className="rounded-xl border border-gray-200/70 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Fit score
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Fit not scored — your profile couldn&rsquo;t be loaded
        </p>
      </div>
    );
  }

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

  const label = freshnessLabel(freshness);
  const violated = fit.dealbreakersViolated ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-gray-200/70 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      {violated.length > 0 && (
        <ul aria-label="Dealbreakers" className="space-y-1">
          {violated.map((line) => (
            <li
              key={line}
              className="rounded-md bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-300"
            >
              Violates your dealbreaker: {line}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Fit score
        </h3>
        <VerdictBadge fit={fit} />
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          My profile
        </button>
      </div>
      {label && (
        <div
          role="status"
          className="rounded-lg bg-amber-50 px-2.5 py-2 dark:bg-amber-950/30"
        >
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            {label}
          </p>
          {action.kind === "rescore-here" || action.kind === "paste-again" ? (
            <button
              onClick={onRescore}
              disabled={!onRescore}
              className="mt-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {action.label}
            </button>
          ) : action.kind !== "none" ? (
            <a
              href={resolveHref(action.href)}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block text-xs font-semibold text-amber-800 underline dark:text-amber-300"
            >
              {action.label}
            </a>
          ) : null}
          {costLine && action.kind !== "none" && (
            <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
              {costLine}
            </p>
          )}
        </div>
      )}
      {unavailable && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Posting no longer available — score can&rsquo;t be updated
        </p>
      )}
      <p className="text-sm text-gray-600 dark:text-gray-300">{fit.rationale}</p>

      {(() => {
        const shown = previewMissing(fit);
        const hasMore =
          (fit.missing?.length ?? 0) > shown.length ||
          (fit.matching?.length ?? 0) > 0 ||
          (fit.desired?.length ?? 0) > 0 ||
          (fit.strengths?.length ?? 0) > 0 ||
          (fit.weaknesses?.length ?? 0) > 0;
        return (
          <>
            <ChipSection
              label="Missing (required)"
              items={expanded ? fit.missing : shown}
              tone="red"
              fit={fit}
              list="missing"
            />
            {expanded && (
              <div id="fit-full-breakdown" className="space-y-3">
                <ChipSection label="Matching skills" items={fit.matching} tone="green" fit={fit} list="matching" />
                <ChipSection label="Nice to have" items={fit.desired} tone="amber" fit={fit} list="desired" />
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
                {scoredBy && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{scoredBy}</p>
                )}
              </div>
            )}
            {hasMore && (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls="fit-full-breakdown"
                onClick={() => setExpanded((v) => !v)}
                className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
              >
                {expanded ? "Hide full breakdown" : "Show full breakdown"}
              </button>
            )}
          </>
        );
      })()}
    </div>
  );
}

function ChipSection({
  label,
  items,
  tone,
  fit,
  list,
}: {
  label: string;
  items: string[] | undefined;
  tone: Tone;
  fit: Fit;
  list: "matching" | "missing" | "desired";
}) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </h4>
      <ul aria-label={label} className="flex flex-wrap gap-1">
        {items.map((item) => {
          const evidence = evidenceFor(fit, list, item);
          const hasQuote = Boolean(evidence?.postingQuote || evidence?.profileQuote);
          const chip = `rounded-md px-1.5 py-0.5 text-xs ${CHIP_TONES[tone]}`;
          if (!evidence || !hasQuote) {
            return (
              <li key={item} className={chip}>
                {item}
              </li>
            );
          }
          const open = openLabel === item;
          const regionId = `evidence-${list}-${item.replace(/\W+/g, "-")}`;
          return (
            <li key={item} className={open ? "w-full" : undefined}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? regionId : undefined}
                onClick={() => setOpenLabel(open ? null : item)}
                className={`${chip} underline decoration-dotted underline-offset-2`}
              >
                {item}
              </button>
              {open && (
                <div id={regionId} className="mt-1 space-y-1">
                  {evidence.postingQuote && (
                    <EvidenceQuote source="From the posting" quote={evidence.postingQuote} />
                  )}
                  {evidence.profileQuote && (
                    <EvidenceQuote source="From your profile" quote={evidence.profileQuote} />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EvidenceQuote({ source, quote }: { source: string; quote: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {source}
      </p>
      <blockquote className="border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600 dark:border-gray-700 dark:text-gray-300">
        {quote}
      </blockquote>
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
