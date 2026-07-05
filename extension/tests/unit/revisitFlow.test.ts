import { describe, it, expect, beforeEach, vi } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { analyzeJobPage } from "../../services/jobFlow";
import { jobStorage } from "../../services/jobStorage";
import { setCached } from "../../services/jobAnalysisCache";
import { postJobAnalysis } from "../../services/jobAnalysisClient";
import { MessageType } from "../../types/messages";
import type {
  ExtensionMessage,
  JobAnalysisResultMessage,
} from "../../types/messages";
import type { JobAnalysis, SavedJob } from "../../types/job";

vi.mock("../../services/jobAnalysisClient", () => ({
  postJobAnalysis: vi.fn(),
}));

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
