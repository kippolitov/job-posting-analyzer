import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import type { DocumentAnalysisResult } from "@/api/types";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

const RESULT: DocumentAnalysisResult = {
  analysis: {
    isJobPosting: true,
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    location: null,
    arrangement: "hybrid",
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
    analyzedAt: "2026-07-21T00:00:00.000Z",
  },
  source: "document",
  filename: "job-description.pdf",
  canonicalUrl: `doc:${"a".repeat(64)}`,
  saveKey: "b".repeat(64),
  usage: { count: 1, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z", tier: "free" },
};

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array(100)], name, { type });
}

describe("save a document-sourced analysis (US5 scenarios 2–3)", () => {
  const api = installFakeApi();

  it("409 at-cap on save renders the plain-language refusal message", async () => {
    seedSession();
    api.setDocumentResult(RESULT);
    api.failNext("jobs-item", {
      status: 409,
      code: "LIBRARY_FULL",
      message: "Library is at the 1,000-posting cap. Prune archived postings or export your library to free up space.",
    });

    window.history.pushState({}, "", "/upload");
    render(<App />);

    const input = await screen.findByLabelText(/upload a document/i);
    await userEvent.upload(input, makeFile("job-description.pdf", "application/pdf"));

    const saveButton = await screen.findByRole("button", { name: /save to library/i });
    await userEvent.click(saveButton);

    await screen.findByText(/at the 1,000-posting cap/i);
  });

  it("a saved document posting offers no original-file download affordance (SC-009)", async () => {
    seedSession();
    api.setDocumentResult(RESULT);

    window.history.pushState({}, "", "/upload");
    render(<App />);

    const input = await screen.findByLabelText(/upload a document/i);
    await userEvent.upload(input, makeFile("job-description.pdf", "application/pdf"));

    const saveButton = await screen.findByRole("button", { name: /save to library/i });
    await userEvent.click(saveButton);

    await screen.findByRole("status");
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();

    window.history.pushState({}, "", "/library");
    render(<App />);
    await screen.findByText("job-description.pdf");
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });
});
