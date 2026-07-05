import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThisPageTab } from "../../components/JobPanel/ThisPageTab";
import type { JobView } from "../../components/JobPanel/ThisPageTab";
import type { JobAnalysis } from "../../types/job";

const analysis: JobAnalysis = {
  isJobPosting: true,
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Austin, TX",
  arrangement: "hybrid",
  arrangementConfidence: "explicit",
  arrangementEvidence: "hybrid, 3 days per week in our Austin office",
  daysInOffice: 3,
  daysRemote: 2,
  remoteRestrictions: "US only",
  salary: { min: 180000, max: 220000, currency: "USD", period: "year" },
  seniority: "senior",
  techStack: ["C#", "Azure"],
  fit: null,
  model: "gpt-4o-mini",
  analyzedAt: "2026-07-04T12:00:04Z",
};

const baseView: JobView = {
  status: "ready",
  analysis,
  error: null,
  fallback: null,
  canonicalUrl: "https://example.com/jobs/1",
  sourceUrl: "https://example.com/jobs/1",
  multiplePostings: false,
  cached: false,
  saved: null,
};

const noop = () => {};

function renderTab(view: JobView, handlers?: Partial<Record<"onAnalyze" | "onCancel" | "onForceAnalyze", () => void>>) {
  return render(
    <ThisPageTab
      view={view}
      onAnalyze={handlers?.onAnalyze ?? noop}
      onCancel={handlers?.onCancel ?? noop}
      onForceAnalyze={handlers?.onForceAnalyze ?? noop}
    />
  );
}

describe("ThisPageTab", () => {
  it("idle state offers an Analyze action", async () => {
    const onAnalyze = vi.fn();
    renderTab({ ...baseView, status: "idle", analysis: null }, { onAnalyze });
    await userEvent.click(screen.getByRole("button", { name: "Analyze this page" }));
    expect(onAnalyze).toHaveBeenCalled();
  });

  it("analyzing state shows a progress indicator with a cancel affordance", async () => {
    const onCancel = vi.fn();
    renderTab({ ...baseView, status: "analyzing", analysis: null }, { onCancel });
    expect(screen.getByRole("status")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders all extracted fields with evidence and confidence", () => {
    renderTab(baseView);
    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Acme — Austin, TX")).toBeInTheDocument();
    expect(screen.getByText("Hybrid · 3 days office / 2 remote")).toBeInTheDocument();
    expect(screen.getByText("stated in posting")).toBeInTheDocument();
    expect(
      screen.getByText(/hybrid, 3 days per week in our Austin office/)
    ).toBeInTheDocument();
    expect(screen.getByText(/US only/)).toBeInTheDocument();
    expect(screen.getByText("USD 180,000–220,000 / year")).toBeInTheDocument();
    expect(screen.getByText("Senior")).toBeInTheDocument();
    expect(screen.getByText("C#")).toBeInTheDocument();
  });

  it("labels inferred classifications", () => {
    renderTab({
      ...baseView,
      analysis: { ...analysis, arrangementConfidence: "inferred" },
    });
    expect(screen.getByText("inferred")).toBeInTheDocument();
  });

  it("shows the multi-posting notice when several postings were found", () => {
    renderTab({ ...baseView, multiplePostings: true });
    expect(screen.getByText(/the first one was analyzed/i)).toBeInTheDocument();
  });

  it("non-job pages offer Analyze anyway", async () => {
    const onForceAnalyze = vi.fn();
    renderTab(
      { ...baseView, analysis: { ...analysis, isJobPosting: false } },
      { onForceAnalyze }
    );
    expect(
      screen.getByText("This doesn't look like a job posting")
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Analyze anyway" }));
    expect(onForceAnalyze).toHaveBeenCalled();
  });

  it("errors show plain-language message, action, and Retry when retryable", async () => {
    const onAnalyze = vi.fn();
    renderTab(
      {
        ...baseView,
        status: "error",
        analysis: null,
        error: {
          code: "service-error",
          message: "The analysis service encountered an error.",
          action: "Try again.",
          retryable: true,
        },
      },
      { onAnalyze }
    );
    expect(
      screen.getByText("The analysis service encountered an error.")
    ).toBeInTheDocument();
    expect(screen.getByText("Try again.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onAnalyze).toHaveBeenCalled();
  });

  it("renders JSON-LD fallback fields alongside a backend error", () => {
    renderTab({
      ...baseView,
      status: "error",
      analysis: null,
      error: {
        code: "network-error",
        message: "Could not reach the analysis service.",
        action: "Check your internet connection and try again.",
        retryable: true,
      },
      fallback: { title: "Senior Backend Engineer", company: "Acme" },
    });
    expect(screen.getByText(/From page data/i)).toBeInTheDocument();
    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument();
  });

  it("shows the Already saved state with status and notes plus Re-analyze", async () => {
    const onReanalyze = vi.fn();
    render(
      <ThisPageTab
        view={{
          ...baseView,
          cached: true,
          saved: {
            schemaVersion: 1,
            canonicalUrl: baseView.canonicalUrl!,
            sourceUrl: baseView.sourceUrl!,
            analysis,
            status: "applied",
            notes: "recruiter: Dana",
            savedAt: "2026-07-01T00:00:00Z",
            updatedAt: "2026-07-01T00:00:00Z",
          },
        }}
        onAnalyze={noop}
        onCancel={noop}
        onForceAnalyze={noop}
        onReanalyze={onReanalyze}
        onSave={noop}
      />
    );
    expect(screen.getByText(/Already saved · status: applied/)).toBeInTheDocument();
    expect(screen.getByText("recruiter: Dana")).toBeInTheDocument();
    // No duplicate Save button once saved.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(onReanalyze).toHaveBeenCalled();
  });

  it("omits Retry for non-retryable errors", () => {
    renderTab({
      ...baseView,
      status: "error",
      analysis: null,
      error: {
        code: "thin-content",
        message: "Not enough page content to analyze.",
        action: "Open the full job posting page, then re-analyze.",
        retryable: false,
      },
    });
    expect(screen.getByText("Not enough page content to analyze.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
