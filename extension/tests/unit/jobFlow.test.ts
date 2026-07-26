import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzeJobPage,
  analyzeScopedRegion,
  cancelAnalysis,
  handleActionClick,
  resolveActiveTab,
  trackContentTabs,
} from "../../services/jobFlow";
import { learnedSelectors } from "../../services/learnedSelectors";
import { postJobAnalysis } from "../../services/jobAnalysisClient";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { MessageType } from "../../types/messages";

vi.mock("../../services/learnedSelectors", () => ({
  learnedSelectors: {
    get: vi.fn(),
    put: vi.fn(),
    touch: vi.fn(),
    recordMiss: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn(),
    list: vi.fn(),
  },
}));
vi.mock("../../services/jobAnalysisClient", () => ({
  postJobAnalysis: vi.fn(),
}));

function stubActiveTab(tab: Partial<chrome.tabs.Tab> | undefined): void {
  vi.mocked(chrome.tabs.query).mockResolvedValue(
    (tab ? [tab] : []) as chrome.tabs.Tab[]
  );
}

describe("jobFlow — resolveActiveTab", () => {
  beforeEach(() => {
    vi.mocked(chrome.tabs.query).mockReset();
    vi.mocked(chrome.tabs.get).mockReset();
  });

  it("resolves the active tab for any http(s) page", async () => {
    stubActiveTab({ id: 6, url: "https://www.linkedin.com/jobs/view/123" });
    await expect(resolveActiveTab()).resolves.toEqual({ tabId: 6 });
  });

  it("resolves the active tab even when its URL is not readable", async () => {
    stubActiveTab({ id: 7, url: undefined });
    await expect(resolveActiveTab()).resolves.toEqual({ tabId: 7 });
  });

  it("falls back to the tracked content tab when the panel page itself is active", async () => {
    const listeners: Array<(info: { tabId: number }) => void> = [];
    vi.mocked(chrome.tabs.onActivated.addListener).mockImplementation(((
      listener: (info: { tabId: number }) => void
    ) => listeners.push(listener)) as never);
    trackContentTabs();
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 9,
      url: "https://boards.greenhouse.io/acme/jobs/1",
    } as chrome.tabs.Tab);
    listeners[0]!({ tabId: 9 });
    await vi.waitFor(() => expect(chrome.tabs.get).toHaveBeenCalled());

    stubActiveTab({ id: 99, url: "chrome-extension://abc/sidepanel.html" });
    await expect(resolveActiveTab()).resolves.toEqual({ tabId: 9 });
  });

  it("resolves to no tab when nothing is resolvable", async () => {
    vi.mocked(chrome.tabs.query).mockRejectedValue(new Error("no tabs api"));
    const result = await resolveActiveTab();
    expect(result.tabId).toBeNull();
  });
});

describe("jobFlow — trackContentTabs broadcasts", () => {
  type UpdatedListener = (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ) => void;

  function install(broadcast: (m: unknown) => void): {
    activated: Array<(info: { tabId: number }) => void>;
    updated: UpdatedListener[];
    removed: Array<(tabId: number) => void>;
  } {
    const activated: Array<(info: { tabId: number }) => void> = [];
    const updated: UpdatedListener[] = [];
    const removed: Array<(tabId: number) => void> = [];
    vi.mocked(chrome.tabs.onActivated.addListener).mockImplementation(((
      listener: (info: { tabId: number }) => void
    ) => activated.push(listener)) as never);
    vi.mocked(chrome.tabs.onUpdated.addListener).mockImplementation(((
      listener: UpdatedListener
    ) => updated.push(listener)) as never);
    vi.mocked(chrome.tabs.onRemoved.addListener).mockImplementation(((
      listener: (tabId: number) => void
    ) => removed.push(listener)) as never);
    trackContentTabs(broadcast as never);
    return { activated, updated, removed };
  }

  beforeEach(() => {
    vi.mocked(chrome.tabs.get).mockReset();
    vi.mocked(chrome.tabs.onActivated.addListener).mockReset();
    vi.mocked(chrome.tabs.onUpdated.addListener).mockReset();
    vi.mocked(chrome.tabs.onRemoved.addListener).mockReset();
    vi.mocked(chrome.storage.session.remove).mockClear();
  });

  it("broadcasts ACTIVE_TAB_CHANGED when the active tab starts a navigation", async () => {
    const broadcasts: unknown[] = [];
    const { updated } = install((m) => broadcasts.push(m));
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 12,
      url: undefined,
    } as chrome.tabs.Tab);

    updated[0]!(12, { status: "loading" }, { active: true } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(broadcasts.length).toBe(1));
    expect(broadcasts[0]).toEqual({
      type: "ACTIVE_TAB_CHANGED",
      tabId: 12,
      trigger: "navigation",
    });
  });

  it("broadcasts a tab-switch trigger on activation of a tracked tab", async () => {
    const broadcasts: unknown[] = [];
    const { activated } = install((m) => broadcasts.push(m));
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 3,
      url: "https://boards.greenhouse.io/acme/jobs/1",
    } as chrome.tabs.Tab);

    activated[0]!({ tabId: 3 });
    await vi.waitFor(() => expect(broadcasts.length).toBe(1));
    expect(broadcasts[0]).toEqual({
      type: "ACTIVE_TAB_CHANGED",
      tabId: 3,
      trigger: "tab-switch",
    });
  });

  it("skips a tracked tab that has since become the panel page itself", async () => {
    const broadcasts: unknown[] = [];
    const { activated } = install((m) => broadcasts.push(m));

    // A job posting tab is tracked, then a brand-new tab (still about:blank,
    // so its URL is unreadable) is activated and tracked too.
    const urls = new Map<number, string | undefined>([
      [9, "https://boards.greenhouse.io/acme/jobs/1"],
      [10, undefined],
    ]);
    vi.mocked(chrome.tabs.get).mockImplementation((async (id: number) => ({
      id,
      url: urls.get(id),
    })) as never);
    activated[0]!({ tabId: 9 });
    await vi.waitFor(() => expect(broadcasts.length).toBe(1));
    activated[0]!({ tabId: 10 });
    await vi.waitFor(() => expect(broadcasts.length).toBe(2));

    // The new tab then loads the panel page (sidepanel.html opened as a tab).
    // Resolution must skip it and fall back to the posting tab.
    urls.set(10, "chrome-extension://abc/sidepanel.html");
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 99, url: "chrome-extension://abc/sidepanel.html" },
    ] as chrome.tabs.Tab[]);
    await expect(resolveActiveTab()).resolves.toEqual({ tabId: 9 });
  });

  it("excludes the panel's own tab (sender) even when its URL is unreadable", async () => {
    const broadcasts: unknown[] = [];
    const { activated } = install((m) => broadcasts.push(m));

    // Without the "tabs" permission the panel tab's chrome-extension:// URL
    // is invisible, so both the posting tab and the panel tab look the same
    // (url undefined). Only the sender id tells them apart.
    vi.mocked(chrome.tabs.get).mockImplementation((async (id: number) => ({
      id,
      url: undefined,
    })) as never);
    activated[0]!({ tabId: 21 }); // posting tab
    await vi.waitFor(() => expect(broadcasts.length).toBe(1));
    activated[0]!({ tabId: 22 }); // panel page opened as a tab
    await vi.waitFor(() => expect(broadcasts.length).toBe(2));

    // The panel tab is the active tab and also the message sender.
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 22, url: undefined },
    ] as chrome.tabs.Tab[]);
    await expect(resolveActiveTab(22)).resolves.toEqual({
      tabId: 21,
    });
  });

  it("toolbar click broadcasts an action-click trigger for the clicked tab", async () => {
    const broadcasts: unknown[] = [];
    handleActionClick(
      { id: 4, url: "https://example.com/jobs/1" } as chrome.tabs.Tab,
      (m) => broadcasts.push(m)
    );
    expect(broadcasts[0]).toEqual({
      type: "ACTIVE_TAB_CHANGED",
      tabId: 4,
      trigger: "action-click",
    });

    // The clicked tab becomes the top resolution candidate.
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 99, url: "chrome-extension://abc/sidepanel.html" },
    ] as chrome.tabs.Tab[]);
    vi.mocked(chrome.tabs.get).mockImplementation((async (id: number) => ({
      id,
      url: id === 4 ? "https://example.com/jobs/1" : undefined,
    })) as never);
    await expect(resolveActiveTab()).resolves.toEqual({
      tabId: 4,
    });
  });

  it("forgets the tab's remembered URL when it navigates, even in the background", async () => {
    const { updated } = install(() => {});

    updated[0]!(12, { status: "loading" }, { active: false } as chrome.tabs.Tab);

    await vi.waitFor(() =>
      expect(chrome.storage.session.remove).toHaveBeenCalledWith("taburl:12")
    );
  });

  it("forgets the tab's remembered URL when it closes", async () => {
    const { removed } = install(() => {});

    removed[0]!(15);

    await vi.waitFor(() =>
      expect(chrome.storage.session.remove).toHaveBeenCalledWith("taburl:15")
    );
  });

  it("does not track explicit about:blank tabs", async () => {
    const broadcasts: unknown[] = [];
    const { activated } = install((m) => broadcasts.push(m));
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 11,
      url: "about:blank",
    } as chrome.tabs.Tab);

    activated[0]!({ tabId: 11 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(broadcasts).toEqual([]);
  });

  it("does not broadcast for non-navigation tab updates or extension pages", async () => {
    const broadcasts: unknown[] = [];
    const { activated, updated } = install((m) => broadcasts.push(m));

    // "complete" without a url change is the tail of a navigation already
    // announced by its "loading" event.
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 12,
      url: undefined,
    } as chrome.tabs.Tab);
    updated[0]!(12, { status: "complete" }, { active: true } as chrome.tabs.Tab);

    // Activating the panel's own page must not broadcast.
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 99,
      url: "chrome-extension://abc/sidepanel.html",
    } as chrome.tabs.Tab);
    activated[0]!({ tabId: 99 });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(broadcasts).toEqual([]);
  });
});

describe("jobFlow — analyzeJobPage learned-selector wiring (FR-028, FR-029, T076)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 5,
      url: "https://jobs.example.com/posting/1",
    } as chrome.tabs.Tab);
  });

  function stubExtraction(raw: {
    url: string;
    strategy: string;
    learnedSelectorMissed: boolean;
    mainText?: string;
  }): void {
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
      {
        result: {
          url: raw.url,
          title: "A posting",
          jsonLd: [],
          structuredSources: [],
          mainText: raw.mainText ?? "A genuine posting body. ".repeat(20),
          extractedAt: "2026-07-04T12:00:00Z",
          provenance: {
            strategy: raw.strategy,
            attempts: 1,
            elapsedMs: 10,
            budgetExpired: false,
            learnedSelectorMissed: raw.learnedSelectorMissed,
          },
        },
      },
    ] as never);
  }

  it("looks up the learned selector for the tab's host before injection", async () => {
    vi.mocked(learnedSelectors.get).mockResolvedValue(null);
    stubExtraction({
      url: "https://jobs.example.com/posting/1",
      strategy: "semantic",
      learnedSelectorMissed: false,
    });

    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 5 }, vi.fn());

    expect(learnedSelectors.get).toHaveBeenCalledWith("jobs.example.com");
  });

  it("passes the resolved selector into extractPage's args", async () => {
    vi.mocked(learnedSelectors.get).mockResolvedValue({
      host: "jobs.example.com",
      selector: ".job-body",
      learnedAt: "2026-01-01T00:00:00Z",
      lastUsedAt: "2026-01-01T00:00:00Z",
      consecutiveMisses: 0,
    });
    stubExtraction({
      url: "https://jobs.example.com/posting/1",
      strategy: "learned-selector",
      learnedSelectorMissed: false,
    });

    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 5 }, vi.fn());

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ args: [{ learnedSelector: ".job-body" }] })
    );
  });

  it("calls touch(host) when the learned selector was used successfully", async () => {
    vi.mocked(learnedSelectors.get).mockResolvedValue(null);
    stubExtraction({
      url: "https://jobs.example.com/posting/1",
      strategy: "learned-selector",
      learnedSelectorMissed: false,
    });

    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 5 }, vi.fn());

    expect(learnedSelectors.touch).toHaveBeenCalledWith("jobs.example.com");
    expect(learnedSelectors.recordMiss).not.toHaveBeenCalled();
  });

  it("calls recordMiss(host) exactly once when the learned selector missed, never touch", async () => {
    vi.mocked(learnedSelectors.get).mockResolvedValue(null);
    stubExtraction({
      url: "https://jobs.example.com/posting/1",
      strategy: "semantic",
      learnedSelectorMissed: true,
    });

    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 5 }, vi.fn());

    expect(learnedSelectors.recordMiss).toHaveBeenCalledWith("jobs.example.com");
    expect(learnedSelectors.recordMiss).toHaveBeenCalledTimes(1);
    expect(learnedSelectors.touch).not.toHaveBeenCalled();
  });

  it("calls neither touch nor recordMiss on an ordinary automatic extraction", async () => {
    vi.mocked(learnedSelectors.get).mockResolvedValue(null);
    stubExtraction({
      url: "https://jobs.example.com/posting/1",
      strategy: "semantic",
      learnedSelectorMissed: false,
    });

    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 5 }, vi.fn());

    expect(learnedSelectors.touch).not.toHaveBeenCalled();
    expect(learnedSelectors.recordMiss).not.toHaveBeenCalled();
  });

  it("proceeds without a learned selector when the tab's host cannot be resolved ahead of extraction", async () => {
    vi.mocked(chrome.tabs.get).mockRejectedValue(new Error("no access yet"));
    stubExtraction({
      url: "https://jobs.example.com/posting/1",
      strategy: "semantic",
      learnedSelectorMissed: false,
    });

    await expect(
      analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 5 }, vi.fn())
    ).resolves.toBeUndefined();
    expect(learnedSelectors.get).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ args: [{ learnedSelector: undefined }] })
    );
  });
});

describe("jobFlow — cancel then immediately re-trigger (FR-006c, T094)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryStorage("session");
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 5,
      url: "https://jobs.example.com/posting/1",
    } as chrome.tabs.Tab);
    vi.mocked(learnedSelectors.get).mockResolvedValue(null);
    vi.mocked(postJobAnalysis).mockResolvedValue({
      isJobPosting: true,
      title: "A posting",
      company: null,
      location: null,
      arrangement: "unspecified",
      arrangementConfidence: "none",
      arrangementEvidence: null,
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "unspecified",
      techStack: [],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-04T12:00:04Z",
    });
  });

  it("a fresh analysis right after a cancel completes normally — no lockout, no cooldown, no leftover generation mismatch", async () => {
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
      {
        result: {
          url: "https://jobs.example.com/posting/1",
          title: "A posting",
          jsonLd: [],
          structuredSources: [],
          mainText: "A genuine posting body. ".repeat(20),
          extractedAt: "2026-07-04T12:00:00Z",
          provenance: {
            strategy: "semantic",
            attempts: 1,
            elapsedMs: 10,
            budgetExpired: false,
            learnedSelectorMissed: false,
          },
        },
      },
    ] as never);

    // Cancel a would-be in-flight attempt for this tab...
    cancelAnalysis({ type: MessageType.CANCEL_ANALYSIS, tabId: 5 });

    // ...then immediately re-trigger. This is a brand-new call — analyzeJobPage
    // reads the CURRENT generation at its own start, so it is never born
    // already-cancelled by the bump above.
    const broadcasts: unknown[] = [];
    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 5 },
      (m) => broadcasts.push(m)
    );

    expect(broadcasts.length).toBeGreaterThan(0);
    const result = broadcasts[0] as { type: string };
    // A full, normal result — not silently suppressed as a stale generation.
    expect(result.type).not.toBe(MessageType.JOB_ANALYSIS_ERROR);
  });

  it("repeated cancel/re-trigger cycles never accumulate a lockout", async () => {
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
      {
        result: {
          url: "https://jobs.example.com/posting/1",
          title: "A posting",
          jsonLd: [],
          structuredSources: [],
          mainText: "A genuine posting body. ".repeat(20),
          extractedAt: "2026-07-04T12:00:00Z",
          provenance: {
            strategy: "semantic",
            attempts: 1,
            elapsedMs: 10,
            budgetExpired: false,
            learnedSelectorMissed: false,
          },
        },
      },
    ] as never);

    for (let i = 0; i < 5; i += 1) {
      cancelAnalysis({ type: MessageType.CANCEL_ANALYSIS, tabId: 5 });
    }

    const broadcasts: unknown[] = [];
    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 5 },
      (m) => broadcasts.push(m)
    );

    const result = broadcasts[0] as { type: string };
    expect(result.type).toBe(MessageType.JOB_ANALYSIS_RESULT);
  });
});

describe("jobFlow — no selector, host, or scoped content reaches the backend (FR-033, contracts §4, T081)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a scoped-region analysis request carries no selector or host field anywhere in its payload", async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 9,
      url: "https://jobs.example.com/posting/42",
    } as chrome.tabs.Tab);
    vi.mocked(postJobAnalysis).mockResolvedValue({
      isJobPosting: true,
      title: "Engineer",
      company: null,
      location: null,
      arrangement: "unspecified",
      arrangementConfidence: "none",
      arrangementEvidence: null,
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "unspecified",
      techStack: [],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-04T12:00:04Z",
    });

    await analyzeScopedRegion(
      {
        type: MessageType.ANALYZE_SCOPED_REGION,
        tabId: 9,
        text: "A scoped job posting body. ".repeat(20),
        selector: "main .job-description-secret-path",
        mechanism: "picked",
      },
      vi.fn()
    );

    expect(postJobAnalysis).toHaveBeenCalledTimes(1);
    const [request] = vi.mocked(postJobAnalysis).mock.calls[0]!;
    const requestJson = JSON.stringify(request);
    // The learned-selector STRING must never appear anywhere in the
    // transmitted request. (The page's own URL, which naturally contains its
    // host, is unrelated and expected — FR-033 is about the learned-selector
    // mechanism's own data, not about hiding the page being analyzed.)
    expect(requestJson).not.toContain("job-description-secret-path");
    expect(request.extract).not.toHaveProperty("selector");
    expect(request.extract).not.toHaveProperty("learnedSelector");
    expect(request.extract).not.toHaveProperty("provenance");
  });

  it("learnedSelectors is never imported by the request-building modules (jobAnalysisClient)", async () => {
    // A static check that the request layer has no path to a selector/host
    // even in principle: jobAnalysisClient does not import learnedSelectors.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(__dirname, "../../services/jobAnalysisClient.ts"),
      "utf-8"
    );
    expect(source).not.toContain("learnedSelectors");
  });
});
