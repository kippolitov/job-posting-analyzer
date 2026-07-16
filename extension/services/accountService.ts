import { apiFetch } from "./api/apiClient";
import type { UsageInfo } from "../types/job";

/**
 * Account/billing client (contracts/billing-api.md): plan, usage, renewal
 * state for the AccountBar, plus checkout/portal link creation. Never
 * caches — the same uncached-read property that makes tier flips (webhook
 * upgrade or CLI block) effective on the next fetch (SC-004).
 */

export interface AccountSubscription {
  status: "active" | "past_due" | "paused" | "canceled";
  renewsAt: string | null;
  endsAt: string | null;
}

export interface AccountState {
  email: string;
  tier: "free" | "premium";
  usage: { count: number; limit: number; resetsAt: string };
  subscription: AccountSubscription | null;
}

export class AlreadyPremiumError extends Error {}
export class NoSubscriptionError extends Error {}
export class BillingUnavailableError extends Error {}

/** Mirrors functions/src/models/user.ts `SAVED_JOBS_CAP` (data-model.md). */
export const SAVED_JOBS_CAP: Record<"free" | "premium", number> = {
  free: 100,
  premium: 1000,
};

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function fetchAccount(): Promise<AccountState> {
  const response = await apiFetch("/account");
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Couldn't load your account."));
  }
  return (await response.json()) as AccountState;
}

export interface CheckoutResult {
  checkoutUrl: string;
  transactionId: string;
}

export async function startCheckout(): Promise<CheckoutResult> {
  const response = await apiFetch("/billing/checkout", { method: "POST" });
  if (response.status === 409) {
    throw new AlreadyPremiumError(await errorMessage(response, "You're already on Premium."));
  }
  if (response.status === 502) {
    throw new BillingUnavailableError(
      await errorMessage(response, "Couldn't open checkout. Try again.")
    );
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Couldn't open checkout. Try again."));
  }
  return (await response.json()) as CheckoutResult;
}

export interface PortalResult {
  portalUrl: string;
}

export async function openBillingPortal(): Promise<PortalResult> {
  const response = await apiFetch("/billing/portal", { method: "POST" });
  if (response.status === 404) {
    throw new NoSubscriptionError(
      await errorMessage(response, "No subscription to manage yet.")
    );
  }
  if (response.status === 502) {
    throw new BillingUnavailableError(
      await errorMessage(response, "Couldn't open the portal. Try again.")
    );
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Request failed. Please try again."));
  }
  return (await response.json()) as PortalResult;
}

/**
 * Applies an analyze-response `usage` echo (contracts/metering.md) to the
 * current account state — updates the AccountBar without an extra
 * GET /api/account round-trip.
 */
export function mergeUsageEcho(account: AccountState, usage: UsageInfo): AccountState {
  return {
    ...account,
    tier: usage.tier,
    usage: { count: usage.count, limit: usage.limit, resetsAt: usage.resetsAt },
  };
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;

/**
 * Pending-upgrade polling (contracts/billing-api.md client obligations):
 * after the checkout tab opens, poll GET /api/account at a short interval
 * (≤ 60s) until tier flips to premium or the timeout elapses. Returns a
 * stop function; a fetch failure is treated as transient and does not end
 * the poll early.
 */
export function pollForUpgrade(
  onUpdate: (account: AccountState) => void,
  options: { intervalMs?: number; timeoutMs?: number } = {}
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped || Date.now() >= deadline) return;
    try {
      const account = await fetchAccount();
      if (stopped) return;
      onUpdate(account);
      if (account.tier === "premium") return;
    } catch {
      // Transient — keep polling until the deadline.
    }
    if (stopped) return;
    setTimeout(() => void tick(), intervalMs);
  };

  void tick();

  return () => {
    stopped = true;
  };
}
