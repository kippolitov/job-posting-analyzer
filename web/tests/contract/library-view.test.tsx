import { beforeEach, describe, it, expect } from "vitest";
import { clearCompareSelection } from "@/lib/compareStore";
import { render, screen, within } from "@testing-library/react";
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

  it("renders 'Pasted' instead of a URL for a paste-sourced posting (005 FR-020)", async () => {
    seedSession();
    api.setJobs([
      {
        ...fullJob,
        source: "paste",
        filename: "",
        canonicalUrl: `paste:${"b".repeat(64)}`,
        sourceUrl: "",
      },
    ]);

    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByText("Pasted");
    expect(screen.queryByText(fullJob.sourceUrl)).not.toBeInTheDocument();
  });
});

describe("library rows mark stale scores (006 FR-002)", () => {
  const api = installFakeApi();

  it("marks out-of-date and version-unknown rows and links each source kind to its rescore path", async () => {
    seedSession();
    api.setProfile({
      text: "Engineer",
      dealbreakers: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
      fingerprint: "c".repeat(64),
    });
    const withFit = (fingerprint?: string): SavedJobPayload["analysis"] => ({
      ...fullJob.analysis,
      fit: {
        score: 60,
        rationale: "r",
        ...(fingerprint ? { profileFingerprint: fingerprint } : {}),
      },
    });
    api.setJobs([
      { ...fullJob, canonicalUrl: "https://example.com/a", sourceUrl: "https://example.com/a", analysis: withFit("o".repeat(64)) },
      { ...fullJob, canonicalUrl: "https://example.com/b", sourceUrl: "https://example.com/b", analysis: withFit() },
      { ...fullJob, canonicalUrl: "https://example.com/c", sourceUrl: "https://example.com/c", analysis: withFit("c".repeat(64)) },
    ]);

    window.history.pushState({}, "", "/library");
    render(<App />);

    expect(await screen.findByText(/Scored against an older profile/)).toBeInTheDocument();
    expect(screen.getByText(/May be out of date/)).toBeInTheDocument();
    expect(screen.getAllByText(/older profile|May be out of date/)).toHaveLength(2);
    const links = screen.getAllByRole("link", { name: "Open posting to rescore" });
    expect(links.map((l) => l.getAttribute("href")).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
});

describe("library rows show the shared verdict (006 US2)", () => {
  const api = installFakeApi();

  it("rows use the shared label and accessible name; legacy fits are Unrated", async () => {
    seedSession();
    const row = (url: string, score: number, fingerprint?: string): SavedJobPayload => ({
      ...fullJob,
      canonicalUrl: url,
      sourceUrl: url,
      analysis: {
        ...fullJob.analysis,
        title: `Role ${score}`,
        fit: {
          score,
          rationale: "r",
          ...(fingerprint ? { profileFingerprint: fingerprint } : {}),
        },
      },
    });
    api.setJobs([
      row("https://example.com/s", 90, "f".repeat(64)),
      row("https://example.com/l", 20, "f".repeat(64)),
      row("https://example.com/u", 72),
    ]);
    window.history.pushState({}, "", "/library");
    render(<App />);

    expect(await screen.findByLabelText("Strong match, fit 90 out of 100")).toHaveTextContent(
      "Strong match"
    );
    expect(screen.getByLabelText("Long shot, fit 20 out of 100")).toHaveTextContent("Long shot");
    expect(screen.getByLabelText("Unrated, fit 72 out of 100")).toHaveTextContent(
      "Unrated — rescore for a verdict"
    );
  });
});

describe("library timeline (006 FR-029, FR-030)", () => {
  const api = installFakeApi();
  beforeEach(clearCompareSelection);
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const entry = (title: string, daysAgo: number, score: number | null, status: "interested" | "applied" = "interested"): SavedJobPayload => ({
    ...fullJob,
    canonicalUrl: `https://example.com/${title}`,
    sourceUrl: `https://example.com/${title}`,
    status,
    savedAt: at(daysAgo),
    analysis: {
      ...fullJob.analysis,
      title,
      fit: score === null ? null : { score, rationale: "r", profileFingerprint: "f".repeat(64) },
    },
  });

  it("date sort puts entries under level-3 day headings with their key facts", async () => {
    seedSession();
    api.setJobs([entry("Today role", 0, 90), entry("Old role", 40, 20)]);
    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByRole("link", { name: "Today role" });
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0]).toHaveTextContent("Today");
    expect(headings).toHaveLength(2);

    const item = screen.getByRole("link", { name: "Today role" }).closest("li")!;
    expect(item).toHaveTextContent("Acme Corp");
    expect(within(item).getByLabelText("Strong match, fit 90 out of 100")).toBeInTheDocument();
    expect(item).toHaveTextContent("USD 150,000 – 190,000/year");
    expect(item).toHaveTextContent("Hybrid · 3 days in office");
    expect(item).toHaveTextContent("Remote (US)");
    expect(item).toHaveTextContent("senior");
    expect(item).toHaveTextContent("interested");
    expect(item).toHaveTextContent("example.com");
  });

  it("fit sort drops the headings and shows each save date", async () => {
    seedSession();
    api.setJobs([entry("Today role", 0, 90), entry("Old role", 40, 20)]);
    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByRole("link", { name: "Today role" });
    await userEvent.selectOptions(screen.getByLabelText("Sort"), "fit-asc");
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    const links = screen.getAllByRole("link", { name: /role$/ });
    expect(links.map((l) => l.textContent)).toEqual(["Old role", "Today role"]);
    expect(screen.getAllByText(/^Saved [A-Z][a-z]{2} \d/)).toHaveLength(2);
  });

  it("a filter that empties a day hides its heading", async () => {
    seedSession();
    api.setJobs([entry("Today role", 0, 90, "applied"), entry("Old role", 40, 20)]);
    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByRole("link", { name: "Today role" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "applied");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Today");
  });

  it("the verdict filter keeps only that verdict", async () => {
    seedSession();
    api.setJobs([entry("Today role", 0, 90), entry("Old role", 40, 20)]);
    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByRole("link", { name: "Today role" });
    await userEvent.selectOptions(screen.getByLabelText("Verdict"), "long-shot");
    expect(screen.queryByRole("link", { name: "Today role" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Old role" })).toBeInTheDocument();
  });

  it("selection uses the per-entry checkbox and Compare waits for two", async () => {
    seedSession();
    api.setJobs([entry("Today role", 0, 90), entry("Old role", 40, 20)]);
    window.history.pushState({}, "", "/library");
    render(<App />);

    await screen.findByRole("link", { name: "Today role" });
    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Select Today role for comparison"));
    expect(compare).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Select Old role for comparison"));
    expect(compare).toBeEnabled();
  });
});
