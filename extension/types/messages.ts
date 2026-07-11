import type { JobAnalysis, JobPanelError, SavedJob } from "./job";

export const MessageType = {
  GET_ACTIVE_TAB: "GET_ACTIVE_TAB",
  ACTIVE_TAB_CHANGED: "ACTIVE_TAB_CHANGED",
  ANALYZE_JOB_PAGE: "ANALYZE_JOB_PAGE",
  JOB_ANALYSIS_RESULT: "JOB_ANALYSIS_RESULT",
  JOB_ANALYSIS_ERROR: "JOB_ANALYSIS_ERROR",
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

export interface JobAnalysisResultMessage {
  type: typeof MessageType.JOB_ANALYSIS_RESULT;
  analysis: JobAnalysis;
  canonicalUrl: string;
  sourceUrl: string;
  multiplePostings: boolean;
  cached: boolean;
  saved: SavedJob | null;
}

export interface JobAnalysisErrorMessage {
  type: typeof MessageType.JOB_ANALYSIS_ERROR;
  error: JobPanelError;
  fallback: Partial<JobAnalysis> | null;
  canonicalUrl: string | null;
  sourceUrl: string | null;
}

export type ExtensionMessage =
  | GetActiveTabMessage
  | ActiveTabChangedMessage
  | AnalyzeJobPageMessage
  | JobAnalysisResultMessage
  | JobAnalysisErrorMessage;
