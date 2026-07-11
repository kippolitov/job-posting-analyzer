import { describe, it, expect } from "vitest";
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
    expect(screen.getByLabelText("Fit score: 84 out of 100")).toBeInTheDocument();
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

  it("renders the full breakdown: matching, missing, desired, strengths, weaknesses", () => {
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

  it("renders dealbreaker-capped scores distinctly", () => {
    render(
      <FitScore
        fit={{ score: 15, rationale: "Violates your no-on-site dealbreaker." }}
      />
    );
    const badge = screen.getByLabelText("Fit score: 15 out of 100");
    expect(badge.className).toContain("red");
  });
});
