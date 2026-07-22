import type { JobAnalysisResponse } from "shared/types/job";

function formatSalary(analysis: JobAnalysisResponse): string | null {
  const salary = analysis.salary;
  if (!salary || (salary.min === null && salary.max === null)) return null;
  const parts: string[] = [];
  if (salary.min !== null) parts.push(salary.min.toLocaleString());
  if (salary.max !== null) parts.push(salary.max.toLocaleString());
  const range = parts.join(" – ");
  const currency = salary.currency ? `${salary.currency} ` : "";
  const period = salary.period ? `/${salary.period}` : "";
  return `${currency}${range}${period}`;
}

function FitList({ title, items }: { title: string; items: string[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h4>
      <ul className="list-inside list-disc text-sm text-gray-600 dark:text-gray-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Renders the full stored analysis (FR-008) — every field an extension user already sees. */
export function AnalysisView({ analysis }: { analysis: JobAnalysisResponse }) {
  const salary = formatSalary(analysis);

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

      {analysis.fit && (
        <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-semibold">Fit score</h3>
            <span className="text-2xl font-bold">{analysis.fit.score}</span>
            <span className="text-sm text-gray-500">/ 100</span>
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{analysis.fit.rationale}</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FitList title="Matching" items={analysis.fit.matching} />
            <FitList title="Missing" items={analysis.fit.missing} />
            <FitList title="Desired" items={analysis.fit.desired} />
            <FitList title="Strengths" items={analysis.fit.strengths} />
            <FitList title="Weaknesses" items={analysis.fit.weaknesses} />
          </div>
        </div>
      )}
    </div>
  );
}
