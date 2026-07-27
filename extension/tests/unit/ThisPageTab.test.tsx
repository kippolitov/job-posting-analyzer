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

function renderTab(
  view: JobView,
  handlers?: Partial<
    Record<"onAnalyze" | "onCancel" | "onForceAnalyze" | "onOpenPaste", () => void>
  >
) {
  return render(
    <ThisPageTab
      tabId={1}
      view={view}
      onAnalyze={handlers?.onAnalyze ?? noop}
      onCancel={handlers?.onCancel ?? noop}
      onForceAnalyze={handlers?.onForceAnalyze ?? noop}
      onOpenPaste={handlers?.onOpenPaste}
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

  it("thin-content and no-access errors offer a paste shortcut (FR-017e)", async () => {
    const onOpenPaste = vi.fn();
    renderTab(
      {
        ...baseView,
        status: "error",
        analysis: null,
        error: {
          code: "thin-content",
          message: "Not enough page content to analyze.",
          action: "Open the full job posting page, then re-analyze.",
          retryable: true,
        },
      },
      { onOpenPaste }
    );
    await userEvent.click(screen.getByRole("button", { name: "Paste text instead" }));
    expect(onOpenPaste).toHaveBeenCalled();
  });

  it("a no-access error (no Retry) still offers the paste shortcut — it is the sole remedy (FR-017e, FR-036a)", () => {
    const onOpenPaste = vi.fn();
    renderTab(
      {
        ...baseView,
        status: "error",
        analysis: null,
        error: {
          code: "no-access",
          message: "The extension doesn't have permission to read this page.",
          action: "Click the extension icon to grant access.",
          retryable: false,
        },
      },
      { onOpenPaste }
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste text instead" })).toBeInTheDocument();
  });

  it("offers 'Analyze a region' as a secondary action alongside Retry and paste (FR-007b, T090)", () => {
    renderTab({
      ...baseView,
      status: "error",
      analysis: null,
      error: {
        code: "thin-content",
        message: "Not enough page content to analyze.",
        action: "Open the full job posting page, then re-analyze.",
        retryable: true,
      },
    });
    const region = screen.getByRole("button", { name: "Analyze a region" });
    expect(region).toBeEnabled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("disables both scoping affordances with a stated, cause-specific reason on a no-access page, pointing at paste (FR-036a, T064, T104)", () => {
    renderTab({
      ...baseView,
      status: "error",
      analysis: null,
      error: {
        code: "no-access",
        message: "The extension doesn't have permission to read this page.",
        action: "Click the extension icon to grant access.",
        retryable: false,
      },
    });
    const region = screen.getByRole("button", { name: "Analyze a region" });
    expect(region).toBeDisabled();
    expect(region).toHaveAttribute("aria-describedby", "region-disabled-reason");
    const reason = document.getElementById("region-disabled-reason");
    expect(reason).toHaveTextContent(/can't read this page/i);
    expect(reason).toHaveTextContent(/paste/i);
  });

  it("opens the region list when 'Analyze a region' is clicked from an error state", async () => {
    const user = userEvent.setup();
    renderTab({
      ...baseView,
      status: "error",
      analysis: null,
      error: {
        code: "thin-content",
        message: "Not enough page content to analyze.",
        action: "Open the full job posting page, then re-analyze.",
        retryable: true,
      },
    });
    await user.click(screen.getByRole("button", { name: "Analyze a region" }));
    expect(await screen.findByRole("region", { name: "Regions on this page" })).toBeInTheDocument();
  });

  it("also offers 'Analyze a region' from a successful-but-wrong ready state (FR-023)", () => {
    renderTab(baseView);
    expect(
      screen.getByRole("button", { name: /Wrong region\? Analyze a region/ })
    ).toBeEnabled();
  });

  it("shows the learned-region badge when strategy is learned-selector (FR-032)", () => {
    renderTab({
      ...baseView,
      strategy: "learned-selector",
      canonicalUrl: "https://jobs.example.com/posting/1",
    });
    expect(
      screen.getByText("Always analyzing this region on jobs.example.com")
    ).toBeInTheDocument();
  });

  it("does not show the learned-region badge for an ordinary automatic result", () => {
    renderTab({ ...baseView, strategy: "semantic" });
    expect(screen.queryByText(/Always analyzing this region/)).not.toBeInTheDocument();
  });

  it("offers to always analyze the region after a scoped (picked/selection) result, and accepting shows a confirmation naming the site (FR-026b)", async () => {
    renderTab({
      ...baseView,
      strategy: "selection",
      scopedRegion: { selector: ".job-body", host: "jobs.example.com" },
    });
    expect(
      screen.getByText("Always analyze this region on jobs.example.com?")
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Always" }));
    expect(
      screen.getByText("Will always analyze this region on jobs.example.com.")
    ).toBeInTheDocument();
  });

  it("declining the always-analyze offer dismisses it with no confirmation shown", async () => {
    renderTab({
      ...baseView,
      strategy: "picked",
      scopedRegion: { selector: ".job-body", host: "jobs.example.com" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(
      screen.queryByText(/Always analyze this region/)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Will always analyze this region/)
    ).not.toBeInTheDocument();
  });

  it("does not offer to always analyze without a scopedRegion, even if strategy is scoped", () => {
    renderTab({ ...baseView, strategy: "picked", scopedRegion: undefined });
    expect(screen.queryByText(/Always analyze this region/)).not.toBeInTheDocument();
  });

  it("does not offer the paste shortcut for other error codes", () => {
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
      { onOpenPaste: vi.fn() }
    );
    expect(
      screen.queryByRole("button", { name: "Paste text instead" })
    ).not.toBeInTheDocument();
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
        tabId={1}
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

  it("usage-limit-reached errors render the designed UsageExhausted card, never the generic error banner (FR-009/SC-003)", async () => {
    const onUpgrade = vi.fn();
    render(
      <ThisPageTab
        tabId={1}
        view={{
          ...baseView,
          status: "error",
          analysis: null,
          error: {
            code: "usage-limit-reached",
            message: "You've used all 50 free analyses this month.",
            action: "Upgrade for more analyses, or wait for your allowance to reset.",
            retryable: false,
            usage: {
              count: 50,
              limit: 50,
              resetsAt: "2026-08-01T00:00:00Z",
              tier: "free",
            },
          },
        }}
        onAnalyze={noop}
        onCancel={noop}
        onForceAnalyze={noop}
        onUpgrade={onUpgrade}
      />
    );
    expect(
      screen.getByText(/you.ve used all 50 free analyses this month/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/august 1/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /upgrade to premium/i }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
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
