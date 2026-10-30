import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobAnalysisResponse } from "shared/types/job";
import { AnalysisView } from "@/components/AnalysisView";

function analysis(fit: JobAnalysisResponse["fit"]): JobAnalysisResponse {
  return {
    isJobPosting: true,
    title: "Platform Engineer",
    company: "Acme",
    location: null,
    arrangement: "remote",
    arrangementConfidence: "explicit",
    arrangementEvidence: null,
    daysInOffice: null,
    daysRemote: null,
    remoteRestrictions: null,
    salary: null,
    seniority: "senior",
    techStack: [],
    fit,
    model: "m",
    analyzedAt: "2026-07-01T00:00:00.000Z",
  };
}

const evidenceFit: JobAnalysisResponse["fit"] = {
  score: 72,
  rationale: "Solid overlap.",
  matching: ["C# / .NET services", "Terraform basics"],
  missing: ["Kubernetes operations"],
  desired: ["Go"],
  evidence: {
    matching: [
      {
        label: "C# / .NET services",
        postingQuote: "build backend services in C# and .NET 8",
        profileQuote: "Ten years of C# on Azure",
      },
      { label: "Terraform basics", postingQuote: null, profileQuote: null },
    ],
    missing: [
      { label: "Kubernetes operations", postingQuote: "run Kubernetes in production", profileQuote: null },
    ],
    desired: [{ label: "Go", postingQuote: null, profileQuote: null }],
  },
};

describe("evidence disclosure on the web (006 FR-011/FR-013)", () => {
  it("shows a collapsed disclosure button on an item with evidence", () => {
    render(<AnalysisView analysis={analysis(evidenceFit)} />);
    expect(screen.getByRole("button", { name: "C# / .NET services" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("adds no evidence region to the DOM until an item is expanded", () => {
    render(<AnalysisView analysis={analysis(evidenceFit)} />);
    expect(screen.queryByText("build backend services in C# and .NET 8")).not.toBeInTheDocument();
    expect(screen.queryByText("From the posting")).not.toBeInTheDocument();
  });

  it("reveals the posting and profile quotes on click for a matching item", async () => {
    render(<AnalysisView analysis={analysis(evidenceFit)} />);
    await userEvent.click(screen.getByRole("button", { name: "C# / .NET services" }));
    expect(screen.getByRole("button", { name: "C# / .NET services" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("build backend services in C# and .NET 8").tagName).toBe("BLOCKQUOTE");
    expect(screen.getByText("Ten years of C# on Azure").tagName).toBe("BLOCKQUOTE");
    expect(screen.getByText("From the posting")).toBeInTheDocument();
    expect(screen.getByText("From your profile")).toBeInTheDocument();
  });

  it.each([["{Enter}"], [" "]])("opens with the keyboard (%j)", async (key) => {
    render(<AnalysisView analysis={analysis(evidenceFit)} />);
    screen.getByRole("button", { name: "C# / .NET services" }).focus();
    await userEvent.keyboard(key);
    expect(screen.getByText("build backend services in C# and .NET 8")).toBeInTheDocument();
  });

  it("shows only the posting quote for a missing item", async () => {
    render(<AnalysisView analysis={analysis(evidenceFit)} />);
    await userEvent.click(screen.getByRole("button", { name: "Kubernetes operations" }));
    expect(screen.getByText("run Kubernetes in production")).toBeInTheDocument();
    expect(screen.queryByText("From your profile")).not.toBeInTheDocument();
  });

  it("gives an item whose quotes are both null no button and logs no console error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AnalysisView analysis={analysis(evidenceFit)} />);
    expect(screen.queryByRole("button", { name: "Terraform basics" })).not.toBeInTheDocument();
    expect(screen.getByText("Terraform basics")).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("renders a legacy fit with no disclosure buttons", () => {
    render(
      <AnalysisView
        analysis={analysis({ score: 72, rationale: "r", matching: ["Azure"], missing: ["Kubernetes"] })}
      />
    );
    expect(screen.queryByRole("button", { name: "Azure" })).not.toBeInTheDocument();
    expect(screen.getByText("Azure")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
  });
});
