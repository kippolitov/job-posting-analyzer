import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, ApiError } from "../../services/api/apiClient";
import {
  getIdToken,
  markNotAuthorized,
  signInSilently,
  signOut,
} from "../../services/auth/authService";

vi.mock("../../services/auth/authService", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-id-token"),
  signInSilently: vi.fn().mockResolvedValue(null),
  signOut: vi.fn().mockResolvedValue(undefined),
  markNotAuthorized: vi.fn().mockResolvedValue(undefined),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("apiClient.apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("WXT_API_BASE_URL", "http://localhost:7071/api");
    vi.stubGlobal("WXT_AZURE_FUNCTION_KEY", "fn-key");
    vi.mocked(getIdToken).mockReset().mockResolvedValue("test-id-token");
    vi.mocked(signInSilently).mockReset().mockResolvedValue(null);
    vi.mocked(signOut).mockClear();
    vi.mocked(markNotAuthorized).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the URL from WXT_API_BASE_URL, adds the function key and Bearer token", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { ok: true }));
    await apiFetch("/jobs");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("http://localhost:7071/api/jobs");
    expect(String(url)).toContain("code=fn-key");
    expect(
      ((init as RequestInit).headers as Record<string, string>).Authorization
    ).toBe("Bearer test-id-token");
  });

  it("serializes body as JSON with the method given", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));
    await apiFetch("/jobs/prune", { method: "POST", body: { count: 3 } });
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ count: 3 });
  });

  it("throws a non-retryable not-configured error without a base URL", async () => {
    vi.stubGlobal("WXT_API_BASE_URL", "");
    await expect(apiFetch("/jobs")).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("on 401 renews once and retries with the fresh token", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "UNAUTHENTICATED" } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.mocked(signInSilently).mockResolvedValue({
      idToken: "renewed",
      expiresAt: Date.now() + 3600_000,
      signedInAt: Date.now(),
      user: { sub: "s", email: "e@example.com" },
    });

    const res = await apiFetch("/profile");
    expect(res.status).toBe(200);
    const retryInit = vi.mocked(fetch).mock.calls[1]![1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer renewed"
    );
  });

  it("on 401 with failed renewal: signs out and throws UNAUTHENTICATED", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(401, { error: { code: "UNAUTHENTICATED" } })
    );
    await expect(apiFetch("/profile")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
      retryable: false,
    });
    expect(signOut).toHaveBeenCalled();
  });

  it("on 403: marks not-authorized and throws NOT_AUTHORIZED", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(403, { error: { code: "NOT_AUTHORIZED" } })
    );
    await expect(apiFetch("/profile")).rejects.toMatchObject({
      status: 403,
      code: "NOT_AUTHORIZED",
      retryable: false,
    });
    expect(markNotAuthorized).toHaveBeenCalled();
  });

  it("maps 429 to a retryable RATE_LIMITED, distinct from SERVICE_ERROR", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(429, { error: { code: "RATE_LIMITED" } })
    );
    await expect(apiFetch("/jobs")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("maps 5xx to a retryable SERVICE_ERROR", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(500, { error: { code: "SERVICE_ERROR" } })
    );
    await expect(apiFetch("/jobs")).rejects.toMatchObject({
      status: 500,
      code: "SERVICE_ERROR",
      retryable: true,
    });
  });

  it("maps network failures to a retryable NETWORK_ERROR", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("failed to fetch"));
    const err = await apiFetch("/jobs").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "NETWORK_ERROR", retryable: true });
  });

  it("returns 404/409 responses to the caller for domain-specific handling", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { error: { code: "JOB_NOT_FOUND" } })
    );
    const notFound = await apiFetch("/jobs/abc");
    expect(notFound.status).toBe(404);

    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(409, { error: { code: "LIBRARY_FULL" } })
    );
    const conflict = await apiFetch("/jobs/abc", { method: "PUT", body: {} });
    expect(conflict.status).toBe(409);
  });
});
