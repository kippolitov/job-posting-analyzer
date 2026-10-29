import type { ExtractionStrategy, JobAnalysis, JobPanelError, SavedJob } from "./job";

export const MessageType = {
  GET_ACTIVE_TAB: "GET_ACTIVE_TAB",
  ACTIVE_TAB_CHANGED: "ACTIVE_TAB_CHANGED",
  ANALYZE_JOB_PAGE: "ANALYZE_JOB_PAGE",
  CANCEL_ANALYSIS: "CANCEL_ANALYSIS",
  JOB_ANALYSIS_RESULT: "JOB_ANALYSIS_RESULT",
  JOB_ANALYSIS_ERROR: "JOB_ANALYSIS_ERROR",
  ANALYZE_PASTED_TEXT: "ANALYZE_PASTED_TEXT",
  PASTE_ANALYSIS_RESULT: "PASTE_ANALYSIS_RESULT",
  PASTE_ANALYSIS_ERROR: "PASTE_ANALYSIS_ERROR",
  ANALYZE_SCOPED_REGION: "ANALYZE_SCOPED_REGION",
  RESCORE_JOB_PAGE: "RESCORE_JOB_PAGE",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface GetActiveTabMessage {
  type: typeof MessageType.GET_ACTIVE_TAB;
}

export interface ActiveTabResponse {
  tabId: number | null;
}

/**
 * Broadcast by the background when the panel's target tab may have changed.
 *
 * trigger "navigation": the active tab navigated — any prior activeTab grant
 * is dead, so the panel must drop stale state.
 * trigger "tab-switch": the user switched tabs — the grant is dead too, but
 * the revisited tab's analysis may still be in the library/cache, so the
 * panel should probe for it (cachedOnly) instead of just going idle.
 * trigger "action-click": the user clicked the toolbar icon — a fresh
 * activeTab grant exists right now, so an open panel should (re-)analyze.
 */
export interface ActiveTabChangedMessage {
  type: typeof MessageType.ACTIVE_TAB_CHANGED;
  tabId: number | null;
  trigger: "navigation" | "tab-switch" | "action-click";
}

export interface AnalyzeJobPageMessage {
  type: typeof MessageType.ANALYZE_JOB_PAGE;
  tabId: number;
  assumeJobPosting?: boolean;
  bypassCache?: boolean;
  /**
   * Silent probe: answer only from the saved library / session cache via the
   * tab's remembered URL — never touch the page, never broadcast an error.
   */
  cachedOnly?: boolean;
}

/**
 * Panel → background: re-run the analysis of the page against the current
 * profile (006 FR-004). `priorFingerprint` is the fingerprint of the fit the
 * panel is showing, which the server uses to decide the charge.
 */
export interface RescoreJobPageMessage {
  type: typeof MessageType.RESCORE_JOB_PAGE;
  tabId: number;
  priorFingerprint: string | null;
}

/**
 * Fields every result broadcast carries so the panel can mark freshness
 * without a second round trip (006 R7).
 */
export interface ProfileFreshnessFields {
  /** `undefined` = unknown, `null` = the account has no profile. */
  currentProfileFingerprint?: string | null;
  /** The profile could not be fetched, so the fit was not scored. */
  profileUnavailable?: true;
  /** The posting was gone when a rescore or revisit looked (FR-005). */
  postingUnavailable?: boolean;
  /** A rescore failed; `analysis` is the stored one, still out of date. */
  rescoreError?: JobPanelError;
}

/**
 * Panel → background: abandon the in-flight analysis for this tab.
 *
 * Until readiness, cancelling was purely cosmetic — the panel ignored the late
 * result via cancelledRef while the background still sent the analysis request
 * and spent the user's allowance. With up to 6 s of readiness waiting ahead of
 * the model call there is now a real window to cancel inside, so the request
 * must actually not be sent (spec FR-006).
 */
export interface CancelAnalysisMessage {
  type: typeof MessageType.CANCEL_ANALYSIS;
  tabId: number;
}

/**
 * Panel → background: re-run the analysis against a hand-scoped region — a
 * picked node (T070) or a text selection's common ancestor (T071), which
 * FR-023c requires to feed the same path. `mechanism` becomes
 * `provenance.strategy` ("picked" | "selection") so the eval harness and the
 * always-analyze offer can tell a correction from an already-learned host
 * (spec FR-026, FR-032).
 */
export interface AnalyzeScopedRegionMessage {
  type: typeof MessageType.ANALYZE_SCOPED_REGION;
  tabId: number;
  text: string;
  selector: string;
  mechanism: "picked" | "selection";
  assumeJobPosting?: boolean;
}

export interface JobAnalysisResultMessage extends ProfileFreshnessFields {
  type: typeof MessageType.JOB_ANALYSIS_RESULT;
  analysis: JobAnalysis;
  canonicalUrl: string;
  sourceUrl: string;
  multiplePostings: boolean;
  cached: boolean;
  saved: SavedJob | null;
  /** How this result was produced (spec FR-035) — drives the learned-region badge (FR-032). */
  strategy?: ExtractionStrategy;
  /**
   * Present when `strategy` is "picked" or "selection" — offers "Always
   * analyze this region on <site>" (spec FR-026b). Absent otherwise, and
   * absent again on the NEXT analysis of this page even if declined, since
   * declining teaches nothing and the offer is per-correction, not per-page.
   */
  scopedRegion?: { selector: string; host: string };
}

export interface JobAnalysisErrorMessage {
  type: typeof MessageType.JOB_ANALYSIS_ERROR;
  error: JobPanelError;
  fallback: Partial<JobAnalysis> | null;
  canonicalUrl: string | null;
  sourceUrl: string | null;
}

/**
 * Panel → background: analyze pasted text (spec FR-017/FR-019). No tabId —
 * paste is independent of any page — and no cachedOnly, since a fresh paste
 * has nothing stored yet by definition until FR-021's dedupe key is computed.
 */
export interface AnalyzePastedTextMessage {
  type: typeof MessageType.ANALYZE_PASTED_TEXT;
  text: string;
  assumeJobPosting?: boolean;
  /** "Paste again to rescore": bypass the stored lookup and send the rescore intent. */
  rescore?: { priorFingerprint: string | null };
}

/**
 * Paste gets its own result/error message types rather than reusing
 * JOB_ANALYSIS_RESULT/ERROR: those are already claimed by the "This Page"
 * view's state machine, and a paste analysis must land in the composer, not
 * silently overwrite whatever "This Page" was showing.
 */
export interface PasteAnalysisResultMessage extends ProfileFreshnessFields {
  type: typeof MessageType.PASTE_ANALYSIS_RESULT;
  analysis: JobAnalysis;
  canonicalUrl: string;
  saved: SavedJob | null;
  /** Always "paste" — carried for FR-035 (every extraction result records its strategy), not consumed by any UI branch. */
  strategy: "paste";
}

export interface PasteAnalysisErrorMessage {
  type: typeof MessageType.PASTE_ANALYSIS_ERROR;
  error: JobPanelError;
}

export type ExtensionMessage =
  | GetActiveTabMessage
  | ActiveTabChangedMessage
  | AnalyzeJobPageMessage
  | CancelAnalysisMessage
  | RescoreJobPageMessage
  | JobAnalysisResultMessage
  | JobAnalysisErrorMessage
  | AnalyzePastedTextMessage
  | PasteAnalysisResultMessage
  | PasteAnalysisErrorMessage
  | AnalyzeScopedRegionMessage;
