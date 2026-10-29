import {
  analyzeJobPage,
  rescoreJobPage,
  analyzePastedText,
  analyzeScopedRegion,
  cancelAnalysis,
  handleActionClick,
  resolveActiveTab,
  trackContentTabs,
} from "../services/jobFlow";
import { readLiveSelection } from "../services/selectionService";
import { MessageType } from "../types/messages";
import type { ActiveTabResponse, ExtensionMessage } from "../types/messages";

const ANALYZE_SELECTION_MENU_ID = "analyze-selection";

declare const WXT_AZURE_FUNCTION_URL: string;

export default defineBackground({
  main() {
    console.log("[background] service URL configured:", !!WXT_AZURE_FUNCTION_URL);
    // Do NOT use setPanelBehavior({ openPanelOnActionClick: true }): panels
    // opened that way never receive the activeTab grant (crbug.com/40926394),
    // so page extraction would always fail. Instead the click lands on
    // action.onClicked — which does grant activeTab — and the panel is opened
    // here, synchronously within the user gesture as sidePanel.open requires.
    chrome.action.onClicked.addListener((tab) => {
      if (tab.windowId !== undefined) {
        void chrome.sidePanel.open({ windowId: tab.windowId });
      }
      handleActionClick(tab, broadcastToSidePanel);
    });
    trackContentTabs(broadcastToSidePanel);

    // "Analyze selection" (spec FR-023a): works without the panel already
    // open, because the contextMenus onClicked handler carries its own
    // activeTab grant — unlike everything else here, which depends on the
    // toolbar-click grant.
    chrome.contextMenus.create({
      id: ANALYZE_SELECTION_MENU_ID,
      title: "Analyze selection",
      contexts: ["selection"],
    });
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== ANALYZE_SELECTION_MENU_ID || tab?.id === undefined) return;
      if (tab.windowId !== undefined) {
        void chrome.sidePanel.open({ windowId: tab.windowId });
      }
      void (async () => {
        const tabId = tab.id as number;
        const selection = await readLiveSelection(tabId);
        if (!selection.ok) {
          // FR-036a: cause-specific wording, not one generic message — an
          // empty selection is fixed by selecting again; a shadow-root or
          // cross-origin-iframe selection never can be, so it points at the
          // one path that does work instead (paste).
          const action =
            selection.cause === "unscopeable"
              ? "Try a different part of the page, or paste the text instead."
              : "Select the posting text on the page, then try again.";
          broadcastToSidePanel({
            type: MessageType.JOB_ANALYSIS_ERROR,
            error: {
              code: "thin-content",
              message: selection.reason,
              action,
              retryable: false,
            },
            fallback: null,
            canonicalUrl: null,
            sourceUrl: null,
          });
          return;
        }
        await analyzeScopedRegion(
          {
            type: MessageType.ANALYZE_SCOPED_REGION,
            tabId,
            text: selection.text,
            selector: selection.selector,
            mechanism: "selection",
          },
          broadcastToSidePanel
        );
      })();
    });

    chrome.runtime.onMessage.addListener(
      (message: ExtensionMessage, sender, sendResponse) => {
        if (message.type === MessageType.GET_ACTIVE_TAB) {
          // sender.tab is set when the panel page runs as a regular tab; its
          // URL is not readable without the "tabs" permission, so the id is
          // the only reliable way to keep the panel from analyzing itself.
          void resolveActiveTab(sender.tab?.id ?? null).then(
            (response: ActiveTabResponse) => sendResponse(response)
          );
          return true; // async response
        }
        if (message.type === MessageType.ANALYZE_JOB_PAGE) {
          void analyzeJobPage(message, broadcastToSidePanel);
        }
        if (message.type === MessageType.RESCORE_JOB_PAGE) {
          void rescoreJobPage(message, broadcastToSidePanel);
        }
        if (message.type === MessageType.CANCEL_ANALYSIS) {
          cancelAnalysis(message);
        }
        if (message.type === MessageType.ANALYZE_PASTED_TEXT) {
          void analyzePastedText(message, broadcastToSidePanel);
        }
        if (message.type === MessageType.ANALYZE_SCOPED_REGION) {
          void analyzeScopedRegion(message, broadcastToSidePanel);
        }
        sendResponse({ received: true });
        return true;
      }
    );
  },
});

function broadcastToSidePanel(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open
  });
}
