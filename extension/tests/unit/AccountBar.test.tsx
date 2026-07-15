import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountBar } from "../../components/AccountBar";
import { installFakeAccountApi } from "./helpers/mswAccountServer";
import { installMemoryStorage } from "./helpers/memoryStorage";

const api = installFakeAccountApi();

beforeEach(() => {
  installMemoryStorage("local");
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccountBar", () => {
  it("shows the plan badge and usage count for a free account", async () => {
    render(<AccountBar />);
    expect(await screen.findByLabelText("Plan: Free")).toBeInTheDocument();
    expect(screen.getByText("0 of 50 analyses this month")).toBeInTheDocument();
    expect(screen.getByText("Free plan")).toBeInTheDocument();
  });

  it("shows a Renews on date for an active premium subscription", async () => {
    api.setAccount({
      email: "user@example.com",
      tier: "premium",
      usage: { count: 12, limit: 300, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: { status: "active", renewsAt: "2026-08-03T00:00:00Z", endsAt: null },
    });
    render(<AccountBar />);
    expect(await screen.findByLabelText("Plan: Premium")).toBeInTheDocument();
    expect(screen.getByText("12 of 300 analyses this month")).toBeInTheDocument();
    expect(screen.getByText(/Renews on August 3/)).toBeInTheDocument();
  });

  it("shows a Premium until date when a cancellation is scheduled (FR-020)", async () => {
    api.setAccount({
      email: "user@example.com",
      tier: "premium",
      usage: { count: 12, limit: 300, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: { status: "active", renewsAt: null, endsAt: "2026-09-01T00:00:00Z" },
    });
    render(<AccountBar />);
    expect(await screen.findByLabelText("Plan: Premium")).toBeInTheDocument();
    expect(screen.getByText(/Premium until September 1/)).toBeInTheDocument();
    // Manage subscription remains available — cancel-scheduled accounts
    // still have a paddleCustomerId until the period actually ends.
    expect(
      screen.getByRole("button", { name: /manage subscription/i })
    ).toBeInTheDocument();
  });

  it("shows a payment-problem message with a portal link for a past_due subscription", async () => {
    api.setAccount({
      email: "user@example.com",
      tier: "premium",
      usage: { count: 12, limit: 300, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: { status: "past_due", renewsAt: "2026-08-03T00:00:00Z", endsAt: null },
    });
    render(<AccountBar />);
    expect(await screen.findByLabelText("Plan: Premium")).toBeInTheDocument();
    expect(
      screen.getByText(/Payment problem — update your payment method/)
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /manage subscription/i }));
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://customer-portal.paddle.test/x",
        "_blank",
        "noopener,noreferrer"
      )
    );
  });

  it("a downgraded (free, previously subscribed) account shows Free plan and no Upgrade duplicate state", async () => {
    api.setAccount({
      email: "user@example.com",
      tier: "free",
      usage: { count: 0, limit: 50, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: null,
    });
    render(<AccountBar />);
    expect(await screen.findByLabelText("Plan: Free")).toBeInTheDocument();
    expect(screen.getByText("Free plan")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upgrade to premium/i })
    ).toBeInTheDocument();
  });

  it("shows Free plan (not a stale Premium label) once a canceled subscription's period has actually ended", async () => {
    // The backend keeps returning a subscription record after full
    // cancellation (subscriptionStatus stays a truthy "canceled" string) —
    // the label must key off account.tier, not merely subscription presence.
    api.setAccount({
      email: "user@example.com",
      tier: "free",
      usage: { count: 5, limit: 50, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: { status: "canceled", renewsAt: null, endsAt: null },
    });
    render(<AccountBar />);
    expect(await screen.findByLabelText("Plan: Free")).toBeInTheDocument();
    expect(screen.getByText("Free plan")).toBeInTheDocument();
    expect(screen.queryByText("Premium")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upgrade to premium/i })
    ).toBeInTheDocument();
  });

  it("Upgrade opens the checkout URL in a new tab", async () => {
    render(<AccountBar />);
    await screen.findByLabelText("Plan: Free");
    await userEvent.click(screen.getByRole("button", { name: /upgrade to premium/i }));
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://sandbox-checkout.paddle.test/txn_1",
        "_blank",
        "noopener,noreferrer"
      )
    );
  });

  it("shows a plain-language error when checkout fails", async () => {
    render(<AccountBar />);
    await screen.findByLabelText("Plan: Free");
    api.failNext(502, "BILLING_UNAVAILABLE");
    await userEvent.click(screen.getByRole("button", { name: /upgrade to premium/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t open checkout/i);
  });

  it("Manage subscription opens the portal URL for a subscribed account", async () => {
    api.setAccount({
      email: "user@example.com",
      tier: "premium",
      usage: { count: 12, limit: 300, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: { status: "active", renewsAt: "2026-08-03T00:00:00Z", endsAt: null },
    });
    render(<AccountBar />);
    await screen.findByLabelText("Plan: Premium");
    await userEvent.click(screen.getByRole("button", { name: /manage subscription/i }));
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://customer-portal.paddle.test/x",
        "_blank",
        "noopener,noreferrer"
      )
    );
  });

  it("hides Manage subscription for a free account that never subscribed", async () => {
    render(<AccountBar />);
    await screen.findByLabelText("Plan: Free");
    expect(
      screen.queryByRole("button", { name: /manage subscription/i })
    ).not.toBeInTheDocument();
  });

  it("refetches on window focus (uncached, mirrors withAuth's revocation property)", async () => {
    render(<AccountBar />);
    await screen.findByText("0 of 50 analyses this month");

    api.setAccount({
      email: "user@example.com",
      tier: "free",
      usage: { count: 5, limit: 50, resetsAt: "2026-08-01T00:00:00Z" },
      subscription: null,
    });
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("5 of 50 analyses this month")).toBeInTheDocument();
  });

  it("does not show a stale load-error banner on top of an already-loaded, correct account bar", async () => {
    render(<AccountBar />);
    await screen.findByLabelText("Plan: Free");

    // A later background refresh (window focus) fails transiently — the
    // panel already has good data to show, so this should retry quietly
    // rather than alarm the user with an unrelated red banner.
    api.failNext(500);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByLabelText("Plan: Free")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your account.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  describe("initial-load resilience", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("offers a manual Retry action when the initial load fails, which recovers immediately", async () => {
      api.failNext(500);
      render(<AccountBar />);

      expect(await screen.findByText("Couldn't load your account.")).toBeInTheDocument();
      const retryButton = screen.getByRole("button", { name: /retry/i });

      await userEvent.click(retryButton);
      expect(await screen.findByLabelText("Plan: Free")).toBeInTheDocument();
    });

    it("automatically retries a transient initial-load failure without user action", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      api.failNext(500);
      render(<AccountBar />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Couldn't load your account.")).toBeInTheDocument();

      // failNext was single-shot, so the auto-retry hits the (now healthy) fake API.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(await screen.findByLabelText("Plan: Free")).toBeInTheDocument();
    });
  });

  describe("loading states (>300ms feedback contract)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not show a busy label before 300ms have elapsed", async () => {
      let resolveCheckout: () => void = () => {};
      api.setAccount({
        email: "user@example.com",
        tier: "free",
        usage: { count: 0, limit: 50, resetsAt: "2026-08-01T00:00:00Z" },
        subscription: null,
      });
      render(<AccountBar />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await screen.findByLabelText("Plan: Free");

      const { server } = api;
      const { http, HttpResponse } = await import("msw");
      const { TEST_API_BASE } = await import("./helpers/mswAccountServer");
      server.use(
        http.post(
          `${TEST_API_BASE}/billing/checkout`,
          () =>
            new Promise((resolve) => {
              resolveCheckout = () =>
                resolve(
                  HttpResponse.json({
                    checkoutUrl: "https://sandbox-checkout.paddle.test/txn_slow",
                    transactionId: "txn_slow",
                  })
                );
            })
        )
      );

      const button = screen.getByRole("button", { name: /upgrade to premium/i });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(button);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(button).toHaveTextContent("Upgrade");
      expect(button).toHaveAttribute("aria-busy", "false");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(button).toHaveTextContent("Opening…");
      expect(button).toHaveAttribute("aria-busy", "true");

      resolveCheckout();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    });
  });
});
