import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

describe("profile + account (US3, contracts/consumed-endpoints.md)", () => {
  const api = installFakeApi();

  it("PUT /api/profile over-limit surfaces the plain-language 20,000-char message", async () => {
    seedSession();
    api.setProfile({
      text: "Existing profile text.",
      dealbreakers: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    });
    window.history.pushState({}, "", "/profile");
    render(<App />);

    const textarea = await screen.findByRole("textbox", { name: /profile/i });

    // Forced only now — the initial GET /api/profile must succeed normally;
    // only the PUT triggered by Save should hit the server's 400.
    api.failNext("profile", {
      status: 400,
      code: "INVALID_REQUEST",
      message: "Profile text must be 20,000 characters or fewer.",
    });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "some updated text");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await screen.findByText(/20,000 characters/i);
  });

  it("GET /api/account renders plan, usage, and renewal state", async () => {
    seedSession();
    api.setAccount({
      email: "user@example.com",
      tier: "premium",
      usage: { count: 42, limit: 300, resetsAt: "2026-08-01T00:00:00.000Z" },
      subscription: { status: "active", renewsAt: "2026-08-01T00:00:00.000Z", endsAt: null },
    });

    window.history.pushState({}, "", "/account");
    render(<App />);

    await screen.findByText(/premium/i);
    expect(screen.getByText(/42/)).toBeInTheDocument();
    expect(screen.getByText(/300/)).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it("Upgrade to Premium opens the checkout URL in a new tab (contracts/consumed-endpoints.md billing/checkout)", async () => {
    seedSession();
    vi.spyOn(window, "open").mockImplementation(() => null);
    window.history.pushState({}, "", "/account");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /upgrade to premium/i }));

    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://sandbox-checkout.paddle.test/txn_1",
        "_blank",
        "noopener,noreferrer"
      )
    );
  });

  it("shows a plain-language error when checkout fails", async () => {
    seedSession();
    window.history.pushState({}, "", "/account");
    render(<App />);

    await screen.findByRole("button", { name: /upgrade to premium/i });
    api.failNext("billing-checkout", {
      status: 502,
      code: "BILLING_UNAVAILABLE",
      message: "Couldn't open checkout. Try again.",
    });
    await userEvent.click(screen.getByRole("button", { name: /upgrade to premium/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t open checkout/i);
  });

  it("shows 'already on Premium' when checkout is attempted on an already-premium account", async () => {
    seedSession();
    api.setAccount({
      email: "user@example.com",
      tier: "free",
      usage: { count: 0, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z" },
      subscription: null,
    });
    window.history.pushState({}, "", "/account");
    render(<App />);

    await screen.findByRole("button", { name: /upgrade to premium/i });
    api.failNext("billing-checkout", {
      status: 409,
      code: "ALREADY_PREMIUM",
      message: "You're already on Premium.",
    });
    await userEvent.click(screen.getByRole("button", { name: /upgrade to premium/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already on premium/i);
  });

  it("Manage subscription opens the portal URL for a subscribed account", async () => {
    seedSession();
    vi.spyOn(window, "open").mockImplementation(() => null);
    api.setAccount({
      email: "user@example.com",
      tier: "premium",
      usage: { count: 12, limit: 300, resetsAt: "2026-08-01T00:00:00.000Z" },
      subscription: { status: "active", renewsAt: "2026-08-03T00:00:00.000Z", endsAt: null },
    });
    window.history.pushState({}, "", "/account");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /manage subscription/i }));

    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://customer-portal.paddle.test/x",
        "_blank",
        "noopener,noreferrer"
      )
    );
  });

  it("hides Manage subscription for a free account that never subscribed, and hides Upgrade for Premium", async () => {
    seedSession();
    api.setAccount({
      email: "user@example.com",
      tier: "premium",
      usage: { count: 12, limit: 300, resetsAt: "2026-08-01T00:00:00.000Z" },
      subscription: { status: "active", renewsAt: "2026-08-03T00:00:00.000Z", endsAt: null },
    });
    window.history.pushState({}, "", "/account");
    render(<App />);

    await screen.findByText(/premium plan/i);
    expect(screen.queryByRole("button", { name: /upgrade to premium/i })).not.toBeInTheDocument();
  });
});
