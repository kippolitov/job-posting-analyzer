import { canonicalize } from "../lib/canonicalUrl";
import {
  extractPage,
  deriveJsonLdFields,
  MIN_TEXT_CHARS,
} from "../lib/pageExtractor";
import type { RawPageExtract } from "../lib/pageExtractor";
import { postJobAnalysis } from "./jobAnalysisClient";
import { jobStorage } from "./jobStorage";
import { getCached, setCached } from "./jobAnalysisCache";
import { getProfile, profileToPromptText } from "./profileStorage";
import { MessageType } from "../types/messages";
import type {
  AnalyzeJobPageMessage,
  ExtensionMessage,
} from "../types/messages";
import type { JobPanelError, PageExtract } from "../types/job";

/**
 * Most-recently-active candidate content tabs, newest first. Only ids are
 * kept: URLs observed at track time go stale (and a brand-new tab is briefly
 * an unreadable about:blank), so candidates are re-validated with a fresh
 * lookup at resolve time instead.
 */
const MAX_TRACKED_TABS = 5;
let recentContentTabs: number[] = [];

/**
 * Tracks recent non-extension tabs so the panel's target can be resolved even
 * when the panel page itself is the active tab (e.g. sidepanel.html opened in
 * a tab).
 *
 * When `broadcast` is provided, tab switches and navigations are announced as
 * ACTIVE_TAB_CHANGED so an already-open panel can follow the active tab —
 * navigation revokes the activeTab grant, so whatever the panel was showing is
 * stale the moment it happens.
 */
export function trackContentTabs(
  broadcast?: (message: ExtensionMessage) => void
): void {
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void rememberTab(tabId, broadcast);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab.active) return;
    // Only navigation signals warrant a broadcast: "loading" fires once per
    // page load even on hosts whose URL we cannot read; `url` covers SPA
    // history updates on readable hosts.
    const navigated =
      changeInfo.status === "loading" || changeInfo.url !== undefined;
    void rememberTab(tabId, navigated ? broadcast : undefined);
  });
}

async function rememberTab(
  tabId: number,
  broadcast?: (message: ExtensionMessage) => void
): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith("chrome-extension://") || tab.url === "about:blank")
      return;
    recentContentTabs = [
      tabId,
      ...recentContentTabs.filter((id) => id !== tabId),
    ].slice(0, MAX_TRACKED_TABS);
    broadcast?.({
      type: MessageType.ACTIVE_TAB_CHANGED,
      tabId,
      trigger: "navigation",
    });
  } catch {
    // Tab may already be gone.
  }
}

/**
 * Toolbar-icon click: the only moment an activeTab grant (and thus a readable
 * URL on any site) is guaranteed to exist. Opening the side panel via
 * setPanelBehavior does NOT grant activeTab — Chrome deliberately withholds
 * it (crbug.com/40926394) — which is why the background listens to
 * action.onClicked and opens the panel itself.
 */
export function handleActionClick(
  tab: chrome.tabs.Tab,
  broadcast: (message: ExtensionMessage) => void
): void {
  if (tab.id === undefined) return;
  recentContentTabs = [
    tab.id,
    ...recentContentTabs.filter((id) => id !== tab.id),
  ].slice(0, MAX_TRACKED_TABS);
  broadcast({
    type: MessageType.ACTIVE_TAB_CHANGED,
    tabId: tab.id,
    trigger: "action-click",
  });
}

/**
 * Resolves which tab the panel should target.
 *
 * `excludeTabId` is the panel page's own tab when it runs as a regular tab
 * (from `sender.tab`). Extension-page URLs are NOT readable without the
 * "tabs" permission, so the id — not the URL — is what prevents the panel
 * from resolving to (and then analyzing) itself.
 */
export async function resolveActiveTab(
  excludeTabId: number | null = null
): Promise<{ tabId: number | null }> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    tab = undefined;
  }

  if (
    !tab ||
    tab.id === excludeTabId ||
    tab.url?.startsWith("chrome-extension://")
  ) {
    // Walk the tracked candidates newest-first, re-validating each: a tab
    // tracked while it was still about:blank may have since become the panel
    // page itself, and any candidate may have been closed.
    for (const tabId of recentContentTabs) {
      if (tabId === excludeTabId) continue;
      try {
        const fresh = await chrome.tabs.get(tabId);
        if (fresh.url?.startsWith("chrome-extension://")) continue;
        return { tabId };
      } catch {
        // Tab closed since it was tracked.
      }
    }
    return { tabId: null };
  }
  return { tabId: tab.id ?? null };
}

export async function analyzeJobPage(
  message: AnalyzeJobPageMessage,
  broadcast: (m: ExtensionMessage) => void
): Promise<void> {
  let raw: RawPageExtract | undefined;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      func: extractPage,
    });
    raw = injection?.result as RawPageExtract | undefined;
  } catch {
    raw = undefined;
  }

  if (!raw) {
    // executeScript failed: the activeTab grant is missing (it only exists
    // after a toolbar-icon click and dies on navigation) or the page is one
    // Chrome never allows extensions to read (chrome://, Web Store).
    broadcast({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: {
        code: "no-access",
        message: "The extension doesn't have permission to read this page.",
        action:
          "Click the extension icon in the Chrome toolbar to grant access " +
          "and re-run the analysis. Chrome's own pages and the Web Store " +
          "can't be analyzed.",
        retryable: false,
      },
      fallback: null,
      canonicalUrl: null,
      sourceUrl: null,
    });
    return;
  }

  const canonicalUrl = canonicalize(raw.url);
  const extract: PageExtract = { ...raw, canonicalUrl };

  if (extract.jsonLd.length === 0 && extract.mainText.length < MIN_TEXT_CHARS) {
    broadcast({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: {
        code: "thin-content",
        message: "Not enough page content to analyze.",
        action: "Open the full job posting page, then re-analyze.",
        retryable: true,
      },
      fallback: null,
      canonicalUrl,
      sourceUrl: raw.url,
    });
    return;
  }

  // FR-011/FR-012 lookup order: saved library → session cache → backend.
  if (!message.bypassCache) {
    const saved = await jobStorage.get(canonicalUrl);
    if (saved) {
      broadcast({
        type: MessageType.JOB_ANALYSIS_RESULT,
        analysis: saved.analysis,
        canonicalUrl,
        sourceUrl: raw.url,
        multiplePostings: extract.jsonLd.length > 1,
        cached: true,
        saved,
      });
      return;
    }

    const cached = await getCached(canonicalUrl);
    if (cached) {
      broadcast({
        type: MessageType.JOB_ANALYSIS_RESULT,
        analysis: cached,
        canonicalUrl,
        sourceUrl: raw.url,
        multiplePostings: extract.jsonLd.length > 1,
        cached: true,
        saved: null,
      });
      return;
    }
  }

  try {
    // FR-007: the profile leaves the browser only inside analysis requests.
    const profile = await getProfile();
    const analysis = await postJobAnalysis({
      extract,
      profile: profile ? profileToPromptText(profile) : undefined,
      assumeJobPosting: message.assumeJobPosting,
    });
    await setCached(canonicalUrl, analysis);

    // Re-analysis of a saved posting replaces its snapshot (status/notes survive).
    let saved = null;
    if (message.bypassCache) {
      const existing = await jobStorage.get(canonicalUrl);
      if (existing) {
        await jobStorage.update(canonicalUrl, { analysis });
        saved = await jobStorage.get(canonicalUrl);
      }
    }

    broadcast({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis,
      canonicalUrl,
      sourceUrl: raw.url,
      multiplePostings: extract.jsonLd.length > 1,
      cached: false,
      saved,
    });
  } catch (err) {
    broadcast({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: toJobPanelError(err),
      fallback:
        extract.jsonLd.length > 0 ? deriveJsonLdFields(extract.jsonLd) : null,
      canonicalUrl,
      sourceUrl: raw.url,
    });
  }
}

function toJobPanelError(err: unknown): JobPanelError {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err &&
    "retryable" in err
  ) {
    return err as JobPanelError;
  }
  return {
    code: "unknown",
    message: "An unexpected error occurred.",
    action: "Try again.",
    retryable: true,
  };
}
