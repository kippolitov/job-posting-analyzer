import { useEffect, useRef, useState } from "react";
import { openBillingPortal, pollForUpgrade, startCheckout } from "@/api/endpoints";
import { ApiError } from "@/api/apiClient";
import type { AccountPayload } from "@/api/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Current plan, monthly usage vs cap, renewal state (FR-016), and
 * upgrade/manage-subscription actions — mirrors extension/components/
 * AccountBar.tsx's billing UX (same POST /api/billing/checkout|portal
 * endpoints, already CORS-anonymous specifically so the web SPA can call
 * them; contracts/consumed-endpoints.md).
 */
export function UsagePlanBanner({
  account,
  onAccountChange,
}: {
  account: AccountPayload;
  onAccountChange?: (next: AccountPayload) => void;
}) {
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopPollRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopPollRef.current?.(), []);

  const handleUpgrade = async () => {
    setCheckoutBusy(true);
    setError(null);
    try {
      const { checkoutUrl } = await startCheckout();
      window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      stopPollRef.current?.();
      if (onAccountChange) {
        stopPollRef.current = pollForUpgrade(onAccountChange);
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "CONFLICT"
          ? "You're already on Premium."
          : "Couldn't open checkout. Try again."
      );
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleManage = async () => {
    setPortalBusy(true);
    setError(null);
    try {
      const { portalUrl } = await openBillingPortal();
      window.open(portalUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "NOT_FOUND"
          ? "No subscription to manage yet."
          : "Couldn't open the portal. Try again."
      );
    } finally {
      setPortalBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold capitalize">{account.tier} plan</span>
        <span className="text-sm text-gray-500">{account.email}</span>
      </div>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        {account.usage.count.toLocaleString()} / {account.usage.limit.toLocaleString()} analyses
        used this month. Resets {formatDate(account.usage.resetsAt)}.
      </p>
      {account.subscription ? (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Subscription: <span className="capitalize">{account.subscription.status}</span>
          {account.subscription.renewsAt &&
            ` — renews ${formatDate(account.subscription.renewsAt)}`}
          {account.subscription.endsAt && ` — ends ${formatDate(account.subscription.endsAt)}`}
        </p>
      ) : (
        <p className="mt-1 text-sm text-gray-500">No active subscription.</p>
      )}
      <div className="mt-3 flex items-center gap-3">
        {account.tier === "free" && (
          <button
            type="button"
            onClick={() => void handleUpgrade()}
            disabled={checkoutBusy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70"
          >
            {checkoutBusy ? "Opening…" : "Upgrade to Premium"}
          </button>
        )}
        {account.subscription && (
          <button
            type="button"
            onClick={() => void handleManage()}
            disabled={portalBusy}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-wait disabled:opacity-70 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {portalBusy ? "Opening…" : "Manage subscription"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
