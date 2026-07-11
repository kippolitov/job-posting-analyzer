import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageType } from "../../types/messages";
import type { ExtensionMessage } from "../../types/messages";

import { App } from "../../entrypoints/sidepanel/App";

// These tests cover panel behavior behind the gate; AuthGate has its own suite.
vi.mock("../../services/auth/authState", () => ({
  readAuthSnapshot: vi.fn().mockResolvedValue({
    status: "signed-in",
    user: { sub: "sub-1", email: "user@example.com" },
  }),
  onAuthChange: vi.fn(() => () => {}),
}));

function getRegisteredListeners(): Array<(message: ExtensionMessage) => void> {
  const addListener = chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>;
  return addListener.mock.calls.map((call) => call[0] as (message: ExtensionMessage) => void);
}

function dispatchToAll(message: ExtensionMessage): void {
  for (const listener of getRegisteredListeners()) listener(message);
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
      message: { type: string }
    ) => {
      if (message.type === MessageType.GET_ACTIVE_TAB) {
        return Promise.resolve({ tabId: null });
      }
      return Promise.resolve(undefined);
    }) as never);
  });

  it("renders the idle state before the active tab resolves", async () => {
    render(<App />);
    expect(
      await screen.findByText("Analyze the current page as a job posting")
    ).toBeInTheDocument();
  });

  it("auto-analyzes once the active tab resolves (mount, no navigation yet)", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: {
      type: string;
    }) => {
      if (message.type === MessageType.GET_ACTIVE_TAB) {
        return Promise.resolve({ tabId: 4 });
      }
      return Promise.resolve(undefined);
    }) as never);

    render(<App />);
    await waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: MessageType.ANALYZE_JOB_PAGE,
        tabId: 4,
        assumeJobPosting: false,
        bypassCache: false,
        cachedOnly: false,
      });
    });
  });

  it("re-analyzes on an action-click ACTIVE_TAB_CHANGED (fresh activeTab grant)", async () => {
    render(<App />);
    await screen.findByText("Analyze the current page as a job posting");

    act(() => {
      dispatchToAll({
        type: MessageType.ACTIVE_TAB_CHANGED,
        tabId: 4,
        trigger: "action-click",
      });
    });

    await waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: MessageType.ANALYZE_JOB_PAGE,
        tabId: 4,
        assumeJobPosting: false,
        bypassCache: false,
        cachedOnly: false,
      });
    });
  });

  it("silently probes for a stored analysis on a tab-switch ACTIVE_TAB_CHANGED", async () => {
    render(<App />);
    await screen.findByText("Analyze the current page as a job posting");

    act(() => {
      dispatchToAll({
        type: MessageType.ACTIVE_TAB_CHANGED,
        tabId: 6,
        trigger: "tab-switch",
      });
    });

    await waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: MessageType.ANALYZE_JOB_PAGE,
        tabId: 6,
        assumeJobPosting: false,
        bypassCache: false,
        cachedOnly: true,
      });
    });
    // The probe may go unanswered, so the panel must stay idle, not spin.
    expect(
      screen.getByText("Analyze the current page as a job posting")
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("drops stale state on a navigation ACTIVE_TAB_CHANGED", async () => {
    render(<App />);
    await screen.findByText("Analyze the current page as a job posting");

    act(() => {
      dispatchToAll({
        type: MessageType.JOB_ANALYSIS_RESULT,
        analysis: {
          isJobPosting: true,
          title: "Senior Engineer",
          company: "Acme",
          location: null,
          arrangement: "remote",
          arrangementConfidence: "explicit",
          arrangementEvidence: "Fully remote",
          daysInOffice: null,
          daysRemote: null,
          remoteRestrictions: null,
          salary: null,
          seniority: "senior",
          techStack: [],
          fit: null,
          model: "gpt-4o-mini",
          analyzedAt: "2026-07-04T12:00:00Z",
        },
        canonicalUrl: "https://example.com/jobs/1",
        sourceUrl: "https://example.com/jobs/1",
        multiplePostings: false,
        cached: false,
        saved: null,
      });
    });
    expect(await screen.findByText("Senior Engineer")).toBeInTheDocument();

    act(() => {
      dispatchToAll({
        type: MessageType.ACTIVE_TAB_CHANGED,
        tabId: 5,
        trigger: "navigation",
      });
    });
    expect(
      await screen.findByText("Analyze the current page as a job posting")
    ).toBeInTheDocument();
    expect(screen.queryByText("Senior Engineer")).not.toBeInTheDocument();
  });

  it("cycles the theme preference on the theme button", async () => {
    render(<App />);
    await screen.findByText("Analyze the current page as a job posting");

    const user = userEvent.setup();
    const themeButton = screen.getByRole("button", { name: /Current theme: system/ });
    await user.click(themeButton);

    expect(screen.getByRole("button", { name: /Current theme: light/ })).toBeInTheDocument();
    expect(localStorage.getItem("theme-preference")).toBe("light");

    await user.click(screen.getByRole("button", { name: /Current theme: light/ }));
    expect(screen.getByRole("button", { name: /Current theme: dark/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Current theme: dark/ }));
    expect(screen.getByRole("button", { name: /Current theme: system/ })).toBeInTheDocument();
  });

  it("removes the message listener on unmount", async () => {
    const { unmount } = render(<App />);
    await screen.findByText("Analyze the current page as a job posting");
    unmount();
    await waitFor(() =>
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled()
    );
  });
});
