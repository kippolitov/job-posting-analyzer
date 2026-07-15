import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsageExhausted } from "../../components/UsageExhausted";
import type { UsageInfo } from "../../types/job";

const freeUsage: UsageInfo = {
  count: 50,
  limit: 50,
  resetsAt: "2026-08-01T00:00:00Z",
  tier: "free",
};

describe("UsageExhausted", () => {
  it("renders the exhaustion message with the actual limit and tier", async () => {
    render(<UsageExhausted usage={freeUsage} onUpgrade={vi.fn()} />);
    expect(
      await screen.findByText(/you.ve used all 50 free analyses this month/i)
    ).toBeInTheDocument();
  });

  it("renders a concrete reset date", async () => {
    render(<UsageExhausted usage={freeUsage} onUpgrade={vi.fn()} />);
    expect(await screen.findByText(/august 1/i)).toBeInTheDocument();
  });

  it("renders as a designed status region with an accessible label (never a generic error banner)", async () => {
    render(<UsageExhausted usage={freeUsage} onUpgrade={vi.fn()} />);
    expect(
      await screen.findByRole("status", { name: /allowance used/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("free tier: shows an Upgrade action that invokes onUpgrade", async () => {
    const onUpgrade = vi.fn();
    render(<UsageExhausted usage={freeUsage} onUpgrade={onUpgrade} />);
    const upgradeButton = await screen.findByRole("button", {
      name: /upgrade to premium/i,
    });
    await userEvent.click(upgradeButton);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("premium tier: names the premium limit and hides the Upgrade action", async () => {
    render(
      <UsageExhausted
        usage={{ count: 300, limit: 300, resetsAt: "2026-08-01T00:00:00Z", tier: "premium" }}
        onUpgrade={vi.fn()}
      />
    );
    expect(
      await screen.findByText(/you.ve used all 300 premium analyses this month/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /upgrade to premium/i })
    ).not.toBeInTheDocument();
  });
});
