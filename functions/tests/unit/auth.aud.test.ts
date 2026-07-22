import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import {
  startCertsStub,
  stopCertsStub,
  signTestIdToken,
  TEST_CLIENT_ID,
} from "../helpers/testTokens";
import { withAuth } from "../../src/services/auth";

const WEB_CLIENT_ID = "web-client-id.apps.googleusercontent.com";

function makeRequest(authorization?: string, method = "POST"): HttpRequest {
  return {
    method,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? (authorization ?? null) : null,
    },
  } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return { log: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as InvocationContext;
}

const okHandler = vi.fn(
  (
    _request: HttpRequest,
    _context: InvocationContext,
    _user: { sub: string; email: string; tier: string }
  ) => Promise.resolve({ status: 200, jsonBody: { ok: true } })
);

describe("withAuth — audience set (contracts/web-auth.md)", () => {
  beforeAll(async () => {
    process.env.GOOGLE_OAUTH_CERTS_URL = await startCertsStub();
    process.env.GOOGLE_OAUTH_CLIENT_IDS = `${TEST_CLIENT_ID},${WEB_CLIENT_ID}`;
  });

  afterAll(async () => {
    await stopCertsStub();
    delete process.env.GOOGLE_OAUTH_CERTS_URL;
    delete process.env.GOOGLE_OAUTH_CLIENT_IDS;
    delete process.env.REQUIRE_AUTH;
  });

  beforeEach(() => {
    process.env.REQUIRE_AUTH = "true";
    okHandler.mockClear();
  });

  it("accepts a token minted for the extension client ID", async () => {
    const token = signTestIdToken({ aud: TEST_CLIENT_ID });
    const res = await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
  });

  it("accepts a token minted for the web client ID", async () => {
    const token = signTestIdToken({ aud: WEB_CLIENT_ID });
    const res = await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
  });

  it("401s a token for an unknown client ID", async () => {
    const token = signTestIdToken({ aud: "someone-else.apps.googleusercontent.com" });
    const res = await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
    expect(res.status).toBe(401);
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("falls back to GOOGLE_OAUTH_CLIENT_ID (single) when GOOGLE_OAUTH_CLIENT_IDS is unset", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_IDS;
    process.env.GOOGLE_OAUTH_CLIENT_ID = TEST_CLIENT_ID;
    try {
      const token = signTestIdToken({ aud: TEST_CLIENT_ID });
      const res = await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
      expect(res.status).toBe(200);
    } finally {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      process.env.GOOGLE_OAUTH_CLIENT_IDS = `${TEST_CLIENT_ID},${WEB_CLIENT_ID}`;
    }
  });

  it("still enforces signature verification unchanged for a multi-audience config", async () => {
    const token = signTestIdToken({ aud: WEB_CLIENT_ID }, { badSignature: true });
    const res = await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
    expect(res.status).toBe(401);
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("still enforces email_verified unchanged for a multi-audience config", async () => {
    const token = signTestIdToken({ aud: WEB_CLIENT_ID, email_verified: false });
    const res = await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
    expect(res.status).toBe(403);
    expect(res.jsonBody).toMatchObject({ error: { code: "NOT_AUTHORIZED" } });
  });
});
