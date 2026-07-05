import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleActionClick,
  resolveActiveTab,
  trackContentTabs,
} from "../../services/jobFlow";

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
  } {
    const activated: Array<(info: { tabId: number }) => void> = [];
    const updated: UpdatedListener[] = [];
    vi.mocked(chrome.tabs.onActivated.addListener).mockImplementation(((
      listener: (info: { tabId: number }) => void
    ) => activated.push(listener)) as never);
    vi.mocked(chrome.tabs.onUpdated.addListener).mockImplementation(((
      listener: UpdatedListener
    ) => updated.push(listener)) as never);
    trackContentTabs(broadcast as never);
    return { activated, updated };
  }

  beforeEach(() => {
    vi.mocked(chrome.tabs.get).mockReset();
    vi.mocked(chrome.tabs.onActivated.addListener).mockReset();
    vi.mocked(chrome.tabs.onUpdated.addListener).mockReset();
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

  it("broadcasts on activation of a tracked tab", async () => {
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
      trigger: "navigation",
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
