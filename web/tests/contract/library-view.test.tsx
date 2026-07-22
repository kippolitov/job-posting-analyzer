import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import type { SavedJobPayload } from "@/api/types";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

const fullJob: SavedJobPayload = {
  schemaVersion: 1,
  canonicalUrl: "https://example.com/jobs/123",
  sourceUrl: "https://example.com/jobs/123",
  source: "url",
  filename: "",
  status: "interested",
  notes: "Referred by a former colleague.",
  savedAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  analysis: {
    isJobPosting: true,
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    location: "Remote (US)",
    arrangement: "hybrid",
    arrangementConfidence: "explicit",
    arrangementEvidence: "3 days per week in our downtown office",
    daysInOffice: 3,
    daysRemote: 2,
    remoteRestrictions: "US only",
    salary: { min: 150000, max: 190000, currency: "USD", period: "year" },
    seniority: "senior",
    techStack: ["Go", "Postgres", "Kafka"],
    fit: {
      score: 82,
      rationale: "Strong backend alignment with a minor gap in Kafka depth.",
      matching: ["Distributed systems", "Postgres schema design"],
      missing: ["Kafka at scale"],
      desired: ["Terraform"],
      strengths: ["Seniority matches", "Domain overlap"],
      weaknesses: ["Limited streaming experience"],
    },
    model: "gpt-4o-mini",
    analyzedAt: "2026-07-01T00:00:00.000Z",
  },
};

describe("library view (FR-007/FR-008, US1 scenario 2)", () => {
  const api = installFakeApi();

  it("GET /api/jobs renders postings, and the detail view shows every stored field", async () => {
    seedSession();
    api.setJobs([fullJob]);

    window.history.pushState({}, "", "/library");
    render(<App />);

    const link = await screen.findByRole("link", { name: /senior backend engineer/i });
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();

    await userEvent.click(link);

    // Core fields
    await screen.findByRole("heading", { name: /senior backend engineer/i });
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Remote (US)")).toBeInTheDocument();
    expect(screen.getByText("hybrid")).toBeInTheDocument();
    expect(screen.getByText("explicit")).toBeInTheDocument();
    expect(screen.getByText(/3 days per week in our downtown office/i)).toBeInTheDocument();
    expect(screen.getByText("senior")).toBeInTheDocument();
    expect(screen.getByText(/US only/i)).toBeInTheDocument();
    expect(screen.getByText(/150,000/)).toBeInTheDocument();
    expect(screen.getByText(/190,000/)).toBeInTheDocument();

    // Tech stack
    expect(screen.getByText("Go")).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    expect(screen.getByText("Kafka")).toBeInTheDocument();

    // Fit breakdown
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText(/Strong backend alignment/i)).toBeInTheDocument();
    expect(screen.getByText("Distributed systems")).toBeInTheDocument();
    expect(screen.getByText("Postgres schema design")).toBeInTheDocument();
    expect(screen.getByText("Kafka at scale")).toBeInTheDocument();
    expect(screen.getByText("Terraform")).toBeInTheDocument();
    expect(screen.getByText("Seniority matches")).toBeInTheDocument();
    expect(screen.getByText("Limited streaming experience")).toBeInTheDocument();

    // Notes
    expect(screen.getByText(/Referred by a former colleague/i)).toBeInTheDocument();
  });

  it("renders the document filename instead of a URL for a document-sourced posting", async () => {
    seedSession();
    api.setJobs([
      {
        ...fullJob,
        source: "document",
        filename: "job-description.pdf",
        canonicalUrl: `doc:${"a".repeat(64)}`,
        sourceUrl: "",
      },
    ]);

    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByText("job-description.pdf");
    expect(screen.queryByText(fullJob.sourceUrl)).not.toBeInTheDocument();
  });
});
