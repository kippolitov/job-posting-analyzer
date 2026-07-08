import { useEffect, useState } from "react";
import { AuthGate } from "../../components/AuthGate";
import { JobPanel } from "../../components/JobPanel/JobPanel";
import { useTheme } from "../../hooks/useTheme";
import { MessageType } from "../../types/messages";
import type { ActiveTabResponse, ExtensionMessage } from "../../types/messages";

export function App() {
  const { preference, cycleTheme } = useTheme();
  // undefined = not yet resolved; JobPanel must not mount until this settles,
  // since its one-shot auto-analyze effect only ever fires on first mount.
  const [tabId, setTabId] = useState<number | null | undefined>(undefined);
  const [navigationId, setNavigationId] = useState(0);
  const [analyzeNonce, setAnalyzeNonce] = useState(0);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = (await chrome.runtime.sendMessage({
          type: MessageType.GET_ACTIVE_TAB,
        })) as ActiveTabResponse | undefined;
        if (mounted) {
          setTabId(response?.tabId ?? null);
        }
      } catch {
        // Background unavailable.
        if (mounted) setTabId(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.type === MessageType.ACTIVE_TAB_CHANGED) {
        setTabId(message.tabId);
        if (message.trigger === "action-click") {
          // Toolbar click: a fresh activeTab grant exists — (re-)analyze now.
          setAnalyzeNonce((n) => n + 1);
        } else {
          // Navigation or tab switch: any activeTab grant is gone, so
          // state from before is stale.
          setNavigationId((n) => n + 1);
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return (
    <main className="flex h-screen w-full flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-gray-200/70 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-indigo-500"
            aria-hidden="true"
          />
          <span className="truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
            Job Analyzer
          </span>
        </div>
        <button
          onClick={cycleTheme}
          title={`Theme: ${preference} — click to cycle`}
          aria-label={`Current theme: ${preference}. Click to change.`}
          className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          {preference === "light" && (
            /* Sun */
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          )}
          {preference === "dark" && (
            /* Moon */
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
          {preference === "system" && (
            /* Monitor / auto */
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          )}
        </button>
      </header>

      <AuthGate>
        {tabId !== undefined && (
          <JobPanel
            tabId={tabId}
            navigationId={navigationId}
            analyzeNonce={analyzeNonce}
          />
        )}
      </AuthGate>
    </main>
  );
}
