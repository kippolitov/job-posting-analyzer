import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ACTION_HINT_PORT,
  clearActionHint,
  listenForActionHints,
  setActionHint,
} from "../../services/actionHint";

function badgeTextFor(tabId: number): string | undefined {
  const calls = vi
    .mocked(chrome.action.setBadgeText)
    .mock.calls.filter(([d]) => d.tabId === tabId);
  return calls.at(-1)?.[0].text;
}

describe("actionHint", () => {
  beforeEach(async () => {
    await setActionHint(null);
    vi.clearAllMocks();
  });

  it("marks the tab that needs a click, and moves the mark when the tab changes", async () => {
    await setActionHint(4);
    expect(badgeTextFor(4)).toBe("Go");
    await setActionHint(5);
    expect(badgeTextFor(4)).toBe("");
    expect(badgeTextFor(5)).toBe("Go");
  });

  it("clears the mark when that tab's icon is clicked", async () => {
    await setActionHint(4);
    clearActionHint(4);
    await vi.waitFor(() => expect(badgeTextFor(4)).toBe(""));
  });

  it("clears the mark when the panel's port disconnects", async () => {
    listenForActionHints();
    const [onConnect] = vi.mocked(chrome.runtime.onConnect.addListener).mock.calls[0];
    let onMessage: ((m: { tabId: number | null }) => void) | undefined;
    let onDisconnect: (() => void) | undefined;
    onConnect({
      name: ACTION_HINT_PORT,
      onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) },
      onDisconnect: { addListener: (fn: typeof onDisconnect) => (onDisconnect = fn) },
    } as unknown as chrome.runtime.Port);

    onMessage?.({ tabId: 9 });
    await vi.waitFor(() => expect(badgeTextFor(9)).toBe("Go"));
    onDisconnect?.();
    await vi.waitFor(() => expect(badgeTextFor(9)).toBe(""));
  });
});
