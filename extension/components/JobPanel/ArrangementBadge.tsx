import type { Arrangement } from "../../types/job";

interface ArrangementBadgeProps {
  arrangement: Arrangement;
  daysInOffice: number | null;
  daysRemote: number | null;
}

const STYLES: Record<Arrangement, string> = {
  remote:
    "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
  hybrid: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  onsite: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  unspecified:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const LABELS: Record<Arrangement, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unspecified: "Unspecified",
};

export function ArrangementBadge({
  arrangement,
  daysInOffice,
  daysRemote,
}: ArrangementBadgeProps) {
  let label = LABELS[arrangement];
  if (arrangement === "hybrid" && daysInOffice !== null) {
    label = `Hybrid · ${daysInOffice} ${daysInOffice === 1 ? "day" : "days"} office`;
    if (daysRemote !== null) {
      label += ` / ${daysRemote} remote`;
    }
  }

  return (
    <span
      aria-label={`Work arrangement: ${label}`}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[arrangement]}`}
    >
      {label}
    </span>
  );
}
