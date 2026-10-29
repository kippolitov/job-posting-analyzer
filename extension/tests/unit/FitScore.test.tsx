import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FitScore } from "../../components/JobPanel/FitScore";

describe("FitScore", () => {
  it("prompts to configure the profile when no fit is available", async () => {
    render(<FitScore fit={null} />);
    expect(
      screen.getByText(/Set up your candidate profile/)
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Configure profile" }));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it("renders the score with its rationale and accessible label", () => {
    render(
      <FitScore
        fit={{ score: 84, rationale: "Strong match on .NET and Azure." }}
      />
    );
    // No profile fingerprint recorded: a legacy fit has no verdict (FR-009).
    expect(screen.getByLabelText("Unrated, fit 84 out of 100")).toBeInTheDocument();
    expect(screen.getByText("Strong match on .NET and Azure.")).toBeInTheDocument();
  });

  it("opens the profile page from the My profile button beside the score", async () => {
    render(
      <FitScore
        fit={{ score: 84, rationale: "Strong match on .NET and Azure." }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "My profile" }));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it("renders the full breakdown: matching, missing, desired, strengths, weaknesses", async () => {
    render(
      <FitScore
        fit={{
          score: 72,
          rationale: "Solid overlap with a few gaps.",
          matching: ["C# / .NET services", "Azure"],
          missing: ["Kubernetes operations"],
          desired: ["Terraform"],
          strengths: ["Staff scope matches your seniority"],
          weaknesses: ["No container orchestration evidence"],
        }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Show full breakdown" }));

    expect(screen.getByRole("list", { name: "Matching skills" })).toHaveTextContent(
      "C# / .NET services"
    );
    expect(
      screen.getByRole("list", { name: "Missing (required)" })
    ).toHaveTextContent("Kubernetes operations");
    expect(screen.getByRole("list", { name: "Nice to have" })).toHaveTextContent(
      "Terraform"
    );
    expect(
      screen.getByRole("list", { name: "Strengths of this role for you" })
    ).toHaveTextContent("Staff scope matches your seniority");
    expect(
      screen.getByRole("list", { name: "Weaknesses of this role for you" })
    ).toHaveTextContent("No container orchestration evidence");
  });

  it("omits breakdown sections for pre-breakdown fit snapshots and empty lists", () => {
    render(
      <FitScore
        fit={{
          score: 60,
          rationale: "Older snapshot without a breakdown.",
          matching: [],
        }}
      />
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByText("Older snapshot without a breakdown.")
    ).toBeInTheDocument();
  });

  it("renders a dealbreaker verdict distinctly, whatever the score", () => {
    render(
      <FitScore
        fit={{
          score: 95,
          rationale: "Great skills, but on-site.",
          profileFingerprint: "f".repeat(64),
          dealbreakersViolated: ["no on-site roles"],
        }}
      />
    );
    const badge = screen.getByLabelText("Dealbreaker, fit 95 out of 100");
    expect(badge.className).toContain("red");
    expect(badge).toHaveTextContent("Dealbreaker");
  });

  it("lists each violated dealbreaker above the score (FR-006)", () => {
    render(
      <FitScore
        fit={{
          score: 64,
          rationale: "Fine otherwise.",
          profileFingerprint: "f".repeat(64),
          dealbreakersViolated: ["no on-site roles", "no travel"],
        }}
      />
    );
    const banner = screen.getByRole("list", { name: "Dealbreakers" });
    expect(banner).toHaveTextContent("Violates your dealbreaker: no on-site roles");
    expect(banner).toHaveTextContent("Violates your dealbreaker: no travel");
    const score = screen.getByLabelText("Dealbreaker, fit 64 out of 100");
    expect(
      banner.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("an out-of-date fit shows the notice, a Rescore button and the cost line", async () => {
    const onRescore = vi.fn();
    render(
      <FitScore
        fit={{ score: 50, rationale: "r" }}
        freshness="out-of-date"
        action={{ kind: "rescore-here", label: "Rescore" }}
        costLine="Free — 7 of 10 free rescores left this month"
        onRescore={onRescore}
      />
    );
    expect(screen.getByText("Scored against an older profile")).toBeInTheDocument();
    expect(
      screen.getByText("Free — 7 of 10 free rescores left this month")
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rescore" }));
    expect(onRescore).toHaveBeenCalledTimes(1);
  });

  it("a version-unknown fit reads 'May be out of date'", () => {
    render(
      <FitScore
        fit={{ score: 50, rationale: "r" }}
        freshness="version-unknown"
        action={{ kind: "rescore-here", label: "Rescore" }}
      />
    );
    expect(screen.getByText("May be out of date")).toBeInTheDocument();
  });

  it("a fit whose profile was deleted says so and offers no action", () => {
    render(
      <FitScore
        fit={{ score: 50, rationale: "r" }}
        freshness="profile-deleted"
        action={{ kind: "none" }}
      />
    );
    expect(screen.getByText("Scored against a deleted profile")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rescore" })).not.toBeInTheDocument();
  });

  it("a current fit shows no notice", () => {
    render(<FitScore fit={{ score: 50, rationale: "r" }} freshness="current" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("an unavailable posting states that the score can't be updated", () => {
    render(<FitScore fit={{ score: 50, rationale: "r" }} unavailable />);
    expect(
      screen.getByText("Posting no longer available — score can’t be updated")
    ).toBeInTheDocument();
  });

  it("profileUnavailable replaces the Configure profile call to action", () => {
    render(<FitScore fit={null} profileUnavailable />);
    expect(
      screen.getByText("Fit not scored — your profile couldn’t be loaded")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Configure profile" })
    ).not.toBeInTheDocument();
  });

  describe("verdict and layout (006 US2)", () => {
    const FP = "f".repeat(64);

    it.each([
      [90, "Strong match"],
      [70, "Worth a shot"],
      [50, "Stretch"],
      [10, "Long shot"],
    ])("a score of %i shows the label %s as text, with an icon", (score, label) => {
      render(<FitScore fit={{ score, rationale: "r", profileFingerprint: FP }} />);
      const badge = screen.getByLabelText(`${label}, fit ${score} out of 100`);
      expect(badge).toHaveTextContent(label);
      expect(badge.querySelector("svg")).not.toBeNull();
    });

    it("a legacy fit shows the Unrated label", () => {
      render(<FitScore fit={{ score: 72, rationale: "r" }} />);
      expect(screen.getByLabelText("Unrated, fit 72 out of 100")).toHaveTextContent(
        "Unrated — rescore for a verdict"
      );
    });

    it("My profile is a secondary button, not the filled primary style (FR-024)", () => {
      render(<FitScore fit={{ score: 72, rationale: "r" }} />);
      const button = screen.getByRole("button", { name: "My profile" });
      expect(button.className).not.toContain("bg-blue-600");
    });

    it("the default view shows rationale and up to three missing items; the toggle reveals the rest (FR-025)", async () => {
      render(
        <FitScore
          fit={{
            score: 60,
            rationale: "Some gaps.",
            matching: ["Azure"],
            missing: ["a", "b", "c", "d", "e"],
            desired: ["Terraform"],
            strengths: ["Scope"],
            weaknesses: ["Risk"],
          }}
          scoredBy="Scored on Premium"
        />
      );
      const missing = screen.getByRole("list", { name: "Missing (required)" });
      expect(missing.querySelectorAll("li")).toHaveLength(3);
      expect(screen.queryByRole("list", { name: "Matching skills" })).not.toBeInTheDocument();
      expect(screen.queryByText("Scored on Premium")).not.toBeInTheDocument();

      const toggle = screen.getByRole("button", { name: "Show full breakdown" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("list", { name: "Missing (required)" }).querySelectorAll("li")
      ).toHaveLength(5);
      expect(screen.getByRole("list", { name: "Matching skills" })).toBeInTheDocument();
      expect(screen.getByText("Scored on Premium")).toBeInTheDocument();
    });

    it("offers no toggle when there is nothing more to show", () => {
      render(<FitScore fit={{ score: 60, rationale: "r", missing: ["a"] }} />);
      expect(
        screen.queryByRole("button", { name: "Show full breakdown" })
      ).not.toBeInTheDocument();
    });
  });
});
