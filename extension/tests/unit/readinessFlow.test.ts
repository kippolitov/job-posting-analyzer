import { describe, it, expect, beforeEach, vi } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi } from "./helpers/mswStorageServer";
import { analyzeJobPage, cancelAnalysis } from "../../services/jobFlow";
import { postJobAnalysis } from "../../services/jobAnalysisClient";
import { MessageType } from "../../types/messages";
import type { ExtensionMessage, JobAnalysisErrorMessage } from "../../types/messages";
import type { ExtractionProvenance } from "../../types/job";

/**
 * US1 readiness at the flow layer: the two thin-content variants (FR-005) and
 * cancellation (FR-006, FR-006b).
 *
 * Lives in its own file rather than jobFlow.test.ts, which has no analyzeJobPage
 * harness — the msw storage fake and the client mock below would have to be
 * duplicated into it. Matches the existing one-file-per-flow convention
 * (jobFlow, revisitFlow).
 */

vi.mock("../../services/jobAnalysisClient", () => ({
  postJobAnalysis: vi.fn(),
}));

installFakeStorageApi();

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryStorage("local");
  installMemoryStorage("session");
});

const SOURCE_URL = "https://jobs.example.com/job/123";

function provenance(overrides: Partial<ExtractionProvenance> = {}): ExtractionProvenance {
  return {
    strategy: "semantic",
    attempts: 1,
    elapsedMs: 40,
    budgetExpired: false,
    learnedSelectorMissed: false,
    ...overrides,
  };
}

function stubExtraction(extract: {
  mainText: string;
  jsonLd?: Record<string, unknown>[];
  provenance: ExtractionProvenance;
}): void {
  vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
    {
      result: {
        url: SOURCE_URL,
        title: "Posting",
        jsonLd: extract.jsonLd ?? [],
        structuredSources: [],
        mainText: extract.mainText,
        extractedAt: "2026-07-26T12:00:00Z",
        provenance: extract.provenance,
      },
      frameId: 0,
    },
  ] as never);
}

async function runFlow(): Promise<ExtensionMessage[]> {
  const messages: ExtensionMessage[] = [];
  await analyzeJobPage(
    { type: MessageType.ANALYZE_JOB_PAGE, tabId: 1, bypassCache: true },
    (m) => messages.push(m)
  );
  return messages;
}

function errorOf(messages: ExtensionMessage[]): JobAnalysisErrorMessage["error"] {
  const error = messages.find(
    (m): m is JobAnalysisErrorMessage => m.type === MessageType.JOB_ANALYSIS_ERROR
  );
  if (!error) throw new Error("no error broadcast");
  return error.error;
}

describe("readiness — thin-content copy (T014, FR-005)", () => {
  beforeEach(() => {
    vi.mocked(chrome.scripting.executeScript).mockReset();
    vi.mocked(postJobAnalysis).mockReset();
  });

  it("says the page was still loading when the readiness budget expired", async () => {
    stubExtraction({ mainText: "", provenance: provenance({ budgetExpired: true, attempts: 14 }) });

    const error = errorOf(await runFlow());

    expect(error.code).toBe("thin-content");
    expect(error.message).toBe("The page was still loading when we tried to read it.");
    expect(error.action).toBe("Wait for the page to finish loading, then re-analyze.");
    expect(error.retryable).toBe(true);
  });

  it("keeps today's copy when the page settled with nothing to read", async () => {
    stubExtraction({ mainText: "too short", provenance: provenance({ budgetExpired: false }) });

    const error = errorOf(await runFlow());

    expect(error.code).toBe("thin-content");
    expect(error.message).toBe("Not enough page content to analyze.");
    expect(error.action).toBe("Open the full job posting page, then re-analyze.");
    expect(error.retryable).toBe(true);
  });

  it("errors rather than analyzing JSON-LD with no posting body (FR-004a)", async () => {
    // The silent-degradation path 3/6 fixtures take today: JSON-LD alone
    // satisfies the old thin-content check, so the model receives structured
    // fields and no posting body, and the user is never told.
    stubExtraction({
      mainText: "",
      jsonLd: [{ "@type": "JobPosting", title: "Data Engineer" }],
      provenance: provenance({ budgetExpired: true }),
    });

    const error = errorOf(await runFlow());

    expect(error.code).toBe("thin-content");
    expect(error.message).toBe("The page was still loading when we tried to read it.");
    expect(postJobAnalysis).not.toHaveBeenCalled();
  });
});

describe("readiness — cancellation (T015, FR-006/FR-006b)", () => {
  beforeEach(() => {
    vi.mocked(chrome.scripting.executeScript).mockReset();
    vi.mocked(postJobAnalysis).mockReset();
  });

  it("sends no analysis request when cancelled during the readiness wait", async () => {
    // Extraction resolves only after the cancel lands, which is exactly the
    // readiness-wait shape: the injected function is still waiting in the page.
    let settle: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    vi.mocked(chrome.scripting.executeScript).mockImplementation((async () => {
      await pending;
      return [
        {
          result: {
            url: SOURCE_URL,
            title: "Posting",
            jsonLd: [],
            structuredSources: [],
            mainText: "A perfectly analyzable posting body. ".repeat(20),
            extractedAt: "2026-07-26T12:00:00Z",
            provenance: provenance({ attempts: 6, elapsedMs: 2400 }),
          },
          frameId: 0,
        },
      ];
    }) as never);

    const messages: ExtensionMessage[] = [];
    const flow = analyzeJobPage(
      { type: MessageType.ANALYZE_JOB_PAGE, tabId: 1, bypassCache: true },
      (m) => messages.push(m)
    );

    cancelAnalysis({ type: MessageType.CANCEL_ANALYSIS, tabId: 1 });
    settle?.();
    await flow;

    expect(postJobAnalysis).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it("leaves the page immediately re-analyzable after a cancel (FR-006b)", async () => {
    cancelAnalysis({ type: MessageType.CANCEL_ANALYSIS, tabId: 1 });

    stubExtraction({
      mainText: "A perfectly analyzable posting body. ".repeat(20),
      provenance: provenance(),
    });
    vi.mocked(postJobAnalysis).mockResolvedValue({
      isJobPosting: true,
      title: "Engineer",
      company: "Acme",
      location: null,
      arrangement: "remote",
      arrangementConfidence: "explicit",
      arrangementEvidence: "remote",
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "senior",
      techStack: [],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-26T12:00:01Z",
    });

    const messages = await runFlow();

    // A stale cancel must not poison the next attempt.
    expect(postJobAnalysis).toHaveBeenCalledTimes(1);
    expect(messages.map((m) => m.type)).toContain(MessageType.JOB_ANALYSIS_RESULT);
  });
});
