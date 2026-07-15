import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installFakeAccountApi } from "./helpers/mswAccountServer";
import { installMemoryStorage } from "./helpers/memoryStorage";
import {
  fetchAccount,
  startCheckout,
  openBillingPortal,
  mergeUsageEcho,
  pollForUpgrade,
  AlreadyPremiumError,
  NoSubscriptionError,
} from "../../services/accountService";

const api = installFakeAccountApi();

beforeEach(() => {
  installMemoryStorage("local");
});

describe("accountService.fetchAccount", () => {
  it("fetches GET /api/account and returns the parsed state", async () => {
    const account = await fetchAccount();
    expect(account).toMatchObject({
      email: "user@example.com",
      tier: "free",
      usage: { count: 0, limit: 50 },
      subscription: null,
    });
  });

  it("reflects a tier flip on the very next fetch (uncached)", async () => {
    api.setTier("premium");
    const account = await fetchAccount();
    expect(account.tier).toBe("premium");
  });
});

describe("accountService.startCheckout", () => {
  it("returns the checkout URL for a free account", async () => {
    const result = await startCheckout();
    expect(result).toEqual({
      checkoutUrl: "https://sandbox-checkout.paddle.test/txn_1",
      transactionId: "txn_1",
    });
  });

  it("throws AlreadyPremiumError for a premium account", async () => {
    api.setTier("premium");
    await expect(startCheckout()).rejects.toBeInstanceOf(AlreadyPremiumError);
  });
});

describe("accountService.openBillingPortal", () => {
  it("throws NoSubscriptionError when there is no subscription yet", async () => {
    await expect(openBillingPortal()).rejects.toBeInstanceOf(NoSubscriptionError);
  });

  it("returns the portal URL for a subscribed account", async () => {
    api.setAccount({
      email: "user@example.com",
      tier: "premium",
      usage: { count: 10, limit: 300, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: { status: "active", renewsAt: "2026-08-03T00:00:00Z", endsAt: null },
    });
    const result = await openBillingPortal();
    expect(result).toEqual({ portalUrl: "https://customer-portal.paddle.test/x" });
  });
});

describe("accountService.mergeUsageEcho", () => {
  it("updates usage and tier from an analyze-response echo without a round-trip", () => {
    const account = {
      email: "user@example.com",
      tier: "free" as const,
      usage: { count: 1, limit: 50, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: null,
    };
    const merged = mergeUsageEcho(account, {
      count: 2,
      limit: 50,
      resetsAt: "2026-08-01T00:00:00Z",
      tier: "free",
    });
    expect(merged.usage.count).toBe(2);
    expect(merged).not.toBe(account);
    expect(merged.email).toBe(account.email);
  });
});

describe("accountService.pollForUpgrade", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls at the given interval until tier flips to premium, then stops", async () => {
    const onUpdate = vi.fn();
    const stop = pollForUpgrade(onUpdate, { intervalMs: 5_000, timeoutMs: 60_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ tier: "free" });

    api.setTier("premium");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls[1][0]).toMatchObject({ tier: "premium" });

    // No further polling once premium is observed.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops polling at the timeout even if still free", async () => {
    const onUpdate = vi.fn();
    pollForUpgrade(onUpdate, { intervalMs: 5_000, timeoutMs: 12_000 });

    await vi.advanceTimersByTimeAsync(0); // tick 1: t=0
    await vi.advanceTimersByTimeAsync(5_000); // tick 2: t=5s
    await vi.advanceTimersByTimeAsync(5_000); // tick 3: t=10s
    await vi.advanceTimersByTimeAsync(5_000); // would be t=15s, past the 12s deadline
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it("the returned stop function halts polling immediately", async () => {
    const onUpdate = vi.fn();
    const stop = pollForUpgrade(onUpdate, { intervalMs: 5_000, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
