import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { MessageType } from "../../types/messages";
import type { ExtensionMessage } from "../../types/messages";

vi.mock("../../services/jobFlow", () => ({
  analyzeJobPage: vi.fn(),
  analyzePastedText: vi.fn(),
  analyzeScopedRegion: vi.fn(),
  handleActionClick: vi.fn(),
  resolveActiveTab: vi.fn(),
  trackContentTabs: vi.fn(),
}));
vi.mock("../../services/selectionService", () => ({
  readLiveSelection: vi.fn(),
}));

import {
  analyzeJobPage,
  analyzeScopedRegion,
  handleActionClick,
  resolveActiveTab,
  trackContentTabs,
} from "../../services/jobFlow";
import { readLiveSelection } from "../../services/selectionService";

type MessageListener = (
  message: ExtensionMessage,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean;

let listener: MessageListener;

beforeAll(async () => {
  vi.stubGlobal("defineBackground", (def: { main: () => void }) => def);
  vi.stubGlobal("WXT_AZURE_FUNCTION_URL", "http://localhost:7071/api/analyze-job");
  vi.spyOn(console, "log").mockImplementation(() => {});

  const entrypoint = (await import("../../entrypoints/background")).default as {
    main: () => void;
  };
  entrypoint.main();

  const addListener = chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>;
  listener = addListener.mock.calls.at(-1)![0] as MessageListener;
});

describe("background entrypoint", () => {
  beforeEach(() => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockReset();
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.mocked(analyzeJobPage).mockReset();
    vi.mocked(resolveActiveTab).mockReset();
    vi.mocked(handleActionClick).mockReset();
    vi.mocked(analyzeScopedRegion).mockReset();
    vi.mocked(readLiveSelection).mockReset();
  });

  it("opens the side panel and hands the click to jobFlow", () => {
    // setPanelBehavior(openPanelOnActionClick) must NOT be used: panels
    // opened that way never receive the activeTab grant (crbug.com/40926394).
    expect(chrome.sidePanel.setPanelBehavior).not.toHaveBeenCalled();

    const addListener = chrome.action.onClicked.addListener as ReturnType<typeof vi.fn>;
    expect(addListener).toHaveBeenCalledTimes(1);
    const onClicked = addListener.mock.calls[0]![0] as (tab: chrome.tabs.Tab) => void;
    onClicked({ id: 7, windowId: 3, url: "https://example.com/jobs/1" } as chrome.tabs.Tab);

    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    expect(handleActionClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.any(Function)
    );
  });

  it("registers tab tracking on startup", () => {
    expect(trackContentTabs).toHaveBeenCalledWith(expect.any(Function));
  });

  it("GET_ACTIVE_TAB resolves asynchronously with the background's answer", async () => {
    vi.mocked(resolveActiveTab).mockResolvedValue({ tabId: 42 });
    const sendResponse = vi.fn();
    const keepAlive = listener(
      { type: MessageType.GET_ACTIVE_TAB },
      { tab: { id: 5 } },
      sendResponse
    );
    expect(keepAlive).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ tabId: 42 }));
    expect(resolveActiveTab).toHaveBeenCalledWith(5);
  });

  it("ANALYZE_JOB_PAGE delegates to jobFlow.analyzeJobPage", async () => {
    vi.mocked(analyzeJobPage).mockResolvedValue(undefined);
    const sendResponse = vi.fn();
    listener(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 },
      {},
      sendResponse
    );
    expect(sendResponse).toHaveBeenCalledWith({ received: true });
    await vi.waitFor(() => expect(analyzeJobPage).toHaveBeenCalled());
  });

  it("swallows broadcast failures when the side panel is closed", async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Could not establish connection")
    );
    vi.mocked(resolveActiveTab).mockResolvedValue({ tabId: null });

    const addListener = chrome.action.onClicked.addListener as ReturnType<typeof vi.fn>;
    const onClicked = addListener.mock.calls[0]![0] as (tab: chrome.tabs.Tab) => void;
    onClicked({ id: 7, windowId: 3, url: "https://example.com" } as chrome.tabs.Tab);

    // broadcastToSidePanel is passed into handleActionClick; invoke it here
    // to exercise the swallow path directly.
    const broadcast = vi.mocked(handleActionClick).mock.calls.at(-1)![1];
    broadcast({ type: MessageType.ACTIVE_TAB_CHANGED, tabId: 7, trigger: "action-click" });

    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalled());
    // no unhandled rejection — reaching this point is the assertion
  });

  it("registers the 'Analyze selection' context menu item, contexts: selection only", () => {
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "analyze-selection",
        title: "Analyze selection",
        contexts: ["selection"],
      })
    );
  });

  it("ANALYZE_SCOPED_REGION delegates to jobFlow.analyzeScopedRegion", async () => {
    vi.mocked(analyzeScopedRegion).mockResolvedValue(undefined);
    const sendResponse = vi.fn();
    listener(
      {
        type: MessageType.ANALYZE_SCOPED_REGION,
        tabId: 7,
        text: "some scoped text",
        selector: ".body",
        mechanism: "picked",
      },
      {},
      sendResponse
    );
    expect(sendResponse).toHaveBeenCalledWith({ received: true });
    await vi.waitFor(() => expect(analyzeScopedRegion).toHaveBeenCalled());
  });

  it("'Analyze selection' click reads the live selection and forwards it to analyzeScopedRegion with mechanism 'selection'", async () => {
    vi.mocked(readLiveSelection).mockResolvedValue({
      ok: true,
      text: "the selected posting text",
      selector: "#posting",
    });
    vi.mocked(analyzeScopedRegion).mockResolvedValue(undefined);

    const addListener = chrome.contextMenus.onClicked.addListener as ReturnType<typeof vi.fn>;
    const onClicked = addListener.mock.calls[0]![0] as (
      info: chrome.contextMenus.OnClickData,
      tab?: chrome.tabs.Tab
    ) => void;
    onClicked(
      { menuItemId: "analyze-selection" } as chrome.contextMenus.OnClickData,
      { id: 11, windowId: 4 } as chrome.tabs.Tab
    );

    await vi.waitFor(() => expect(analyzeScopedRegion).toHaveBeenCalled());
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
    expect(analyzeScopedRegion).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 11,
        text: "the selected posting text",
        selector: "#posting",
        mechanism: "selection",
      }),
      expect.any(Function)
    );
  });

  it("'Analyze selection' click broadcasts a plain-language error when nothing is addressable (spec Edge Cases)", async () => {
    vi.mocked(readLiveSelection).mockResolvedValue({
      ok: false,
      reason: "This part of the page can't be scoped.",
    });

    const addListener = chrome.contextMenus.onClicked.addListener as ReturnType<typeof vi.fn>;
    const onClicked = addListener.mock.calls[0]![0] as (
      info: chrome.contextMenus.OnClickData,
      tab?: chrome.tabs.Tab
    ) => void;
    onClicked(
      { menuItemId: "analyze-selection" } as chrome.contextMenus.OnClickData,
      { id: 11, windowId: 4 } as chrome.tabs.Tab
    );

    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalled());
    expect(analyzeScopedRegion).not.toHaveBeenCalled();
    const [broadcastPayload] = vi.mocked(chrome.runtime.sendMessage).mock.calls.at(-1)!;
    expect(broadcastPayload).toMatchObject({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: { message: "This part of the page can't be scoped." },
    });
  });
});
