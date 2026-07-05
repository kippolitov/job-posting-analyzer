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
