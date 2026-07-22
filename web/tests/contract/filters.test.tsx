import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import type { SavedJobPayload } from "@/api/types";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

function job(title: string, arrangement: SavedJobPayload["analysis"]["arrangement"]): SavedJobPayload {
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
      arrangement,
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

describe("library filters (FR-013, US2 scenario 5)", () => {
  const api = installFakeApi();

  it("applied filters are visible and removable; a no-match combo shows an empty-state message", async () => {
    seedSession();
    api.setJobs([job("Remote Engineer", "remote"), job("Onsite Engineer", "onsite")]);

    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByRole("link", { name: /remote engineer/i });

    const arrangementSelect = screen.getByLabelText(/arrangement/i);
    await userEvent.selectOptions(arrangementSelect, "onsite");

    // Applied filter is visible as a removable chip.
    const chip = await screen.findByRole("button", { name: /arrangement: onsite/i });
    expect(chip).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /remote engineer/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /onsite engineer/i })).toBeInTheDocument();

    // Remove the filter via its chip.
    await userEvent.click(chip);
    expect(screen.queryByRole("button", { name: /arrangement: onsite/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /remote engineer/i })).toBeInTheDocument();

    // A combo with no matches shows an empty-state message, not a blank screen.
    await userEvent.type(screen.getByRole("searchbox", { name: /search/i }), "nonexistent-xyz");
    await screen.findByText(/no postings match/i);
  });
});
