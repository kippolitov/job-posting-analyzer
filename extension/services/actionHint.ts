/**
 * Toolbar "Go" badge: while the panel is asking the user to click the
 * extension icon, the icon itself is marked so the eye goes straight to it.
 *
 * The panel holds a long-lived port and posts the tab that needs the click
 * (or null). The port disconnecting — the panel closed — clears the badge, so
 * it never outlives the prompt that explains it.
 */
export const ACTION_HINT_PORT = "job-panel-action-hint";

export interface ActionHintMessage {
  tabId: number | null;
}

const HINT_TEXT = "Go";
const HINT_COLOR = "#2563eb";
const HINT_TITLE = "Click to analyze this page";

let hintedTabId: number | null = null;

export function listenForActionHints(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== ACTION_HINT_PORT) return;
    port.onMessage.addListener((message: ActionHintMessage) => {
      void setActionHint(message?.tabId ?? null);
    });
    port.onDisconnect.addListener(() => {
      void setActionHint(null);
    });
  });
}

/** The toolbar click happened: the hint has done its job on that tab. */
export function clearActionHint(tabId: number): void {
  if (tabId === hintedTabId) void setActionHint(null);
}

export async function setActionHint(tabId: number | null): Promise<void> {
  if (tabId === hintedTabId) return;
  const previous = hintedTabId;
  hintedTabId = tabId;
  if (previous !== null) await paint(previous, false);
  if (tabId !== null) await paint(tabId, true);
}

async function paint(tabId: number, on: boolean): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: on ? HINT_TEXT : "" });
    if (on) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: HINT_COLOR });
      await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" });
    }
    await chrome.action.setTitle({
      tabId,
      title: on ? HINT_TITLE : chrome.runtime.getManifest().name,
    });
  } catch {
    // Tab closed in the meantime — nothing left to paint.
  }
}
