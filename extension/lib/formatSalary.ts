import type { Salary } from "../types/job";

export function formatSalary(salary: Salary): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const range =
    salary.min !== null && salary.max !== null && salary.min !== salary.max
      ? `${fmt(salary.min)}–${fmt(salary.max)}`
      : fmt(salary.min ?? salary.max ?? 0);
  const currency = salary.currency ? `${salary.currency} ` : "";
  const period = salary.period ? ` / ${salary.period}` : "";
  return `${currency}${range}${period}`;
}
