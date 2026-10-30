import { canonicalize } from "../lib/canonicalUrl";
import {
  extractPage,
  deriveJsonLdFields,
  MAIN_TEXT_CAP,
  MIN_TEXT_CHARS,
} from "../lib/pageExtractor";
import type { RawPageExtract } from "../lib/pageExtractor";
import { pasteIdentity } from "../../shared/pasteIdentity";
import { boundViolation } from "../lib/textBounds";
import { postJobAnalysis } from "./jobAnalysisClient";
import { jobStorage } from "./jobStorage";
import { learnedSelectors } from "./learnedSelectors";
import { getCached, setCached } from "./jobAnalysisCache";
import { getProfile, profileToPromptText, toScoringProfile } from "./profileStorage";
import type { JobAnalysisRequest } from "./jobAnalysisClient";
import { MessageType } from "../types/messages";
import type {
  AnalyzeJobPageMessage,
  AnalyzePastedTextMessage,
  AnalyzeScopedRegionMessage,
  CancelAnalysisMessage,
  ExtensionMessage,
  ProfileFreshnessFields,
  RescoreJobPageMessage,
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
 * The profile as one analysis flow sees it. A profile that cannot be fetched
 * must not fail the analysis (the fit is simply not scored), but the panel has
 * to be able to say why, so the failure travels with the result (spec edge
 * case "Profile fetch fails at analysis time").
 */
interface LoadedProfile {
  profile: CandidateProfile | null;
  unavailable: boolean;
}

async function loadProfile(): Promise<LoadedProfile> {
  try {
    return { profile: await getProfile(), unavailable: false };
  } catch {
    return { profile: null, unavailable: true };
  }
}

/** FR-001: the structured profile and its serialized form, sent together. */
function profileRequestFields(
  loaded: LoadedProfile
): Pick<JobAnalysisRequest, "profile" | "profileData"> {
  if (!loaded.profile) return {};
  const profileData = toScoringProfile(loaded.profile);
  return { profileData, profile: profileToPromptText(profileData) };
}

/**
 * Freshness fields for a broadcast. Stored results never trigger a request
 * (R7), so the current fingerprint is all the panel needs to mark them.
 */
function freshnessFields(loaded: LoadedProfile): ProfileFreshnessFields {
  if (loaded.unavailable) return { profileUnavailable: true };
  return { currentProfileFingerprint: loaded.profile?.fingerprint ?? null };
}

/** Marks a saved posting as gone (FR-005); the stored analysis stays as it was. */
async function markUnavailable(stored: {
  saved: SavedJob | null;
}, canonicalUrl: string): Promise<SavedJob | null> {
  if (!stored.saved) return null;
  try {
    await jobStorage.update(canonicalUrl, {
      unavailableAt: new Date().toISOString(),
    });
    return await jobStorage.get(canonicalUrl);
  } catch {
    return stored.saved;
  }
}

/**
 * Per-tab cancellation generation (spec FR-006, FR-006b).
 *
 * Extraction now spends up to 6 s waiting for the page inside the injected
 * function, and that wait cannot be interrupted from here — the loop lives in
 * the page's isolated world. What we can guarantee is the part the user cares
 * about: a cancelled attempt sends no analysis request, spends no allowance,
 * and broadcasts nothing. The abandoned injection resolves into a generation
 * check that discards it; its observer is disconnected as it returns, so it
 * holds nothing open.
 *
 * A counter rather than a boolean because of FR-006b: cancel, then immediately
 * re-analyze. A flag would have to be cleared by the next request and would
 * race with the abandoned one; a generation makes the stale result identifiable
 * no matter when it lands.
 */
const cancelGenerations = new Map<number, number>();

/** Panel → background: abandon whatever is in flight for this tab. */
export function cancelAnalysis(message: CancelAnalysisMessage): void {
  cancelGenerations.set(message.tabId, (cancelGenerations.get(message.tabId) ?? 0) + 1);
}

/** Panel → background: Rescore. The page flow with the cache bypassed and the rescore intent. */
export function rescoreJobPage(
  message: RescoreJobPageMessage,
  broadcast: (m: ExtensionMessage) => void
): Promise<void> {
  return analyzeJobPage(
    { type: MessageType.ANALYZE_JOB_PAGE, tabId: message.tabId, bypassCache: true },
    broadcast,
    { priorFingerprint: message.priorFingerprint }
  );
}

export async function analyzeJobPage(
  message: AnalyzeJobPageMessage,
  broadcast: (m: ExtensionMessage) => void,
  rescore?: { priorFingerprint: string | null }
): Promise<void> {
  const generation = cancelGenerations.get(message.tabId) ?? 0;
  const cancelled = (): boolean => (cancelGenerations.get(message.tabId) ?? 0) !== generation;

  let raw: RawPageExtract | undefined;
  if (!message.cachedOnly) {
    // The learned selector must be resolved from storage and handed to
    // extractPage as an argument — the injected function is serialized and
    // can neither read chrome.storage itself nor import learnedSelectors.ts
    // (plan.md Constraints). A host we can't resolve ahead of extraction
    // (permission not yet granted, tab already gone) just means no learned
    // selector is tried — never a hard failure.
    let learnedSelector: string | undefined;
    try {
      const tab = await chrome.tabs.get(message.tabId);
      if (tab.url) {
        const learned = await learnedSelectors.get(new URL(tab.url).hostname);
        learnedSelector = learned?.selector;
      }
    } catch {
      learnedSelector = undefined;
    }

    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: message.tabId },
        func: extractPage,
        args: [{ learnedSelector }],
      });
      raw = injection?.result as RawPageExtract | undefined;
    } catch {
      raw = undefined;
    }
  }

  // The readiness wait is the window a cancel most plausibly lands in.
  if (cancelled()) return;

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
              ...freshnessFields(await loadProfile()),
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

  // Both storage writes live here, never inside the injected function
  // (plan.md Constraints); recordMiss fires once per extraction, never per
  // readiness attempt — calling it per attempt would retire a learned
  // selector on a slow SPA within two page loads (FR-029, contracts
  // "Interaction with readiness").
  try {
    const host = new URL(raw.url).hostname;
    if (raw.provenance?.strategy === "learned-selector") {
      void learnedSelectors.touch(host);
    } else if (raw.provenance?.learnedSelectorMissed) {
      void learnedSelectors.recordMiss(host);
    }
  } catch {
    // Malformed URL — nothing to record against.
  }

  // Thin content now keys on body text alone. Structured data no longer
  // rescues a page from this check: JSON-LD with an empty body was the silent
  // degradation 3/6 corpus fixtures took — the model received structured
  // fields and no posting, and the user was never told (spec FR-004a).
  //
  // Since extraction only returns early once text clears the minimum, text
  // below it means the readiness budget expired. The two messages describe two
  // genuinely different situations and suggest different next actions
  // (contracts/extraction-payload.md §3); the code and retryability are
  // unchanged, so JobErrorCode does not grow.
  if (extract.mainText.length < MIN_TEXT_CHARS) {
    // FR-005: a saved posting whose page has gone thin is shown from the
    // library. Only an explicit Rescore marks it unavailable; a plain revisit
    // just serves it.
    try {
      const stored = await lookupStored(canonicalUrl);
      if (stored) {
        const saved = rescore
          ? await markUnavailable(stored, canonicalUrl)
          : stored.saved;
        broadcast({
          type: MessageType.JOB_ANALYSIS_RESULT,
          analysis: stored.analysis,
          canonicalUrl,
          sourceUrl: raw.url,
          multiplePostings: false,
          cached: true,
          saved,
          postingUnavailable: Boolean(rescore),
          ...freshnessFields(await loadProfile()),
        });
        return;
      }
    } catch {
      // Storage unreachable — report the thin content itself.
    }
    const stillLoading = extract.provenance?.budgetExpired === true;
    broadcast({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: {
        code: "thin-content",
        message: stillLoading
          ? "The page was still loading when we tried to read it."
          : "Not enough page content to analyze.",
        action: stillLoading
          ? "Wait for the page to finish loading, then re-analyze."
          : "Open the full job posting page, then re-analyze.",
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
      if (stored) {
        broadcast({
          type: MessageType.JOB_ANALYSIS_RESULT,
          analysis: stored.analysis,
          canonicalUrl,
          sourceUrl: raw.url,
          multiplePostings: extract.jsonLd.length > 1,
          cached: true,
          saved: stored.saved,
          strategy: raw.provenance?.strategy,
          ...freshnessFields(await loadProfile()),
        });
        return;
      }
    } catch {
      // Storage unreachable — fall through to a fresh analysis.
    }
  }

  // A failed rescore keeps the stored analysis on screen, marked out of date.
  const stored = rescore ? await lookupStored(canonicalUrl).catch(() => null) : null;
  const loaded = await loadProfile();
  try {
    // Last check before the request: this is the line FR-006 is about — a
    // cancelled analysis must not spend the user's monthly allowance.
    if (cancelled()) return;

    const { analysis, postingUnavailable } = await postJobAnalysis({
      extract,
      ...profileRequestFields(loaded),
      assumeJobPosting: message.assumeJobPosting,
      ...(rescore ? { rescore } : {}),
    });

    if (postingUnavailable && stored) {
      // The page no longer reads as a posting: keep the score we have.
      const saved = await markUnavailable(stored, canonicalUrl);
      broadcast({
        type: MessageType.JOB_ANALYSIS_RESULT,
        analysis: stored.analysis,
        canonicalUrl,
        sourceUrl: raw.url,
        multiplePostings: false,
        cached: true,
        saved,
        postingUnavailable: true,
        ...freshnessFields(loaded),
      });
      return;
    }

    await setCached(canonicalUrl, analysis);

    // A fresh analysis of an already-saved posting replaces its snapshot
    // (status/notes survive) — explicit Re-analyze and Rescore both land here.
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
      strategy: raw.provenance?.strategy,
      ...freshnessFields(loaded),
    });
  } catch (err) {
    if (stored) {
      broadcast({
        type: MessageType.JOB_ANALYSIS_RESULT,
        analysis: stored.analysis,
        canonicalUrl,
        sourceUrl: raw.url,
        multiplePostings: false,
        cached: true,
        saved: stored.saved,
        rescoreError: toJobPanelError(err),
        ...freshnessFields(loaded),
      });
      return;
    }
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

/**
 * Story 3 — the unconditional escape hatch. Skips extraction entirely: the
 * text came from the user, not a page. Validated against the same bounds as
 * page text (FR-018) and reported before any request is sent, so a below-
 * minimum or above-cap paste never touches the allowance. Identified by a
 * content-derived `paste:<sha256>` (FR-021), not a page URL — repeat pastes
 * of the same text resolve to the same identity, so this goes through the
 * same saved-library/session-cache lookup as a page analysis (FR-019).
 */
export async function analyzePastedText(
  message: AnalyzePastedTextMessage,
  broadcast: (m: ExtensionMessage) => void
): Promise<void> {
  const violation = boundViolation(
    message.text.length,
    MIN_TEXT_CHARS,
    MAIN_TEXT_CAP,
    "Paste more of the posting before analyzing.",
    "Trim it to the posting itself before analyzing."
  );
  if (violation) {
    broadcast({
      type: MessageType.PASTE_ANALYSIS_ERROR,
      error: {
        code: "thin-content",
        message: violation.message,
        action: violation.action,
        retryable: false,
      },
    });
    return;
  }

  const canonicalUrl = await pasteIdentity(message.text);

  let stored: Awaited<ReturnType<typeof lookupStored>> = null;
  try {
    stored = await lookupStored(canonicalUrl);
    if (stored && !message.rescore) {
      broadcast({
        type: MessageType.PASTE_ANALYSIS_RESULT,
        analysis: stored.analysis,
        canonicalUrl,
        saved: stored.saved,
        strategy: "paste",
        ...freshnessFields(await loadProfile()),
      });
      return;
    }
  } catch {
    // Storage unreachable — fall through to a fresh analysis.
  }

  const extract: PageExtract = {
    url: canonicalUrl,
    canonicalUrl,
    title: "",
    jsonLd: [],
    mainText: message.text.slice(0, MAIN_TEXT_CAP),
    extractedAt: new Date().toISOString(),
  };

  const loaded = await loadProfile();
  try {
    const { analysis } = await postJobAnalysis({
      extract,
      ...profileRequestFields(loaded),
      assumeJobPosting: message.assumeJobPosting,
      ...(message.rescore ? { rescore: message.rescore } : {}),
    });
    await setCached(canonicalUrl, analysis);

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
      type: MessageType.PASTE_ANALYSIS_RESULT,
      analysis,
      canonicalUrl,
      saved,
      strategy: "paste",
      ...freshnessFields(loaded),
    });
  } catch (err) {
    if (stored && message.rescore) {
      broadcast({
        type: MessageType.PASTE_ANALYSIS_RESULT,
        analysis: stored.analysis,
        canonicalUrl,
        saved: stored.saved,
        strategy: "paste",
        rescoreError: toJobPanelError(err),
        ...freshnessFields(loaded),
      });
      return;
    }
    broadcast({
      type: MessageType.PASTE_ANALYSIS_ERROR,
      error: toJobPanelError(err),
    });
  }
}

/**
 * Story 4 — a hand-scoped region (picker or selection, FR-023c) re-runs the
 * analysis of the CURRENT page, identified by its canonical URL, never a
 * synthetic identity (FR-026). This is a separate path from
 * `analyzeJobPage`'s lookup order specifically so it can never call
 * `lookupStored`: FR-026a requires bypassing the saved-library/session-cache
 * lookup entirely, or a scoped correction on a page that already has a
 * stored analysis would silently return that stale result and the user's
 * correction would appear to do nothing (plan.md Risks — the cache-bypass
 * trap).
 */
export async function analyzeScopedRegion(
  message: AnalyzeScopedRegionMessage,
  broadcast: (m: ExtensionMessage) => void
): Promise<void> {
  let tabUrl: string;
  try {
    const tab = await chrome.tabs.get(message.tabId);
    if (!tab.url) throw new Error("no readable url");
    tabUrl = tab.url;
  } catch {
    broadcast({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: {
        code: "no-access",
        message: "The extension doesn't have permission to read this page.",
        action:
          "Click the extension icon in the Chrome toolbar to grant access and re-run the analysis.",
        retryable: false,
      },
      fallback: null,
      canonicalUrl: null,
      sourceUrl: null,
    });
    return;
  }

  const canonicalUrl = canonicalize(tabUrl);

  // FR-034: refused with the same wording/number as the paste-side refusal
  // (FR-018a) — a bound violation is one rule, not two.
  const violation = boundViolation(
    message.text.length,
    MIN_TEXT_CHARS,
    MAIN_TEXT_CAP,
    "Pick or select a larger part of the page.",
    "Pick or select a smaller part of the page."
  );
  if (violation) {
    broadcast({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: {
        code: "thin-content",
        message: violation.message,
        action: violation.action,
        retryable: true,
      },
      fallback: null,
      canonicalUrl,
      sourceUrl: tabUrl,
    });
    return;
  }

  const extract: PageExtract = {
    url: tabUrl,
    canonicalUrl,
    title: "",
    jsonLd: [],
    mainText: message.text.slice(0, MAIN_TEXT_CAP),
    extractedAt: new Date().toISOString(),
  };

  const loaded = await loadProfile();
  try {
    const { analysis } = await postJobAnalysis({
      extract,
      ...profileRequestFields(loaded),
      assumeJobPosting: message.assumeJobPosting,
    });
    await setCached(canonicalUrl, analysis);

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

    let host: string | undefined;
    try {
      host = new URL(tabUrl).hostname;
    } catch {
      host = undefined;
    }

    broadcast({
      type: MessageType.JOB_ANALYSIS_RESULT,
      analysis,
      canonicalUrl,
      sourceUrl: tabUrl,
      multiplePostings: false,
      cached: false,
      saved,
      strategy: message.mechanism,
      scopedRegion: host ? { selector: message.selector, host } : undefined,
      ...freshnessFields(loaded),
    });
  } catch (err) {
    broadcast({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: toJobPanelError(err),
      fallback: null,
      canonicalUrl,
      sourceUrl: tabUrl,
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
      usage?: JobPanelError["usage"];
    };
    // Rebuild as a plain object: on an Error subclass (e.g. ApiError),
    // `message` is non-enumerable and would be dropped by the JSON
    // serialization in chrome.runtime.sendMessage, leaving a blank error box.
    return {
      code: API_ERROR_CODES[e.code] ?? (e.code as JobErrorCode),
      message: e.message,
      action: e.action ?? "Try again.",
      retryable: e.retryable,
      ...(e.usage ? { usage: e.usage } : {}),
    };
  }
  return {
    code: "unknown",
    message: "An unexpected error occurred.",
    action: "Try again.",
    retryable: true,
  };
}
