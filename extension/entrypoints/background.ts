import {
  analyzeJobPage,
  handleActionClick,
  resolveActiveTab,
  trackContentTabs,
} from "../services/jobFlow";
import { MessageType } from "../types/messages";
import type { ActiveTabResponse, ExtensionMessage } from "../types/messages";

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
