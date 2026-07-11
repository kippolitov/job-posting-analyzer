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
import type {
  CandidateProfile,
  JobAnalysis,
  JobErrorCode,
  JobPanelError,
  PageExtract,
  SavedJob,
} from "../types/job";

/**
 * Most-recently-active candidate content tabs, newest first. Only ids are
 * kept: URLs observed at track time go stale (and a brand-new tab is briefly
 * an unreadable about:blank), so candidates are re-validated with a fresh
 * lookup at resolve time instead.
 */
const MAX_TRACKED_TABS = 5;
let recentContentTabs: number[] = [];

/**
 * Last successfully extracted URL per tab, kept in session storage so it
 * survives service-worker restarts. The activeTab grant dies on every tab
 * switch, but a revisited tab's analysis is usually still in the saved
 * library or session cache — this URL is what lets it be served without any
 * page access. Cleared when the tab navigates or closes.
 */
function tabUrlKey(tabId: number): string {
  return `taburl:${tabId}`;
}

async function rememberTabUrl(tabId: number, url: string): Promise<void> {
  try {
    await chrome.storage.session.set({ [tabUrlKey(tabId)]: url });
  } catch {
    // Session storage unavailable; revisits will need a toolbar click.
  }
}

async function recallTabUrl(tabId: number): Promise<string | null> {
  try {
    const key = tabUrlKey(tabId);
    const data = await chrome.storage.session.get(key);
    return typeof data[key] === "string" ? (data[key] as string) : null;
  } catch {
    return null;
  }
}

async function forgetTabUrl(tabId: number): Promise<void> {
  try {
    await chrome.storage.session.remove(tabUrlKey(tabId));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

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
    void rememberTab(tabId, broadcast, "tab-switch");
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only navigation signals matter: "loading" fires once per page load even
    // on hosts whose URL we cannot read; `url` covers SPA history updates on
    // readable hosts.
    const navigated =
      changeInfo.status === "loading" || changeInfo.url !== undefined;
    // A navigation invalidates the tab's remembered URL even in a background
    // tab — whatever was analyzed there no longer describes the page.
    if (navigated) void forgetTabUrl(tabId);
    if (!tab.active) return;
    void rememberTab(tabId, navigated ? broadcast : undefined, "navigation");
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void forgetTabUrl(tabId);
  });
}

async function rememberTab(
  tabId: number,
  broadcast: ((message: ExtensionMessage) => void) | undefined,
  trigger: "navigation" | "tab-switch"
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
      trigger,
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

/** FR-011/FR-012 stored-result lookup: saved library first, then session cache. */
async function lookupStored(
  canonicalUrl: string
): Promise<{ analysis: JobAnalysis; saved: SavedJob | null } | null> {
  const saved = await jobStorage.get(canonicalUrl);
  if (saved) return { analysis: saved.analysis, saved };
  const cached = await getCached(canonicalUrl);
  if (cached) return { analysis: cached, saved: null };
  return null;
}

/**
 * A stored analysis is fit-stale when recomputing is the only way the current
 * fit UI ever appears — the default lookup never reaches the backend again:
 * - fit is null but the profile was created/updated after the analysis ran;
 * - fit predates the breakdown fields (matching/missing/…), a one-time
 *   upgrade per stored analysis (fresh results always carry the breakdown,
 *   so this cannot loop).
 */
async function needsFitRefresh(analysis: JobAnalysis): Promise<boolean> {
  if (analysis.fit && analysis.fit.matching !== undefined) return false;
  try {
    const profile = await getProfile();
    if (profile === null) return false;
    if (analysis.fit) return true;
    return Date.parse(analysis.analyzedAt) < Date.parse(profile.updatedAt);
  } catch {
    // Can't tell — serve the stored copy rather than fail the revisit.
    return false;
  }
}

export async function analyzeJobPage(
  message: AnalyzeJobPageMessage,
  broadcast: (m: ExtensionMessage) => void
): Promise<void> {
  let raw: RawPageExtract | undefined;
  if (!message.cachedOnly) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: message.tabId },
        func: extractPage,
      });
      raw = injection?.result as RawPageExtract | undefined;
    } catch {
      raw = undefined;
    }
  }

  if (!raw) {
    // No page access: either this is a cachedOnly probe, or executeScript
    // failed because the activeTab grant is missing (it only exists after a
    // toolbar-icon click and dies on navigation) or the page is one Chrome
    // never allows extensions to read (chrome://, Web Store). A revisited tab
    // can still be served from the library/cache via its remembered URL.
    if (!message.bypassCache) {
      const rememberedUrl = await recallTabUrl(message.tabId);
      if (rememberedUrl) {
        const canonicalUrl = canonicalize(rememberedUrl);
        try {
          const stored = await lookupStored(canonicalUrl);
          if (stored) {
            broadcast({
              type: MessageType.JOB_ANALYSIS_RESULT,
              analysis: stored.analysis,
              canonicalUrl,
              sourceUrl: rememberedUrl,
              multiplePostings: false,
              cached: true,
              saved: stored.saved,
            });
            return;
          }
        } catch {
          // Storage unreachable — fall through to the error (or silence).
        }
      }
    }
    if (message.cachedOnly) return; // Silent probe: leave the panel as-is.
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
  void rememberTabUrl(message.tabId, raw.url);

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
    try {
      const stored = await lookupStored(canonicalUrl);
      if (stored && !(await needsFitRefresh(stored.analysis))) {
        broadcast({
          type: MessageType.JOB_ANALYSIS_RESULT,
          analysis: stored.analysis,
          canonicalUrl,
          sourceUrl: raw.url,
          multiplePostings: extract.jsonLd.length > 1,
          cached: true,
          saved: stored.saved,
        });
        return;
      }
    } catch {
      // Storage unreachable — fall through to a fresh analysis.
    }
  }

  try {
    // FR-007: the profile leaves the browser only inside analysis requests.
    // The profile is an enhancement: when it cannot be fetched, analyze
    // without it (fit stays null and refreshes on a later revisit) instead
    // of failing the whole analysis.
    let profile: CandidateProfile | null = null;
    try {
      profile = await getProfile();
    } catch {
      profile = null;
    }
    const analysis = await postJobAnalysis({
      extract,
      profile: profile ? profileToPromptText(profile) : undefined,
      assumeJobPosting: message.assumeJobPosting,
    });
    await setCached(canonicalUrl, analysis);

    // A fresh analysis of an already-saved posting replaces its snapshot
    // (status/notes survive) — explicit Re-analyze and the automatic fit
    // refresh both land here.
    let saved: SavedJob | null = null;
    try {
      const existing = await jobStorage.get(canonicalUrl);
      if (existing) {
        await jobStorage.update(canonicalUrl, { analysis });
        saved = await jobStorage.get(canonicalUrl);
      }
    } catch {
      // Library unreachable — still deliver the analysis itself.
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

/** ApiError codes (storage API) mapped onto the panel's error vocabulary. */
const API_ERROR_CODES: Record<string, JobErrorCode> = {
  NOT_CONFIGURED: "not-configured",
  NETWORK_ERROR: "network-error",
  UNAUTHENTICATED: "no-access",
  NOT_AUTHORIZED: "no-access",
  SERVICE_ERROR: "service-error",
};

function toJobPanelError(err: unknown): JobPanelError {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err &&
    "retryable" in err
  ) {
    const e = err as {
      code: string;
      message: string;
      retryable: boolean;
      action?: string;
    };
    // Rebuild as a plain object: on an Error subclass (e.g. ApiError),
    // `message` is non-enumerable and would be dropped by the JSON
    // serialization in chrome.runtime.sendMessage, leaving a blank error box.
    return {
      code: API_ERROR_CODES[e.code] ?? (e.code as JobErrorCode),
      message: e.message,
      action: e.action ?? "Try again.",
      retryable: e.retryable,
    };
  }
  return {
    code: "unknown",
    message: "An unexpected error occurred.",
    action: "Try again.",
    retryable: true,
  };
}
