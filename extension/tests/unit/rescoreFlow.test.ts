import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi, TEST_API_BASE } from "./helpers/mswStorageServer";
import {
  analyzeJobPage,
  analyzePastedText,
  analyzeScopedRegion,
  rescoreJobPage,
} from "../../services/jobFlow";
import { jobStorage } from "../../services/jobStorage";
import { setProfile } from "../../services/profileStorage";
import { postJobAnalysis } from "../../services/jobAnalysisClient";
import { profileToPromptText } from "../../../shared/types/profile";
import { MessageType } from "../../types/messages";
import type {
  ExtensionMessage,
  JobAnalysisResultMessage,
  PasteAnalysisResultMessage,
} from "../../types/messages";
import type { JobAnalysis, SavedJob } from "../../types/job";

vi.mock("../../services/jobAnalysisClient", () => ({
  postJobAnalysis: vi.fn(),
}));

const api = installFakeStorageApi();

const URL_1 = "https://boards.greenhouse.io/acme/jobs/1";
const POSTING_TEXT =
  "We are hiring a senior engineer. Fully remote within the US. ".repeat(10);
const OLD = "o".repeat(64);
const PROFILE = { text: "Principal .NET engineer", dealbreakers: ["no on-site"] };

function analysisWith(score: number, fingerprint?: string): JobAnalysis {
  return {
    isJobPosting: true,
    title: "Role",
    company: "Acme",
    location: null,
    arrangement: "remote",
    arrangementConfidence: "explicit",
    arrangementEvidence: null,
    daysInOffice: null,
    daysRemote: null,
    remoteRestrictions: null,
    salary: null,
    seniority: "senior",
    techStack: [],
    fit: { score, rationale: "r", ...(fingerprint ? { profileFingerprint: fingerprint } : {}) },
    model: "m",
    analyzedAt: "2026-07-04T12:00:04Z",
  };
}

async function saveStale(): Promise<SavedJob> {
  const job: SavedJob = {
    schemaVersion: 1,
    canonicalUrl: URL_1,
    sourceUrl: URL_1,
    analysis: analysisWith(40, OLD),
    status: "applied",
    notes: "n",
    savedAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
  await jobStorage.save(job);
  return job;
}

function stubPage(mainText: string): void {
  vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
    {
      result: {
        url: URL_1,
        title: "Posting",
        jsonLd: [],
        mainText,
        extractedAt: "2026-07-04T12:00:00Z",
      },
      frameId: 0,
    },
  ] as never);
}

async function rescore(): Promise<ExtensionMessage[]> {
  const out: ExtensionMessage[] = [];
  await rescoreJobPage(
    { type: MessageType.RESCORE_JOB_PAGE, tabId: 7, priorFingerprint: OLD },
    (m) => out.push(m)
  );
  return out;
}

function failProfile(): void {
  api.server.use(
    http.get(`${TEST_API_BASE}/profile`, () =>
      HttpResponse.json({ error: { code: "SERVICE_ERROR" } }, { status: 500 })
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryStorage("local");
  installMemoryStorage("session");
});

describe("rescore flow", () => {
  it("sends rescore, profileData and profile, and PATCHes the saved analysis", async () => {
    await saveStale();
    await setProfile(PROFILE);
    stubPage(POSTING_TEXT);
    vi.mocked(postJobAnalysis).mockResolvedValue({
      analysis: analysisWith(80, "n".repeat(64)),
      postingUnavailable: false,
    });

    const out = await rescore();

    const [request] = vi.mocked(postJobAnalysis).mock.calls[0]!;
    expect(request.rescore).toEqual({ priorFingerprint: OLD });
    expect(request.profileData).toEqual(PROFILE);
    expect(request.profile).toBe(profileToPromptText(PROFILE));
    const result = out[0] as JobAnalysisResultMessage;
    expect(result.cached).toBe(false);
    expect(result.analysis.fit?.score).toBe(80);
    expect((await jobStorage.get(URL_1))!.analysis.fit?.score).toBe(80);
  });

  it("keeps the stored analysis and PATCHes nothing when the rescore fails", async () => {
    await saveStale();
    await setProfile(PROFILE);
    stubPage(POSTING_TEXT);
    vi.mocked(postJobAnalysis).mockRejectedValue({
      code: "service-error",
      message: "boom",
      action: "Try again.",
      retryable: true,
    });

    const out = await rescore();

    const result = out[0] as JobAnalysisResultMessage;
    expect(result.type).toBe(MessageType.JOB_ANALYSIS_RESULT);
    expect(result.analysis.fit?.score).toBe(40);
    expect(result.analysis.fit?.profileFingerprint).toBe(OLD);
    expect(result.rescoreError).toMatchObject({ code: "service-error" });
    expect((await jobStorage.get(URL_1))!.analysis.fit?.score).toBe(40);
  });

  it("a postingUnavailable response keeps the stored analysis and PATCHes unavailableAt", async () => {
    await saveStale();
    await setProfile(PROFILE);
    stubPage(POSTING_TEXT);
    vi.mocked(postJobAnalysis).mockResolvedValue({
      analysis: { ...analysisWith(0), isJobPosting: false },
      postingUnavailable: true,
    });

    const out = await rescore();

    const result = out[0] as JobAnalysisResultMessage;
    expect(result.postingUnavailable).toBe(true);
    expect(result.analysis.fit?.score).toBe(40);
    const saved = await jobStorage.get(URL_1);
    expect(saved!.analysis.fit?.score).toBe(40);
    expect(saved!.unavailableAt).toEqual(expect.any(String));
  });
});

describe("thin content with a saved entry (FR-005)", () => {
  it("a normal analyze shows the stored result with postingUnavailable: false and no request", async () => {
    await saveStale();
    stubPage("gone");
    const out: ExtensionMessage[] = [];
    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 }, (m) =>
      out.push(m)
    );

    const result = out[0] as JobAnalysisResultMessage;
    expect(result.type).toBe(MessageType.JOB_ANALYSIS_RESULT);
    expect(result.postingUnavailable).toBe(false);
    expect(result.analysis.fit?.score).toBe(40);
    expect(postJobAnalysis).not.toHaveBeenCalled();
    expect((await jobStorage.get(URL_1))!.unavailableAt).toBeFalsy();
  });

  it("a Rescore PATCHes unavailableAt and sends no request", async () => {
    await saveStale();
    stubPage("gone");

    const out = await rescore();

    const result = out[0] as JobAnalysisResultMessage;
    expect(result.postingUnavailable).toBe(true);
    expect(result.analysis.fit?.score).toBe(40);
    expect(postJobAnalysis).not.toHaveBeenCalled();
    expect((await jobStorage.get(URL_1))!.unavailableAt).toEqual(expect.any(String));
  });

  it("without a stored entry, thin content is still an error", async () => {
    stubPage("gone");
    const out: ExtensionMessage[] = [];
    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 }, (m) =>
      out.push(m)
    );
    expect(out[0]).toMatchObject({
      type: MessageType.JOB_ANALYSIS_ERROR,
      error: { code: "thin-content" },
    });
  });
});

describe("profileData on every flow (FR-001, SC-006)", () => {
  const pasteText = "A pasted job posting body. ".repeat(20);

  beforeEach(async () => {
    await setProfile(PROFILE);
    vi.mocked(postJobAnalysis).mockResolvedValue({
      analysis: analysisWith(60),
      postingUnavailable: false,
    });
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url: URL_1 } as chrome.tabs.Tab);
  });

  async function runAll(): Promise<void> {
    stubPage(POSTING_TEXT);
    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 }, vi.fn());
    await analyzePastedText(
      { type: MessageType.ANALYZE_PASTED_TEXT, text: pasteText },
      vi.fn()
    );
    await analyzeScopedRegion(
      {
        type: MessageType.ANALYZE_SCOPED_REGION,
        tabId: 7,
        text: POSTING_TEXT,
        selector: "main",
        mechanism: "picked",
      },
      vi.fn()
    );
  }

  it("the page, paste and region flows send the stored profile in both forms", async () => {
    await runAll();
    const calls = vi.mocked(postJobAnalysis).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [request] of calls) {
      expect(request.profileData).toEqual(PROFILE);
      expect(request.profile).toBe(profileToPromptText(request.profileData!));
    }
  });

  it("send the stored preferences inside profileData (T111)", async () => {
    const preferences = { arrangements: ["remote" as const], maxOfficeDays: 2 };
    await setProfile({ ...PROFILE, preferences });
    await runAll();
    const calls = vi.mocked(postJobAnalysis).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [request] of calls) {
      expect(request.profileData).toEqual({ ...PROFILE, preferences });
      expect(request.profile).toBe(profileToPromptText(request.profileData!));
      expect(request.profile).toContain("Office days: at most 2 per week");
    }
  });

  it("they still analyze, and flag profileUnavailable, when the profile fetch fails", async () => {
    failProfile();
    const out: ExtensionMessage[] = [];
    stubPage(POSTING_TEXT);
    await analyzeJobPage({ type: MessageType.ANALYZE_JOB_PAGE, tabId: 7 }, (m) =>
      out.push(m)
    );
    await analyzePastedText(
      { type: MessageType.ANALYZE_PASTED_TEXT, text: pasteText },
      (m) => out.push(m)
    );
    await analyzeScopedRegion(
      {
        type: MessageType.ANALYZE_SCOPED_REGION,
        tabId: 7,
        text: POSTING_TEXT,
        selector: "main",
        mechanism: "picked",
      },
      (m) => out.push(m)
    );

    expect(postJobAnalysis).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(3);
    for (const message of out) {
      expect(message).toMatchObject({ profileUnavailable: true });
    }
  });
});

describe("paste rescore", () => {
  it("bypasses the stored lookup and sends the rescore intent", async () => {
    await setProfile(PROFILE);
    const text = "A pasted job posting body. ".repeat(20);
    vi.mocked(postJobAnalysis).mockResolvedValue({
      analysis: analysisWith(55),
      postingUnavailable: false,
    });
    await analyzePastedText({ type: MessageType.ANALYZE_PASTED_TEXT, text }, vi.fn());
    vi.mocked(postJobAnalysis).mockClear();

    const out: ExtensionMessage[] = [];
    await analyzePastedText(
      {
        type: MessageType.ANALYZE_PASTED_TEXT,
        text,
        rescore: { priorFingerprint: OLD },
      },
      (m) => out.push(m)
    );

    expect(postJobAnalysis).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postJobAnalysis).mock.calls[0]![0].rescore).toEqual({
      priorFingerprint: OLD,
    });
    expect((out[0] as PasteAnalysisResultMessage).cached ?? false).toBe(false);
  });
});
