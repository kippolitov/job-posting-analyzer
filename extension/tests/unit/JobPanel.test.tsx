import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi } from "./helpers/mswStorageServer";
import { JobPanel } from "../../components/JobPanel/JobPanel";
import { MessageType } from "../../types/messages";
import type { ExtensionMessage } from "../../types/messages";
import type { JobAnalysis } from "../../types/job";
import { pickerService } from "../../services/pickerService";

vi.mock("../../services/pickerService", () => ({
  pickerService: {
    beginSession: vi.fn(async () => {}),
    listCandidates: vi.fn(async () => []),
    highlightCandidate: vi.fn(async () => {}),
    clearPickerHighlight: vi.fn(async () => {}),
    resolveCandidateText: vi.fn(),
    startPointerPick: vi.fn(),
    cancelPointerPick: vi.fn(async () => {}),
  },
}));

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

  describe("paste composer (spec FR-017)", () => {
    it("opens the composer, exposing aria-pressed, and disables the tabs (FR-017a, FR-017b)", async () => {
      render(<JobPanel tabId={null} />);
      const pasteButton = screen.getByRole("button", { name: "Paste text" });
      expect(pasteButton).toHaveAttribute("aria-pressed", "false");

      await userEvent.click(pasteButton);
      expect(pasteButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("region", { name: "Paste a job posting" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "This Page" })).toBeDisabled();
      expect(screen.getByRole("tab", { name: "Saved" })).toBeDisabled();
    });

    it("Escape closes the composer and returns focus to the header button (FR-017b)", async () => {
      render(<JobPanel tabId={null} />);
      const pasteButton = screen.getByRole("button", { name: "Paste text" });
      await userEvent.click(pasteButton);
      const textarea = screen.getByRole("textbox", { name: "Pasted job posting text" });
      textarea.focus();

      await userEvent.keyboard("{Escape}");
      expect(
        screen.queryByRole("region", { name: "Paste a job posting" })
      ).not.toBeInTheDocument();
      expect(pasteButton).toHaveFocus();
    });

    it("preserves the draft across closing and reopening the composer (FR-017c)", async () => {
      render(<JobPanel tabId={null} />);
      await userEvent.click(screen.getByRole("button", { name: "Paste text" }));
      const textarea = screen.getByRole("textbox", { name: "Pasted job posting text" });
      await userEvent.type(textarea, "A pasted posting");

      await userEvent.keyboard("{Escape}");
      await userEvent.click(screen.getByRole("button", { name: "Paste text" }));
      expect(
        screen.getByRole("textbox", { name: "Pasted job posting text" })
      ).toHaveValue("A pasted posting");
    });

    it("sends ANALYZE_PASTED_TEXT with the draft text on submit", async () => {
      render(<JobPanel tabId={null} />);
      await userEvent.click(screen.getByRole("button", { name: "Paste text" }));
      const longText = "A genuine job posting description. ".repeat(10);
      await userEvent.type(
        screen.getByRole("textbox", { name: "Pasted job posting text" }),
        longText
      );
      await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: MessageType.ANALYZE_PASTED_TEXT,
        text: longText,
        assumeJobPosting: false,
      });
    });

    it("renders the result on PASTE_ANALYSIS_RESULT without touching the This Page view", async () => {
      render(<JobPanel tabId={null} />);
      await userEvent.click(screen.getByRole("button", { name: "Paste text" }));

      dispatch({
        type: MessageType.PASTE_ANALYSIS_RESULT,
        analysis,
        canonicalUrl: "paste:" + "a".repeat(64),
        saved: null,
        strategy: "paste",
      });
      expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");
      expect(screen.getByRole("button", { name: "Analyze this page" })).toBeInTheDocument();
    });

    it("saves a paste-sourced analysis with source 'paste' and an empty sourceUrl", async () => {
      render(<JobPanel tabId={null} />);
      await userEvent.click(screen.getByRole("button", { name: "Paste text" }));
      const canonicalUrl = "paste:" + "b".repeat(64);
      dispatch({
        type: MessageType.PASTE_ANALYSIS_RESULT,
        analysis,
        canonicalUrl,
        saved: null,
        strategy: "paste",
      });
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByText(/Saved to your library/);

      const { jobStorage } = await import("../../services/jobStorage");
      const stored = await jobStorage.get(canonicalUrl);
      expect(stored).not.toBeNull();
      expect(stored!.source).toBe("paste");
      expect(stored!.sourceUrl).toBe("");
    });

    it("falls back to an excerpt of the pasted text as the title when analysis produced none (FR-020a)", async () => {
      render(<JobPanel tabId={null} />);
      await userEvent.click(screen.getByRole("button", { name: "Paste text" }));
      const draft =
        "A fully remote backend engineering role focused on distributed systems and reliability work. ".repeat(
          4
        );
      await userEvent.type(
        screen.getByRole("textbox", { name: "Pasted job posting text" }),
        draft
      );

      const canonicalUrl = "paste:" + "c".repeat(64);
      dispatch({
        type: MessageType.PASTE_ANALYSIS_RESULT,
        analysis: { ...analysis, title: null },
        canonicalUrl,
        saved: null,
        strategy: "paste",
      });
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByText(/Saved to your library/);

      const { jobStorage } = await import("../../services/jobStorage");
      const stored = await jobStorage.get(canonicalUrl);
      expect(stored!.analysis.title).not.toBeNull();
      expect(stored!.analysis.title).not.toBe("");
      expect(stored!.analysis.title).not.toMatch(/^paste:/);
      expect(stored!.analysis.title).toContain("A fully remote backend engineering role");
    });
  });

  describe("region scoping (spec FR-023, FR-026, FR-026a, T095, T105)", () => {
    it("commits a picked region: shows analyzing immediately, bypasses to ANALYZE_SCOPED_REGION, and re-runs the same region on Retry after a failure", async () => {
      vi.mocked(pickerService.listCandidates).mockResolvedValue([
        { selector: "main", label: "Main content", textLength: 500, excerpt: "excerpt" },
      ]);
      vi.mocked(pickerService.resolveCandidateText).mockResolvedValue({
        ok: true,
        text: "the picked region's text",
      });

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

      await userEvent.click(
        screen.getByRole("button", { name: /Wrong region\? Analyze a region/ })
      );
      await screen.findByRole("listbox");
      await userEvent.keyboard("{Enter}");

      // T095: the indicator appears synchronously with the commit, not only
      // once a response arrives.
      expect(await screen.findByRole("status")).toBeInTheDocument();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: MessageType.ANALYZE_SCOPED_REGION,
        tabId: 7,
        text: "the picked region's text",
        selector: "main",
        mechanism: "picked",
      });

      vi.mocked(chrome.runtime.sendMessage).mockClear();
      dispatch({
        type: MessageType.JOB_ANALYSIS_ERROR,
        error: {
          code: "service-error",
          message: "The analysis service encountered an error.",
          action: "Try again.",
          retryable: true,
        },
        fallback: null,
        canonicalUrl: "https://example.com/jobs/1",
        sourceUrl: "https://example.com/jobs/1",
      });

      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      // T105: Retry re-runs against the SAME committed region, not a normal
      // page re-extraction.
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: MessageType.ANALYZE_SCOPED_REGION,
        tabId: 7,
        text: "the picked region's text",
        selector: "main",
        mechanism: "picked",
      });
    });

    it("clears the pending scoped region on navigation, so a later Retry does a normal page analysis", async () => {
      vi.mocked(pickerService.listCandidates).mockResolvedValue([
        { selector: "main", label: "Main content", textLength: 500, excerpt: "excerpt" },
      ]);
      vi.mocked(pickerService.resolveCandidateText).mockResolvedValue({
        ok: true,
        text: "the picked region's text",
      });

      const { rerender } = render(<JobPanel tabId={7} navigationId={0} />);
      dispatch({
        type: MessageType.JOB_ANALYSIS_RESULT,
        analysis,
        canonicalUrl: "https://example.com/jobs/1",
        sourceUrl: "https://example.com/jobs/1",
        multiplePostings: false,
        cached: false,
        saved: null,
      });
      await userEvent.click(
        screen.getByRole("button", { name: /Wrong region\? Analyze a region/ })
      );
      await screen.findByRole("listbox");
      await userEvent.keyboard("{Enter}");
      await screen.findByRole("status");

      rerender(<JobPanel tabId={7} navigationId={1} />);
      vi.mocked(chrome.runtime.sendMessage).mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Analyze this page" }));

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: MessageType.ANALYZE_JOB_PAGE })
      );
    });
  });
});
