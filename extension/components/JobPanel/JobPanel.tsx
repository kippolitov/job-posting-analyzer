import { useCallback, useEffect, useRef, useState } from "react";
import { TabBar } from "../shared/TabBar";
import { ThisPageTab } from "./ThisPageTab";
import { SavedTab } from "./SavedTab";
import type { JobView } from "./ThisPageTab";
import { jobStorage } from "../../services/jobStorage";
import { MessageType } from "../../types/messages";
import type { ExtensionMessage } from "../../types/messages";
import type { SavedJob } from "../../types/job";

const TABS = [
  { id: "this-page", label: "This Page" },
  { id: "saved", label: "Saved" },
];

const INITIAL_VIEW: JobView = {
  status: "idle",
  analysis: null,
  error: null,
  fallback: null,
  canonicalUrl: null,
  sourceUrl: null,
  multiplePostings: false,
  cached: false,
  saved: null,
};

interface JobPanelProps {
  tabId: number | null;
  /**
   * Bumped by the background on every tab switch or navigation. Each bump
   * means the activeTab grant (and thus any shown analysis) is stale.
   */
  navigationId?: number;
  /**
   * Bumped on every toolbar-icon click, the gesture that grants activeTab.
   * Each bump is a cue to (re-)analyze while the grant is fresh.
   */
  analyzeNonce?: number;
}

export function JobPanel({
  tabId,
  navigationId = 0,
  analyzeNonce = 0,
}: JobPanelProps) {
  const [view, setView] = useState<JobView>(INITIAL_VIEW);
  const [activeTab, setActiveTab] = useState<string>("this-page");
  const [saveError, setSaveError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const viewStatusRef = useRef(view.status);
  viewStatusRef.current = view.status;

  const requestAnalysis = useCallback(
    (options: { assumeJobPosting?: boolean; bypassCache?: boolean } = {}) => {
      if (tabId === null) return;
      cancelledRef.current = false;
      setView((prev) => ({ ...prev, status: "analyzing", error: null }));
      void chrome.runtime.sendMessage({
        type: MessageType.ANALYZE_JOB_PAGE,
        tabId,
        assumeJobPosting: options.assumeJobPosting ?? false,
        bypassCache: options.bypassCache ?? false,
      });
    },
    [tabId]
  );

  // Auto-trigger once on panel open (spec assumption: auto-analysis with
  // cancel affordance). Only the panel-opening toolbar click carries an
  // activeTab grant; navigationId > 0 means a navigation or tab switch
  // happened since then, so an auto-attempt would fail by construction.
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoTriggeredRef.current) return;
    autoTriggeredRef.current = true;
    if (tabId !== null && navigationId === 0) {
      requestAnalysis();
    }
  }, [tabId, navigationId, requestAnalysis]);

  // On navigation/tab switch, drop back to idle: the shown analysis belongs
  // to the previous page, and FR-002 forbids auto-extraction without a user
  // action. Late results for the old page are ignored via cancelledRef.
  const navigationRef = useRef(navigationId);
  useEffect(() => {
    if (navigationId === navigationRef.current) return;
    navigationRef.current = navigationId;
    cancelledRef.current = true;
    setView(INITIAL_VIEW);
  }, [navigationId]);

  // Toolbar-icon click while the panel is open: analyze under the fresh
  // activeTab grant. Skipped mid-analysis — when the same click both opened
  // the panel and bumped the nonce, the mount effect already fired.
  const analyzeNonceRef = useRef(analyzeNonce);
  useEffect(() => {
    if (analyzeNonce === analyzeNonceRef.current) return;
    analyzeNonceRef.current = analyzeNonce;
    if (viewStatusRef.current === "analyzing") return;
    requestAnalysis();
  }, [analyzeNonce, requestAnalysis]);

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (cancelledRef.current) return;
      if (message.type === MessageType.JOB_ANALYSIS_RESULT) {
        setView({
          status: "ready",
          analysis: message.analysis,
          error: null,
          fallback: null,
          canonicalUrl: message.canonicalUrl,
          sourceUrl: message.sourceUrl,
          multiplePostings: message.multiplePostings,
          cached: message.cached,
          saved: message.saved,
        });
      } else if (message.type === MessageType.JOB_ANALYSIS_ERROR) {
        setView((prev) => ({
          ...prev,
          status: "error",
          analysis: null,
          error: message.error,
          fallback: message.fallback,
          canonicalUrl: message.canonicalUrl,
          sourceUrl: message.sourceUrl,
        }));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleCancel = () => {
    cancelledRef.current = true;
    setView((prev) => ({ ...prev, status: "idle" }));
  };

  const handleSave = async () => {
    if (!view.analysis || !view.canonicalUrl) return;
    const now = new Date().toISOString();
    const job: SavedJob = {
      schemaVersion: 1,
      canonicalUrl: view.canonicalUrl,
      sourceUrl: view.sourceUrl ?? view.canonicalUrl,
      analysis: view.analysis,
      status: "interested",
      notes: "",
      savedAt: now,
      updatedAt: now,
    };
    try {
      await jobStorage.save(job);
      setSaveError(null);
      setView((prev) => ({ ...prev, saved: job }));
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Saving failed. Please try again."
      );
    }
  };

  const handleExport = async () => {
    const json = await jobStorage.exportAll();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `saved-jobs-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handlePruneArchived = async () => {
    await jobStorage.pruneArchived(50);
    setSaveError(null);
  };

  return (
    <>
      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "this-page" && (
          <div
            id="panel-this-page"
            role="tabpanel"
            aria-labelledby="tab-this-page"
            className="h-full overflow-y-auto"
          >
            <ThisPageTab
              view={view}
              saveError={saveError}
              onAnalyze={() => requestAnalysis()}
              onCancel={handleCancel}
              onForceAnalyze={() => requestAnalysis({ assumeJobPosting: true })}
              onReanalyze={() => requestAnalysis({ bypassCache: true })}
              onSave={() => void handleSave()}
              onExport={() => void handleExport()}
              onPruneArchived={() => void handlePruneArchived()}
            />
          </div>
        )}

        {activeTab === "saved" && (
          <div
            id="panel-saved"
            role="tabpanel"
            aria-labelledby="tab-saved"
            className="h-full overflow-y-auto"
          >
            <SavedTab />
          </div>
        )}
      </div>
    </>
  );
}
