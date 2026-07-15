import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postJobAnalysis } from "../../services/jobAnalysisClient";
import {
  getIdToken,
  markNotAuthorized,
  signInSilently,
  signOut,
} from "../../services/auth/authService";
import type { JobAnalysis, PageExtract, JobPanelError } from "../../types/job";

vi.mock("../../services/auth/authService", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-id-token"),
  signInSilently: vi.fn().mockResolvedValue(null),
  signOut: vi.fn().mockResolvedValue(undefined),
  markNotAuthorized: vi.fn().mockResolvedValue(undefined),
}));

const extract: PageExtract = {
  url: "https://boards.greenhouse.io/acme/jobs/123?gh_src=x",
  canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
  title: "Senior Backend Engineer - Acme",
  jsonLd: [{ "@type": "JobPosting", title: "Senior Backend Engineer" }],
  mainText: "Hybrid, 3 days per week in our Austin office.",
  extractedAt: "2026-07-04T12:00:00Z",
};

// Pinned to contracts/analyze-job.md — response example shape.
const analysis: JobAnalysis = {
  isJobPosting: true,
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Austin, TX",
  arrangement: "hybrid",
  arrangementConfidence: "explicit",
  arrangementEvidence: "Hybrid, 3 days per week in our Austin office",
  daysInOffice: 3,
  daysRemote: 2,
  remoteRestrictions: null,
  salary: { min: 180000, max: 220000, currency: "USD", period: "year" },
  seniority: "senior",
  techStack: ["C#", ".NET 8", "Azure"],
  fit: null,
  model: "gpt-4o-mini",
  analyzedAt: "2026-07-04T12:00:04Z",
};

async function expectJobError(
  promise: Promise<unknown>,
  code: JobPanelError["code"],
  retryable?: boolean
): Promise<void> {
  const err = (await promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e
  )) as JobPanelError;
  expect(err.code).toBe(code);
  expect(typeof err.message).toBe("string");
  expect(typeof err.action).toBe("string");
  if (retryable !== undefined) expect(err.retryable).toBe(retryable);
}

describe("jobAnalysisClient — postJobAnalysis", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("WXT_AZURE_FUNCTION_URL", "http://localhost:7071/api/analyze-job");
    vi.stubGlobal("WXT_AZURE_FUNCTION_KEY", "test-key");
    vi.mocked(getIdToken).mockReset().mockResolvedValue("test-id-token");
    vi.mocked(signInSilently).mockReset().mockResolvedValue(null);
    vi.mocked(signOut).mockClear();
    vi.mocked(markNotAuthorized).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("POSTs the extract to the configured endpoint and returns the analysis", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(analysis), { status: 200 })
    );

    await expect(postJobAnalysis({ extract })).resolves.toEqual(analysis);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/api/analyze-job");
    expect(String(url)).toContain("code=test-key");
    const body = JSON.parse((init as RequestInit).body as string) as {
      extract: PageExtract;
      profile?: string;
    };
    expect(body.extract).toEqual(extract);
    expect(body.profile).toBeUndefined();
  });

  it("attaches the Google ID token as a Bearer Authorization header", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(analysis), { status: 200 })
    );
    await postJobAnalysis({ extract });
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-id-token"
    );
  });

  it("on 401: renews silently once, retries, and succeeds with the new token", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), {
          status: 401,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(analysis), { status: 200 }));
    vi.mocked(signInSilently).mockResolvedValue({
      idToken: "renewed-token",
      expiresAt: Date.now() + 3600_000,
      signedInAt: Date.now(),
      user: { sub: "s", email: "e@example.com" },
    });

    await expect(postJobAnalysis({ extract })).resolves.toEqual(analysis);
    expect(signInSilently).toHaveBeenCalledTimes(1);
    const retryInit = vi.mocked(fetch).mock.calls[1]![1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer renewed-token"
    );
  });

  it("on 401 with failed renewal: signs out and reports a session-ended error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), {
        status: 401,
      })
    );
    await expectJobError(postJobAnalysis({ extract }), "no-access", false);
    expect(signOut).toHaveBeenCalled();
  });

  it("on 403: marks the session not-authorized and reports the invitation error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "NOT_AUTHORIZED" } }), {
        status: 403,
      })
    );
    await expectJobError(postJobAnalysis({ extract }), "no-access", false);
    expect(markNotAuthorized).toHaveBeenCalled();
    expect(signInSilently).not.toHaveBeenCalled();
  });

  it("includes profile and assumeJobPosting when provided", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(analysis), { status: 200 })
    );

    await postJobAnalysis({
      extract,
      profile: "Senior .NET engineer",
      assumeJobPosting: true,
    });
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string
    ) as Record<string, unknown>;
    expect(body.profile).toBe("Senior .NET engineer");
    expect(body.assumeJobPosting).toBe(true);
  });

  it("rejects with not-configured when no endpoint is available", async () => {
    vi.stubGlobal("WXT_AZURE_FUNCTION_URL", "");
    await expectJobError(postJobAnalysis({ extract }), "not-configured", false);
  });

  it("maps network failure to a retryable network-error", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("failed to fetch"));
    await expectJobError(postJobAnalysis({ extract }), "network-error", true);
  });

  it("maps a 30s timeout abort to a retryable network-error", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );

    const promise = postJobAnalysis({ extract });
    const assertion = expectJobError(promise, "network-error", true);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("maps 400 to a non-retryable unknown error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "INVALID_REQUEST", message: "bad" } }),
        { status: 400 }
      )
    );
    await expectJobError(postJobAnalysis({ extract }), "unknown", false);
  });

  it("maps 413 to a non-retryable extract-too-large error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "EXTRACT_TOO_LARGE", message: "too big" } }),
        { status: 413 }
      )
    );
    await expectJobError(postJobAnalysis({ extract }), "extract-too-large", false);
  });

  it("maps 502 schema failure to a retryable service-error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "SCHEMA_PARSE_FAILED", message: "bad output" } }),
        { status: 502 }
      )
    );
    await expectJobError(postJobAnalysis({ extract }), "service-error", true);
  });

  it("maps 504 upstream timeout to a retryable service-error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "UPSTREAM_TIMEOUT", message: "slow" } }),
        { status: 504 }
      )
    );
    await expectJobError(postJobAnalysis({ extract }), "service-error", true);
  });

  it("maps 429 USAGE_LIMIT_REACHED to a distinct, non-retryable usage-limit-reached error carrying usage", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "USAGE_LIMIT_REACHED",
            message: "You've used all 50 free analyses this month.",
          },
          usage: { count: 50, limit: 50, resetsAt: "2026-08-01T00:00:00Z", tier: "free" },
        }),
        { status: 429 }
      )
    );
    const err = (await postJobAnalysis({ extract }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e
    )) as JobPanelError;
    expect(err.code).toBe("usage-limit-reached");
    expect(err.retryable).toBe(false);
    expect(err.usage).toEqual({
      count: 50,
      limit: 50,
      resetsAt: "2026-08-01T00:00:00Z",
      tier: "free",
    });
  });

  it("maps 429 RATE_LIMITED to a generic retryable service-error, distinct from usage-limit-reached", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow down" } }),
        { status: 429 }
      )
    );
    await expectJobError(postJobAnalysis({ extract }), "service-error", true);
  });

  it("rejects a 200 response that fails the JobAnalysis shape check", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ nonsense: true }), { status: 200 })
    );
    await expectJobError(postJobAnalysis({ extract }), "service-error", true);
  });
});
