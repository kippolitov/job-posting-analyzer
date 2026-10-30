import { useState } from "react";
import type { Fit, JobAnalysisResponse } from "shared/types/job";
import { evidenceFor, scoredByLabel } from "shared/fitView";
import { VerdictBadge } from "@/components/VerdictBadge";
import { formatSalary } from "@/lib/formatJob";

interface ConfirmControl {
  confirm: (label: string) => void;
  confirmed: ReadonlySet<string>;
  pending: boolean;
}

function ConfirmButton({ item, control }: { item: string; control: ConfirmControl }) {
  if (control.confirmed.has(item)) {
    return <span className="text-xs text-green-700 dark:text-green-400">Added to your profile</span>;
  }
  return (
    <button
      type="button"
      aria-label={`I have ${item}`}
      disabled={control.pending}
      onClick={() => control.confirm(item)}
      className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      I have this
    </button>
  );
}

function FitList({
  title,
  items,
  fit,
  list,
  confirm,
}: {
  title: string;
  items: string[] | undefined;
  fit?: Fit;
  list?: "matching" | "missing" | "desired";
  confirm?: ConfirmControl;
}) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h4>
      <ul className="list-inside list-disc text-sm text-gray-600 dark:text-gray-300">
        {items.map((item) => {
          const evidence = list ? evidenceFor(fit, list, item) : null;
          const confirmButton = confirm && <ConfirmButton item={item} control={confirm} />;
          if (!evidence || !(evidence.postingQuote || evidence.profileQuote)) {
            return (
              <li key={item}>
                {item} {confirmButton}
              </li>
            );
          }
          const open = openLabel === item;
          const regionId = `evidence-${list}-${item.replace(/\W+/g, "-")}`;
          return (
            <li key={item}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? regionId : undefined}
                onClick={() => setOpenLabel(open ? null : item)}
                className="inline-flex items-center underline decoration-dotted underline-offset-2 hover:text-gray-900 dark:hover:text-white"
              >
                {item}
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
                  className={`ml-0.5 inline-block transition-transform ${open ? "rotate-180" : ""}`}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>{" "}
              {confirmButton}
              {open && (
                <div id={regionId} className="mt-1 mb-2 flex flex-col gap-1.5">
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
      <p className="text-xs font-medium uppercase text-gray-500">{source}</p>
      <blockquote className="border-l-2 border-gray-300 pl-3 text-sm italic text-gray-600 dark:border-gray-700 dark:text-gray-300">
        {quote}
      </blockquote>
    </div>
  );
}

/** Renders the full stored analysis (FR-008) — every field an extension user already sees. */
export function AnalysisView({
  analysis,
  onConfirmSkill,
}: {
  analysis: JobAnalysisResponse;
  /** "I have this" (FR-018): resolves once the skill is saved, rejects with a user-facing message. */
  onConfirmSkill?: (label: string) => Promise<unknown>;
}) {
  const salary = formatSalary(analysis);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const confirm: ConfirmControl | undefined = onConfirmSkill && {
    confirmed,
    pending,
    confirm: (label) => {
      setPending(true);
      setConfirmError(null);
      onConfirmSkill(label).then(
        () => {
          setConfirmed((prev) => new Set(prev).add(label));
          setPending(false);
        },
        (err: unknown) => {
          setConfirmError(
            err instanceof Error ? err.message : "Couldn't save to your profile. Try again."
          );
          setPending(false);
        }
      );
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">{analysis.title ?? "Untitled posting"}</h2>
        {analysis.company && (
          <p className="text-gray-600 dark:text-gray-300">{analysis.company}</p>
        )}
        {analysis.location && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{analysis.location}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase text-gray-500">Arrangement</dt>
          <dd className="font-medium capitalize">{analysis.arrangement}</dd>
          {analysis.arrangementConfidence !== "none" && (
            <dd className="text-xs text-gray-500">{analysis.arrangementConfidence}</dd>
          )}
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Seniority</dt>
          <dd className="font-medium capitalize">{analysis.seniority}</dd>
        </div>
        {salary && (
          <div>
            <dt className="text-xs uppercase text-gray-500">Salary</dt>
            <dd className="font-medium">{salary}</dd>
          </div>
        )}
        {(analysis.daysInOffice !== null || analysis.daysRemote !== null) && (
          <div>
            <dt className="text-xs uppercase text-gray-500">Office / remote days</dt>
            <dd className="font-medium">
              {analysis.daysInOffice ?? "?"} in office / {analysis.daysRemote ?? "?"} remote
            </dd>
          </div>
        )}
      </dl>

      {analysis.arrangementEvidence && (
        <blockquote className="border-l-2 border-gray-300 pl-3 text-sm italic text-gray-600 dark:border-gray-700 dark:text-gray-300">
          “{analysis.arrangementEvidence}”
        </blockquote>
      )}

      {analysis.remoteRestrictions && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Remote restrictions: {analysis.remoteRestrictions}
        </p>
      )}

      {analysis.techStack.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Tech stack</h4>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {analysis.techStack.map((tech) => (
              <span
                key={tech}
                className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      )}

      {analysis.fit?.dealbreakersViolated && analysis.fit.dealbreakersViolated.length > 0 && (
        <ul aria-label="Dealbreakers" className="flex flex-col gap-1">
          {analysis.fit.dealbreakersViolated.map((line) => (
            <li
              key={line}
              className="rounded-md bg-red-100 px-3 py-1.5 text-sm font-semibold text-red-800 dark:bg-red-950 dark:text-red-200"
            >
              Violates your dealbreaker: {line}
            </li>
          ))}
        </ul>
      )}

      {analysis.fit && (
        <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-semibold">Fit score</h3>
            <VerdictBadge fit={analysis.fit} large />
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{analysis.fit.rationale}</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{scoredByLabel(analysis)}</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FitList title="Matching" items={analysis.fit.matching} fit={analysis.fit} list="matching" />
            <FitList title="Missing" items={analysis.fit.missing} fit={analysis.fit} list="missing" confirm={confirm} />
            <FitList title="Desired" items={analysis.fit.desired} fit={analysis.fit} list="desired" confirm={confirm} />
            <FitList title="Strengths" items={analysis.fit.strengths} />
            <FitList title="Weaknesses" items={analysis.fit.weaknesses} />
          </div>
          {confirmError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {confirmError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
