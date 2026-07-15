import { useEffect, useRef, useState } from "react";
import {
  fetchAccount,
  startCheckout,
  openBillingPortal,
  pollForUpgrade,
  AlreadyPremiumError,
  NoSubscriptionError,
  type AccountState,
} from "../services/accountService";

/**
 * Plan, usage, and renewal state — always visible, never requiring the user
 * to hunt for it (contracts/billing-api.md, FR-013). Fetched on mount and on
 * window focus (uncached, mirrors withAuth's revocation/activation
 * property); a checkout tab triggers short-interval polling until the
 * webhook flips tier (SC-004, ≤ 1 min typical).
 */
export function AccountBar() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const stopPollRef = useRef<(() => void) | null>(null);

  const checkoutPending = useDelayedPending(checkoutBusy);
  const portalPending = useDelayedPending(portalBusy);

  useEffect(() => {
    const load = () => {
      fetchAccount()
        .then((next) => {
          setAccount(next);
          setError(null);
        })
        .catch(() => setError("Couldn't load your account."));
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("focus", load);
      stopPollRef.current?.();
    };
  }, []);

  const handleUpgrade = async () => {
    setCheckoutBusy(true);
    setError(null);
    try {
      const { checkoutUrl } = await startCheckout();
      window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      stopPollRef.current?.();
      stopPollRef.current = pollForUpgrade((next) => setAccount(next));
    } catch (err) {
      setError(
        err instanceof AlreadyPremiumError
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
        err instanceof NoSubscriptionError
          ? "No subscription to manage yet."
          : "Couldn't open the portal. Try again."
      );
    } finally {
      setPortalBusy(false);
    }
  };

  if (!account) {
    return (
      <div
        role="status"
        aria-label="Loading account"
        className="border-b border-gray-200/70 bg-white px-3 py-1.5 text-xs text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-500"
      >
        {error ?? "Loading…"}
      </div>
    );
  }

  const planLabel = account.tier === "premium" ? "Premium" : "Free";

  return (
    <div className="flex flex-col gap-1 border-b border-gray-200/70 bg-white px-3 py-1.5 text-xs dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-1.5">
            <span
              aria-label={`Plan: ${planLabel}`}
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                account.tier === "premium"
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                  : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {planLabel}
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              {account.usage.count} of {account.usage.limit} analyses this month
            </span>
          </div>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {describeSubscription(account)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {account.tier === "free" && (
            <button
              onClick={() => void handleUpgrade()}
              aria-label="Upgrade to Premium"
              aria-busy={checkoutPending}
              disabled={checkoutBusy}
              className="rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70"
            >
              {checkoutPending ? "Opening…" : "Upgrade"}
            </button>
          )}
          {account.subscription && (
            <button
              onClick={() => void handleManage()}
              aria-label="Manage subscription"
              aria-busy={portalPending}
              disabled={portalBusy}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-wait disabled:opacity-70 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {portalPending ? "Opening…" : "Manage subscription"}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[10px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Stable display vocabulary (Principle III, contracts/billing-api.md). */
function describeSubscription(account: AccountState): string {
  const sub = account.subscription;
  if (!sub) return "Free plan";
  if (sub.status === "past_due") {
    return "Payment problem — update your payment method";
  }
  if (sub.endsAt) return `Premium until ${formatDate(sub.endsAt)}`;
  if (sub.renewsAt) return `Renews on ${formatDate(sub.renewsAt)}`;
  return "Premium";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** True only once `active` has held for more than delayMs (>300ms feedback contract). */
function useDelayedPending(active: boolean, delayMs = 300): boolean {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!active) {
      setPending(false);
      return;
    }
    const id = setTimeout(() => setPending(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return pending;
}
