import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import type { SavedJobPayload } from "@/api/types";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

function job(title: string): SavedJobPayload {
  return {
    schemaVersion: 1,
    canonicalUrl: `https://example.com/${title}`,
    sourceUrl: "https://example.com",
    source: "url",
    filename: "",
    status: "interested",
    notes: "",
    savedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    analysis: {
      isJobPosting: true,
      title,
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
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("compare view (FR-009, US2 scenario 4)", () => {
  const api = installFakeApi();

  it("shows a pick-from-library prompt with nothing selected", async () => {
    seedSession();
    api.setJobs([job("Posting A"), job("Posting B")]);

    window.history.pushState({}, "", "/compare");
    render(<App />);

    await screen.findByText(/pick postings to compare/i);
  });

  it("selecting postings in the library and visiting compare renders them side by side", async () => {
    seedSession();
    api.setJobs([job("Posting A"), job("Posting B")]);

    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByRole("link", { name: /posting a/i });
    await userEvent.click(screen.getByLabelText(/select posting a for comparison/i));
    await userEvent.click(screen.getByLabelText(/select posting b for comparison/i));

    await userEvent.click(screen.getByRole("navigation").querySelector('a[href="/compare"]')!);

    await screen.findByRole("heading", { name: /posting a/i });
    expect(screen.getByRole("heading", { name: /posting b/i })).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button", { name: /remove from comparison/i });
    expect(removeButtons).toHaveLength(2);
    await userEvent.click(removeButtons[0]);
    expect(screen.queryByRole("heading", { name: /posting a/i })).not.toBeInTheDocument();
  });
});
