import type { UsageInfo } from "../types/job";

/**
 * The FR-009 exhausted state: rendered whenever postJobAnalysis rejects with
 * a "usage-limit-reached" JobPanelError. Always a designed card — message,
 * concrete reset date, Upgrade action (free tier only) — never the generic
 * error banner (SC-003).
 */
export function UsageExhausted({
  usage,
  onUpgrade,
}: {
  usage: UsageInfo;
  onUpgrade: () => void;
}) {
  const tierLabel = usage.tier === "premium" ? "premium" : "free";

  return (
    <div
      role="status"
      aria-label="Monthly analysis allowance used"
      className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-gray-200/70 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900"
    >
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
        You&rsquo;ve used all {usage.limit} {tierLabel} analyses this month
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Your allowance resets on {formatResetDate(usage.resetsAt)}.
      </p>
      {usage.tier === "free" && (
        <button
          onClick={onUpgrade}
          aria-label="Upgrade to Premium"
          className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Upgrade to Premium
        </button>
      )}
    </div>
  );
}

function formatResetDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
