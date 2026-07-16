import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi } from "./helpers/mswStorageServer";
import { JobPanel } from "../../components/JobPanel/JobPanel";
import { MessageType } from "../../types/messages";
import type { ExtensionMessage } from "../../types/messages";
import type { JobAnalysis } from "../../types/job";

// jobStorage is server-backed since 002; run it against the contract-faithful
// fake API instead of chrome.storage.
installFakeStorageApi();

const analysis: JobAnalysis = {
  isJobPosting: true,
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Austin, TX",
  arrangement: "remote",
  arrangementConfidence: "explicit",
  arrangementEvidence: "Fully remote within the United States",
  daysInOffice: null,
  daysRemote: null,
  remoteRestrictions: null,
  salary: null,
  seniority: "senior",
  techStack: [],
  fit: null,
  model: "gpt-4o-mini",
  analyzedAt: "2026-07-04T12:00:04Z",
};

function dispatch(message: ExtensionMessage): void {
  const listeners = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  act(() => {
    for (const [listener] of listeners) {
      (listener as (m: ExtensionMessage) => void)(message);
    }
  });
}

describe("JobPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryStorage("local");
  });

  it("auto-triggers analysis for the given tab and shows progress", () => {
    render(<JobPanel tabId={7} />);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MessageType.ANALYZE_JOB_PAGE,
      tabId: 7,
      assumeJobPosting: false,
      bypassCache: false,
      cachedOnly: false,
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does not auto-trigger without a tab and offers manual analyze", () => {
    render(<JobPanel tabId={null} />);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Analyze this page" })
    ).toBeInTheDocument();
  });

  it("renders the analysis when the result message arrives", () => {
    render(<JobPanel tabId={7} />);
    dispatch({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis,
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1",
      multiplePostings: false,
      cached: false,
      saved: null,
    });
    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
  });

  it("renders the error state when analysis fails", () => {
    render(<JobPanel tabId={7} />);
    dispatch({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: {
        code: "service-error",
        message: "The analysis service encountered an error.",
        action: "Try again.",
        retryable: true,
      },
      fallback: null,
      canonicalUrl: null,
      sourceUrl: null,
    });
    expect(
      screen.getByText("The analysis service encountered an error.")
    ).toBeInTheDocument();
  });

  it("cancel returns to idle and ignores a late result", async () => {
    render(<JobPanel tabId={7} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Analyze this page" })
    ).toBeInTheDocument();

    dispatch({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis,
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1",
      multiplePostings: false,
      cached: false,
      saved: null,
    });
    expect(screen.queryByText("Senior Backend Engineer")).not.toBeInTheDocument();
  });

  it("Analyze anyway bypasses the cache so the stored verdict cannot replay", async () => {
    render(<JobPanel tabId={7} />);
    dispatch({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis: { ...analysis, isJobPosting: false },
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1",
      multiplePostings: false,
      cached: false,
      saved: null,
    });

    await userEvent.click(screen.getByRole("button", { name: "Analyze anyway" }));
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
      type: MessageType.ANALYZE_JOB_PAGE,
      tabId: 7,
      assumeJobPosting: true,
      bypassCache: true,
      cachedOnly: false,
    });
  });

  it("resets to idle on navigation and ignores results from the previous page", () => {
    const { rerender } = render(<JobPanel tabId={7} navigationId={0} />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Background announces a navigation: the activeTab grant is gone and the
    // in-flight analysis belongs to the previous page.
    rerender(<JobPanel tabId={7} navigationId={1} />);
    expect(
      screen.getByRole("button", { name: "Analyze this page" })
    ).toBeInTheDocument();

    dispatch({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis,
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1",
      multiplePostings: false,
      cached: false,
      saved: null,
    });
    expect(screen.queryByText("Senior Backend Engineer")).not.toBeInTheDocument();
  });

  it("does not auto-analyze a tab that arrives after mount (no activeTab grant)", () => {
    const { rerender } = render(<JobPanel tabId={null} navigationId={0} />);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    // User switches to a content tab while the panel is already open.
    rerender(<JobPanel tabId={4} navigationId={1} />);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    // Manual analyze targets the new tab.
    return userEvent
      .click(screen.getByRole("button", { name: "Analyze this page" }))
      .then(() => {
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
          type: MessageType.ANALYZE_JOB_PAGE,
          tabId: 4,
          assumeJobPosting: false,
          bypassCache: false,
          cachedOnly: false,
        });
      });
  });

  it("re-analyzes when the toolbar click bumps analyzeNonce, once per bump", () => {
    const { rerender } = render(
      <JobPanel tabId={7} navigationId={0} analyzeNonce={0} />
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

    // Analysis still in flight: the same click that opened the panel must
    // not double-trigger.
    rerender(<JobPanel tabId={7} navigationId={0} analyzeNonce={1} />);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

    dispatch({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis,
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1",
      multiplePostings: false,
      cached: false,
      saved: null,
    });

    // A later click re-analyzes under its fresh grant.
    rerender(<JobPanel tabId={7} navigationId={0} analyzeNonce={2} />);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has This Page and Saved tabs", async () => {
    render(<JobPanel tabId={null} />);
    expect(screen.getByRole("tab", { name: "This Page" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Saved" }));
    expect(await screen.findByText(/No saved postings yet/)).toBeInTheDocument();
  });

  it("usage-limit-reached renders the exhausted card, and saved jobs stay fully accessible from the Saved tab (FR-010)", async () => {
    render(<JobPanel tabId={7} />);
    dispatch({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis,
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1",
      multiplePostings: false,
      cached: false,
      saved: null,
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Already saved · status: interested/);

    dispatch({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: {
        code: "usage-limit-reached",
        message: "You've used all 50 free analyses this month.",
        action: "Upgrade for more analyses, or wait for your allowance to reset.",
        retryable: false,
        usage: { count: 50, limit: 50, resetsAt: "2026-08-01T00:00:00Z", tier: "free" },
      },
      fallback: null,
      canonicalUrl: null,
      sourceUrl: null,
    });
    expect(
      await screen.findByText(/you.ve used all 50 free analyses this month/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Saved jobs remain fully accessible — untouched by the 429.
    await userEvent.click(screen.getByRole("tab", { name: "Saved" }));
    expect(await screen.findByText("Senior Backend Engineer")).toBeInTheDocument();
  });

  it("saves the analyzed posting with default status interested", async () => {
    render(<JobPanel tabId={7} />);
    dispatch({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis,
      canonicalUrl: "https://example.com/jobs/1",
      sourceUrl: "https://example.com/jobs/1?utm_source=x",
      multiplePostings: false,
      cached: false,
      saved: null,
    });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Already saved · status: interested/)).toBeInTheDocument();

    const { jobStorage } = await import("../../services/jobStorage");
    const stored = await jobStorage.get("https://example.com/jobs/1");
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("interested");
    expect(stored!.sourceUrl).toBe("https://example.com/jobs/1?utm_source=x");
  });
});
