import { useCallback, useEffect, useRef, useState } from "react";
import { TabBar } from "../shared/TabBar";
import { ThisPageTab } from "./ThisPageTab";
import { SavedTab } from "./SavedTab";
import { PasteComposer } from "./PasteComposer";
import type { JobView } from "./ThisPageTab";
import type { PasteView } from "./PasteComposer";
import { jobStorage } from "../../services/jobStorage";
import { startCheckout } from "../../services/accountService";
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

const INITIAL_PASTE_VIEW: PasteView = {
  status: "idle",
  analysis: null,
  error: null,
  canonicalUrl: null,
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
  /**
   * Bumped on every tab switch. Each bump is a cue to silently probe the
   * saved library / session cache for the revisited tab's analysis — the
   * background only answers if it has one, so idle stays idle.
   */
  probeNonce?: number;
}

export function JobPanel({
  tabId,
  navigationId = 0,
  analyzeNonce = 0,
  probeNonce = 0,
}: JobPanelProps) {
  const [view, setView] = useState<JobView>(INITIAL_VIEW);
  const [activeTab, setActiveTab] = useState<string>("this-page");
  const [saveError, setSaveError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const viewStatusRef = useRef(view.status);
  viewStatusRef.current = view.status;

  // Paste (spec FR-017): draft and result state live here, at the panel
  // level, so they survive the composer unmounting/remounting on close/
  // reopen (FR-017c) and are untouched by the navigation-reset effect below
  // (FR-017d) — that effect only ever writes to `view`, never to these.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasteView, setPasteView] = useState<PasteView>(INITIAL_PASTE_VIEW);
  const pasteButtonRef = useRef<HTMLButtonElement>(null);

  const handleOpenPaste = () => setPasteOpen(true);
  // FR-017b: closing (Escape or the close control) returns focus to the
  // header button that opened it.
  const handleClosePaste = () => {
    setPasteOpen(false);
    pasteButtonRef.current?.focus();
  };

  const submitPaste = (assumeJobPosting: boolean) => {
    setPasteView((prev) => ({ ...prev, status: "analyzing", error: null }));
    void chrome.runtime.sendMessage({
      type: MessageType.ANALYZE_PASTED_TEXT,
      text: pasteDraft,
      assumeJobPosting,
    });
  };

  const handleSavePaste = async () => {
    if (!pasteView.analysis || !pasteView.canonicalUrl) return;
    const now = new Date().toISOString();
    const job: SavedJob = {
      schemaVersion: 1,
      canonicalUrl: pasteView.canonicalUrl,
      sourceUrl: "",
      source: "paste",
      analysis: pasteView.analysis,
      status: "interested",
      notes: "",
      savedAt: now,
      updatedAt: now,
    };
    try {
      await jobStorage.save(job);
      setPasteView((prev) => ({ ...prev, saved: job }));
    } catch {
      // The library-full/error surface already lives on the This Page tab;
      // paste keeps this best-effort rather than duplicating that UI.
    }
  };

  const requestAnalysis = useCallback(
    (
      options: {
        assumeJobPosting?: boolean;
        bypassCache?: boolean;
        cachedOnly?: boolean;
      } = {}
    ) => {
      if (tabId === null) return;
      cancelledRef.current = false;
      if (!options.cachedOnly) {
        // A cachedOnly probe may go unanswered, so it must not enter the
        // "analyzing" state it could never leave.
        setView((prev) => ({ ...prev, status: "analyzing", error: null }));
      }
      void chrome.runtime.sendMessage({
        type: MessageType.ANALYZE_JOB_PAGE,
        tabId,
        assumeJobPosting: options.assumeJobPosting ?? false,
        bypassCache: options.bypassCache ?? false,
        cachedOnly: options.cachedOnly ?? false,
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

  // Tab switch: after the navigation reset above, silently ask the background
  // for a stored analysis of the revisited tab. It answers only from the
  // library/cache (no page access, so no permission error); on a miss the
  // panel simply stays idle. Declared after the reset effect so the probe's
  // un-cancelling runs last.
  const probeNonceRef = useRef(probeNonce);
  useEffect(() => {
    if (probeNonce === probeNonceRef.current) return;
    probeNonceRef.current = probeNonce;
    requestAnalysis({ cachedOnly: true });
  }, [probeNonce, requestAnalysis]);

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      // Paste has no page-cancellation concept of its own — it is unaffected
      // by cancelledRef, which only ever guards the This Page pipeline.
      if (message.type === MessageType.PASTE_ANALYSIS_RESULT) {
        setPasteView({
          status: "ready",
          analysis: message.analysis,
          error: null,
          canonicalUrl: message.canonicalUrl,
          saved: message.saved,
        });
        return;
      }
      if (message.type === MessageType.PASTE_ANALYSIS_ERROR) {
        setPasteView((prev) => ({
          ...prev,
          status: "error",
          analysis: null,
          error: message.error,
        }));
        return;
      }
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
          strategy: message.strategy,
          scopedRegion: message.scopedRegion,
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
    // Tell the background to actually stop. Until readiness, cancelling only
    // made the panel ignore the late result — the request was still sent and
    // the user's allowance still spent. There is now a real window to cancel
    // inside, so the request must not be sent at all (spec FR-006).
    if (tabId !== null) {
      // Promise.resolve so a sendMessage that returns void (older typings, and
      // the test double) cannot throw on .catch.
      void Promise.resolve(
        chrome.runtime.sendMessage({ type: MessageType.CANCEL_ANALYSIS, tabId })
      ).catch(() => {
        // Background asleep or already finished — the panel is idle either way.
      });
    }
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

  const handleUpgrade = async () => {
    try {
      const { checkoutUrl } = await startCheckout();
      window.open(checkoutUrl, "_blank", "noopener,noreferrer");
    } catch {
      // Checkout couldn't be created (already premium, Paddle unreachable,
      // etc.) — AccountBar in the options page surfaces the specific error.
      chrome.runtime.openOptionsPage();
    }
  };

  return (
    <>
      <TabBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabsDisabled={pasteOpen}
      >
        <button
          ref={pasteButtonRef}
          onClick={handleOpenPaste}
          aria-pressed={pasteOpen}
          className="rounded-md px-3 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          Paste text
        </button>
      </TabBar>

      <div className="min-h-0 flex-1 overflow-hidden">
        {pasteOpen ? (
          <PasteComposer
            draft={pasteDraft}
            onDraftChange={setPasteDraft}
            view={pasteView}
            onClose={handleClosePaste}
            onSubmit={() => submitPaste(false)}
            onForceSubmit={() => submitPaste(true)}
            onSave={() => void handleSavePaste()}
            onUpgrade={() => void handleUpgrade()}
          />
        ) : (
          <>
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
                  onForceAnalyze={() =>
                    // bypassCache is load-bearing: the "not a job posting" verdict
                    // was just cached, and without it the lookup replays that
                    // verdict before assumeJobPosting ever reaches the backend.
                    requestAnalysis({ assumeJobPosting: true, bypassCache: true })
                  }
                  onReanalyze={() => requestAnalysis({ bypassCache: true })}
                  onSave={() => void handleSave()}
                  onExport={() => void handleExport()}
                  onPruneArchived={() => void handlePruneArchived()}
                  onUpgrade={() => void handleUpgrade()}
                  onOpenPaste={handleOpenPaste}
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
          </>
        )}
      </div>
    </>
  );
}
