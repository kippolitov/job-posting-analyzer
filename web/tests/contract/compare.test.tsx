import { beforeEach, describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { clearCompareSelection } from "@/lib/compareStore";
import type { SavedJobPayload } from "@/api/types";
import { installFakeApi } from "./helpers/mswServer";
import { seedSession } from "./helpers/session";

const CURRENT = "c".repeat(64);

function job(title: string, fit: SavedJobPayload["analysis"]["fit"] = null): SavedJobPayload {
  return {
    schemaVersion: 1,
    canonicalUrl: `https://example.com/${title}`,
    sourceUrl: `https://example.com/${title}`,
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
      salary: { min: 100000, max: 120000, currency: "USD", period: "year" },
      seniority: "senior",
      techStack: [],
      fit,
      model: "gpt-4o-mini",
      analyzedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

const profile = {
  text: "Engineer",
  dealbreakers: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
  fingerprint: CURRENT,
};

async function openLibrary(api: ReturnType<typeof installFakeApi>, jobs: SavedJobPayload[]) {
  seedSession();
  api.setProfile(profile);
  api.setJobs(jobs);
  window.history.pushState({}, "", "/library");
  render(<App />);
  await screen.findByRole("link", { name: jobs[0].analysis.title! });
}

const select = (title: string) =>
  userEvent.click(screen.getByLabelText(`Select ${title} for comparison`));

describe("compare dialog (006 FR-031, SC-001)", () => {
  const api = installFakeApi();
  beforeEach(clearCompareSelection);

  it("Compare is disabled below two selected and opens a dialog for two to four", async () => {
    await openLibrary(api, [job("Posting A"), job("Posting B")]);

    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    await select("Posting A");
    expect(compare).toBeDisabled();
    await select("Posting B");
    expect(compare).toBeEnabled();

    await userEvent.click(compare);
    expect(await screen.findByRole("dialog", { name: "Compare postings" })).toBeInTheDocument();
  });

  it("Escape and Close each close the dialog, return focus to Compare and keep the selection", async () => {
    await openLibrary(api, [job("Posting A"), job("Posting B")]);
    await select("Posting A");
    await select("Posting B");
    const compare = screen.getByRole("button", { name: "Compare" });

    await userEvent.click(compare);
    await screen.findByRole("dialog", { name: "Compare postings" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Compare postings" })).not.toBeInTheDocument();
    expect(compare).toHaveFocus();

    await userEvent.click(compare);
    const dialog = await screen.findByRole("dialog", { name: "Compare postings" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Compare postings" })).not.toBeInTheDocument();
    expect(compare).toHaveFocus();

    expect(screen.getByLabelText("Select Posting A for comparison")).toBeChecked();
    expect(screen.getByLabelText("Select Posting B for comparison")).toBeChecked();
  });

  it("the nav has no Compare entry and /compare lands on the Library", async () => {
    seedSession();
    api.setJobs([job("Posting A")]);
    window.history.pushState({}, "", "/compare");
    render(<App />);

    await screen.findByRole("link", { name: "Posting A" });
    expect(window.location.pathname).toBe("/library");
    expect(
      within(screen.getByRole("navigation", { name: "Primary" })).queryByRole("link", {
        name: "Compare",
      })
    ).not.toBeInTheDocument();
  });

  it("columns show score, verdict, salary, arrangement and the freshness marker; rows merge requirements", async () => {
    const current = job("Posting A", {
      score: 90,
      rationale: "r",
      profileFingerprint: CURRENT,
      matching: ["Kubernetes"],
      missing: ["Go"],
    });
    const stale = job("Posting B", {
      score: 60,
      rationale: "r",
      profileFingerprint: "o".repeat(64),
      matching: ["Go"],
      desired: ["kubernetes "],
    });
    const unknown = job("Posting C", { score: 50, rationale: "r" });
    await openLibrary(api, [current, stale, unknown]);
    await select("Posting A");
    await select("Posting B");
    await select("Posting C");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const dialog = await screen.findByRole("dialog", { name: "Compare postings" });

    const table = within(dialog).getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers).toHaveLength(4);
    expect(within(headers[1]).getByLabelText("Strong match, fit 90 out of 100")).toBeInTheDocument();
    expect(within(headers[1]).getByText("USD 100,000 – 120,000/year")).toBeInTheDocument();
    expect(within(headers[1]).getByText("Remote")).toBeInTheDocument();
    expect(within(headers[1]).queryByText(/older profile|out of date/i)).not.toBeInTheDocument();
    expect(within(headers[2]).getByText(/Scored against an older profile/)).toBeInTheDocument();
    expect(within(headers[3]).getByText(/May be out of date/)).toBeInTheDocument();

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("Go");
    expect(cells(rows[0])).toEqual(["✗ Missing", "✓ Matched", "—"]);
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("Kubernetes");
    expect(cells(rows[1])).toEqual(["✓ Matched", "Nice to have", "—"]);
  });

  it("each column links to the full analysis and following it closes the dialog", async () => {
    await openLibrary(api, [job("Posting A"), job("Posting B")]);
    await select("Posting A");
    await select("Posting B");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const dialog = await screen.findByRole("dialog", { name: "Compare postings" });

    await userEvent.click(within(dialog).getByRole("link", { name: "Posting B" }));
    expect(screen.queryByRole("dialog", { name: "Compare postings" })).not.toBeInTheDocument();
    await screen.findByRole("heading", { name: "Posting B" });
    expect(window.location.pathname).toBe(`/library/${encodeURIComponent("https://example.com/Posting B")}`);
  });

  it("the table scrolls inside its own container rather than the page", async () => {
    await openLibrary(api, [job("Posting A"), job("Posting B")]);
    await select("Posting A");
    await select("Posting B");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const dialog = await screen.findByRole("dialog", { name: "Compare postings" });

    const container = within(dialog).getByRole("table").parentElement!;
    expect(container).toHaveStyle({ overflowX: "auto" });
    // jsdom has no layout, so the full-viewport fill is asserted by its classes.
    expect(dialog.className).toMatch(/\bw-full\b/);
    expect(dialog.className).toMatch(/\bh-full\b/);
  });
});
