import { useEffect, useRef } from "react";
import { ACTION_HINT_PORT } from "../services/actionHint";
import type { ActionHintMessage } from "../services/actionHint";

/**
 * Marks the toolbar icon on `tabId` while the panel is asking for a click on
 * it; `null` clears the mark. Closing the panel clears it too (the port
 * disconnects).
 */
export function useActionHint(tabId: number | null): void {
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    try {
      portRef.current = chrome.runtime.connect?.({ name: ACTION_HINT_PORT }) ?? null;
    } catch {
      portRef.current = null;
    }
    return () => {
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, []);

  useEffect(() => {
    const message: ActionHintMessage = { tabId };
    try {
      portRef.current?.postMessage(message);
    } catch {
      // Background restarted and dropped the port — the badge is gone with it.
    }
  }, [tabId]);
}
