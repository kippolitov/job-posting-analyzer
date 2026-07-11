import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi, TEST_API_BASE } from "./helpers/mswStorageServer";
import { analyzeJobPage } from "../../services/jobFlow";
import { jobStorage } from "../../services/jobStorage";
import { setCached } from "../../services/jobAnalysisCache";
import { postJobAnalysis } from "../../services/jobAnalysisClient";
import { MessageType } from "../../types/messages";
import type {
  ExtensionMessage,
  JobAnalysisErrorMessage,
  JobAnalysisResultMessage,
} from "../../types/messages";
import type { JobAnalysis, SavedJob } from "../../types/job";

vi.mock("../../services/jobAnalysisClient", () => ({
  postJobAnalysis: vi.fn(),
}));

// jobStorage is server-backed since 002; run it against the contract-faithful
// fake API instead of chrome.storage.
const api = installFakeStorageApi();

const POSTING_TEXT =
  "We are hiring a senior engineer. Fully remote within the US. ".repeat(10);

function makeAnalysis(title: string): JobAnalysis {
  return {
    isJobPosting: true,
    title,
    company: "Acme",
    location: null,
    arrangement: "remote",
    arrangementConfidence: "explicit",
    arrangementEvidence: "Fully remote within the US",
    daysInOffice: null,
    daysRemote: null,
    remoteRestrictions: "US only",
    salary: null,
    seniority: "senior",
    techStack: [],
    fit: null,
    model: "gpt-4o-mini",
    analyzedAt: "2026-07-04T12:00:04Z",
  };
}

function makeSavedJob(canonicalUrl: string): SavedJob {
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    analysis: makeAnalysis("Saved Role"),
    status: "applied",
    notes: "recruiter: Dana",
    savedAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

function stubExtraction(url: string): void {
  vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
    {
      result: {
        url,
        title: "Posting",
        jsonLd: [],
        mainText: POSTING_TEXT,
        extractedAt: "2026-07-04T12:00:00Z",
      },
      frameId: 0,
    },
  ] as never);
}

async function runFlow(
  sourceUrl: string,
  options: { bypassCache?: boolean } = {}
): Promise<ExtensionMessage[]> {
  const broadcasts: ExtensionMessage[] = [];
  stubExtraction(sourceUrl);
  await analyzeJobPage(
    {
      type: MessageType.ANALYZE_JOB_PAGE,
      tabId: 7,
      bypassCache: options.bypassCache,
    },
    (m) => broadcasts.push(m)
  );
  return broadcasts;
}

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryStorage("local");
  installMemoryStorage("session");
});

describe("analyze flow — error paths", () => {
  it("broadcasts a non-retryable error when the page cannot be read", async () => {
    const broadcasts: ExtensionMessage[] = [];
    vi.mocked(chrome.scripting.executeScript).mockRejectedValue(
      new Error("Cannot access contents of the page")
    );
    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 },
      (m) => broadcasts.push(m)
    );

    expect(broadcasts[0]).toMatchObject({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: { code: "no-access", retryable: false },
    });
    expect(postJobAnalysis).not.toHaveBeenCalled();
  });

  it("skips the backend for thin pages with no JSON-LD", async () => {
    const broadcasts: ExtensionMessage[] = [];
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
      {
        result: {
          url: "https://a.example/short",
          title: "Short",
          jsonLd: [],
          mainText: "too short",
          extractedAt: "2026-07-04T12:00:00Z",
        },
        frameId: 0,
      },
    ] as never);

    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 },
      (m) => broadcasts.push(m)
    );

    expect(broadcasts[0]).toMatchObject({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: { code: "thin-content" },
    });
    expect(postJobAnalysis).not.toHaveBeenCalled();
  });

  it("broadcasts backend errors with JSON-LD fallback fields", async () => {
    const broadcasts: ExtensionMessage[] = [];
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
      {
        result: {
          url: "https://a.example/jobs/1",
          title: "Posting",
          jsonLd: [
            {
              "@type": "JobPosting",
              title: "Fallback Role",
              hiringOrganization: { name: "Acme" },
            },
          ],
          mainText: POSTING_TEXT,
          extractedAt: "2026-07-04T12:00:00Z",
        },
        frameId: 0,
      },
    ] as never);
    vi.mocked(postJobAnalysis).mockRejectedValue({
      code: "service-error",
      message: "The analysis service encountered an error.",
      action: "Try again.",
      retryable: true,
    });

    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 },
      (m) => broadcasts.push(m)
    );

    expect(broadcasts[0]).toMatchObject({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: { code: "service-error" },
      fallback: { title: "Fallback Role", company: "Acme" },
    });
  });

  it("analyzes without the profile when the profile fetch fails", async () => {
    // Profile endpoint down; the analysis itself must still go through.
    api.server.use(
      http.get(
        `${TEST_API_BASE}/profile`,
        () =>
          HttpResponse.json(
            { error: { code: "SERVICE_ERROR", message: "boom" } },
            { status: 500 }
          ),
        { once: true }
      )
    );
    vi.mocked(postJobAnalysis).mockResolvedValue(makeAnalysis("Role"));

    const messages = await runFlow("https://boards.greenhouse.io/acme/jobs/11");

    expect(postJobAnalysis).toHaveBeenCalledTimes(1);
    const [request] = vi.mocked(postJobAnalysis).mock.calls[0]!;
    expect(request.profile).toBeUndefined();
    expect(messages[0]!.type).toBe(MessageType.JOB_ANALYSIS_RESULT);
  });

  it("keeps the message of Error-subclass failures readable after sendMessage JSON serialization", async () => {
    class FakeApiError extends Error {
      readonly code = "SERVICE_ERROR";
      readonly retryable = true;
      constructor() {
        super("The storage service encountered an error. Try again.");
      }
    }
    stubExtraction("https://a.example/jobs/3");
    vi.mocked(postJobAnalysis).mockRejectedValue(new FakeApiError());

    const broadcasts: ExtensionMessage[] = [];
    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 },
      (m) => broadcasts.push(m)
    );

    // chrome.runtime.sendMessage JSON-serializes: Error#message is
    // non-enumerable and vanishes unless the flow rebuilds a plain object.
    const wire = JSON.parse(
      JSON.stringify(broadcasts[0])
    ) as JobAnalysisErrorMessage;
    expect(wire.error.message).toBe(
      "The storage service encountered an error. Try again."
    );
    expect(wire.error.code).toBe("service-error");
    expect(wire.error.action).toBe("Try again.");
    expect(wire.error.retryable).toBe(true);
  });

  it("wraps non-typed failures into a generic retryable error", async () => {
    const broadcasts: ExtensionMessage[] = [];
    stubExtraction("https://a.example/jobs/2");
    vi.mocked(postJobAnalysis).mockRejectedValue(new Error("boom"));

    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 },
      (m) => broadcasts.push(m)
    );

    expect(broadcasts[0]).toMatchObject({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: { code: "unknown", retryable: true },
    });
  });
});

describe("revisit without page access — remembered tab URL", () => {
  it("serves the stored analysis when executeScript fails after a prior analysis on the same tab", async () => {
    vi.mocked(postJobAnalysis).mockResolvedValue(makeAnalysis("Remembered Role"));
    await runFlow("https://boards.greenhouse.io/acme/jobs/7");

    // Tab switch killed the activeTab grant: extraction now fails.
    vi.mocked(chrome.scripting.executeScript).mockRejectedValue(
      new Error("no activeTab grant")
    );
    const broadcasts: ExtensionMessage[] = [];
    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 },
      (m) => broadcasts.push(m)
    );

    expect(postJobAnalysis).toHaveBeenCalledTimes(1);
    const result = broadcasts[0] as JobAnalysisResultMessage;
    expect(result.type).toBe(MessageType.JOB_ANALYSIS_RESULT);
    expect(result.analysis.title).toBe("Remembered Role");
    expect(result.cached).toBe(true);
  });

  it("a cachedOnly probe restores the stored analysis without touching the page", async () => {
    vi.mocked(postJobAnalysis).mockResolvedValue(makeAnalysis("Probe Role"));
    await runFlow("https://boards.greenhouse.io/acme/jobs/8");
    vi.mocked(chrome.scripting.executeScript).mockClear();

    const broadcasts: ExtensionMessage[] = [];
    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 7, cachedOnly: true },
      (m) => broadcasts.push(m)
    );

    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    const result = broadcasts[0] as JobAnalysisResultMessage;
    expect(result.type).toBe(MessageType.JOB_ANALYSIS_RESULT);
    expect(result.analysis.title).toBe("Probe Role");
  });

  it("a cachedOnly probe stays silent when nothing is stored for the tab", async () => {
    const broadcasts: ExtensionMessage[] = [];
    await analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 42, cachedOnly: true },
      (m) => broadcasts.push(m)
    );

    expect(broadcasts).toEqual([]);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe("revisit flow — lookup order saved → cached → backend", () => {
  it("renders the saved posting without any backend call, even via a tracking-param URL", async () => {
    await jobStorage.save(makeSavedJob("https://boards.greenhouse.io/acme/jobs/1"));

    const messages = await runFlow(
      "https://boards.greenhouse.io/acme/jobs/1?gh_src=xyz&utm_source=mail"
    );

    expect(postJobAnalysis).not.toHaveBeenCalled();
    const result = messages[0] as JobAnalysisResultMessage;
    expect(result.type).toBe(MessageType.JOB_ANALYSIS_RESULT);
    expect(result.saved?.status).toBe("applied");
    expect(result.saved?.notes).toBe("recruiter: Dana");
    expect(result.cached).toBe(true);
    expect(result.analysis.title).toBe("Saved Role");
  });

  it("serves an unsaved recent analysis from the cache without a backend call", async () => {
    await setCached(
      "https://boards.greenhouse.io/acme/jobs/2",
      makeAnalysis("Cached Role")
    );

    const messages = await runFlow("https://boards.greenhouse.io/acme/jobs/2");

    expect(postJobAnalysis).not.toHaveBeenCalled();
    const result = messages[0] as JobAnalysisResultMessage;
    expect(result.analysis.title).toBe("Cached Role");
    expect(result.cached).toBe(true);
    expect(result.saved).toBeNull();
  });

  it("sends the configured profile with the analysis request (FR-007)", async () => {
    const { setProfile } = await import("../../services/profileStorage");
    await setProfile({
      text: "Principal .NET engineer",
      dealbreakers: ["no fully on-site roles"],
    });
    vi.mocked(postJobAnalysis).mockResolvedValue(makeAnalysis("Role"));

    await runFlow("https://boards.greenhouse.io/acme/jobs/9");

    const [request] = vi.mocked(postJobAnalysis).mock.calls[0]!;
    expect(request.profile).toContain("Principal .NET engineer");
    expect(request.profile).toContain("no fully on-site roles");
  });

  it("omits the profile when none is configured", async () => {
    vi.mocked(postJobAnalysis).mockResolvedValue(makeAnalysis("Role"));
    await runFlow("https://boards.greenhouse.io/acme/jobs/10");
    const [request] = vi.mocked(postJobAnalysis).mock.calls[0]!;
    expect(request.profile).toBeUndefined();
  });

  it("calls the backend exactly once on a miss and caches the result", async () => {
    vi.mocked(postJobAnalysis).mockResolvedValue(makeAnalysis("Fresh Role"));

    await runFlow("https://boards.greenhouse.io/acme/jobs/3");
    expect(postJobAnalysis).toHaveBeenCalledTimes(1);

    // Second run hits the cache — still exactly one backend call.
    const second = await runFlow("https://boards.greenhouse.io/acme/jobs/3");
    expect(postJobAnalysis).toHaveBeenCalledTimes(1);
    expect((second[0] as JobAnalysisResultMessage).cached).toBe(true);
  });

  it("re-analyzes a cached posting whose fit is missing once a newer profile exists", async () => {
    await setCached(
      "https://boards.greenhouse.io/acme/jobs/5",
      makeAnalysis("Cached, no fit") // fit: null, analyzedAt in the past
    );
    const { setProfile } = await import("../../services/profileStorage");
    await setProfile({ text: "Principal .NET engineer", dealbreakers: [] });
    vi.mocked(postJobAnalysis).mockResolvedValue({
      ...makeAnalysis("Cached, no fit"),
      fit: { score: 82, rationale: "Strong match" },
      analyzedAt: new Date().toISOString(),
    });

    const messages = await runFlow("https://boards.greenhouse.io/acme/jobs/5");

    expect(postJobAnalysis).toHaveBeenCalledTimes(1);
    const result = messages[0] as JobAnalysisResultMessage;
    expect(result.analysis.fit).toEqual({ score: 82, rationale: "Strong match" });
    expect(result.cached).toBe(false);
  });

  it("refreshes a saved posting's snapshot with the newly computed fit (status/notes survive)", async () => {
    const canonicalUrl = "https://boards.greenhouse.io/acme/jobs/1";
    await jobStorage.save(makeSavedJob(canonicalUrl));
    const { setProfile } = await import("../../services/profileStorage");
    await setProfile({ text: "Principal .NET engineer", dealbreakers: [] });
    vi.mocked(postJobAnalysis).mockResolvedValue({
      ...makeAnalysis("Saved Role"),
      fit: { score: 45, rationale: "Partial match" },
      analyzedAt: new Date().toISOString(),
    });

    const messages = await runFlow(canonicalUrl);

    const result = messages[0] as JobAnalysisResultMessage;
    expect(result.analysis.fit?.score).toBe(45);
    expect(result.saved?.status).toBe("applied");
    const stored = await jobStorage.get(canonicalUrl);
    expect(stored!.analysis.fit?.score).toBe(45);
    expect(stored!.notes).toBe("recruiter: Dana");
  });

  it("keeps serving the cache when the fit-less analysis is newer than the profile", async () => {
    const { setProfile } = await import("../../services/profileStorage");
    await setProfile({ text: "Principal .NET engineer", dealbreakers: [] });
    await setCached("https://boards.greenhouse.io/acme/jobs/6", {
      ...makeAnalysis("Recent, genuinely no fit"),
      analyzedAt: "2099-01-01T00:00:00Z",
    });

    const messages = await runFlow("https://boards.greenhouse.io/acme/jobs/6");

    expect(postJobAnalysis).not.toHaveBeenCalled();
    expect((messages[0] as JobAnalysisResultMessage).cached).toBe(true);
  });

  it("Re-analyze bypasses saved and cache, replaces the saved snapshot, and bumps updatedAt", async () => {
    const canonicalUrl = "https://boards.greenhouse.io/acme/jobs/1";
    await jobStorage.save(makeSavedJob(canonicalUrl));
    vi.mocked(postJobAnalysis).mockResolvedValue(makeAnalysis("Refreshed Role"));

    const messages = await runFlow(canonicalUrl, { bypassCache: true });

    expect(postJobAnalysis).toHaveBeenCalledTimes(1);
    const result = messages[0] as JobAnalysisResultMessage;
    expect(result.analysis.title).toBe("Refreshed Role");
    expect(result.cached).toBe(false);
    expect(result.saved?.analysis.title).toBe("Refreshed Role");

    const stored = await jobStorage.get(canonicalUrl);
    expect(stored!.analysis.title).toBe("Refreshed Role");
    expect(stored!.status).toBe("applied"); // status and notes survive re-analysis
    expect(Date.parse(stored!.updatedAt)).toBeGreaterThan(
      Date.parse("2026-07-01T00:00:00Z")
    );
  });
});
