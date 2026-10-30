import type { JobAnalysisResponse } from "shared/types/job";

/** The one salary format, shared by the detail page and the library (FR-030). */
export function formatSalary(analysis: JobAnalysisResponse): string | null {
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
