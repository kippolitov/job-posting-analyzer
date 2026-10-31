import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession } from "@/auth/authStore";
import { analyzeDocument } from "@/api/endpoints";
import { seedSession } from "../contract/helpers/session";

/**
 * The server ends an analysis at 50 s (functions/host.json functionTimeout), so
 * the web client must wait longer than that: a slow analysis that the server
 * completes, or answers with 504, has to reach the screen.
 */

const OK_BODY = JSON.stringify({ isJobPosting: true });

function slowFetch(delayMs: number): ReturnType<typeof vi.fn> {
  return vi.fn(
    () =>
      new Promise<Response>((resolve) =>
        setTimeout(() => resolve(new Response(OK_BODY, { status: 200 })), delayMs)
      )
  );
}

describe("analyzeDocument timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test/api");
    seedSession();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearSession();
  });

  it("still succeeds when the server answers after 45 s", async () => {
    vi.stubGlobal("fetch", slowFetch(45_000));
    const promise = analyzeDocument({ text: "A posting. ".repeat(40) });
    const assertion = expect(promise).resolves.toMatchObject({ isJobPosting: true });
    await vi.advanceTimersByTimeAsync(45_000);
    await assertion;
  });

  it("gives up only after the server's own 50 s limit has passed", async () => {
    vi.stubGlobal("fetch", slowFetch(10 * 60_000));
    const promise = analyzeDocument({ text: "A posting. ".repeat(40) });
    const assertion = expect(promise).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "The service timed out. Try again.",
    });
    await vi.advanceTimersByTimeAsync(55_000);
    await assertion;
  });

  it("keeps the 30 s limit for ordinary calls", async () => {
    vi.stubGlobal("fetch", slowFetch(10 * 60_000));
    const { fetchProfile } = await import("@/api/endpoints");
    const promise = fetchProfile();
    const assertion = expect(promise).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
