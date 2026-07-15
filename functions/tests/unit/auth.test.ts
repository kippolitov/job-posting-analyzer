import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { randomUUID } from "node:crypto";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import {
  startCertsStub,
  stopCertsStub,
  signTestIdToken,
  TEST_CLIENT_ID,
} from "../helpers/testTokens";
import { withAuth } from "../../src/services/auth";
import { ensureTable } from "../../src/services/tablesService";
import { getByEmail, setBlocked, setTier } from "../../src/services/usersStore";

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
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as InvocationContext;
}

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

const okHandler = vi.fn(
  (
    _request: HttpRequest,
    _context: InvocationContext,
    _user: { sub: string; email: string; tier: string }
  ) => Promise.resolve({ status: 200, jsonBody: { ok: true } })
);

describe("withAuth middleware", () => {
  beforeAll(async () => {
    process.env.GOOGLE_OAUTH_CERTS_URL = await startCertsStub();
    process.env.GOOGLE_OAUTH_CLIENT_ID = TEST_CLIENT_ID;
  });

  afterAll(async () => {
    await stopCertsStub();
    delete process.env.GOOGLE_OAUTH_CERTS_URL;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.REQUIRE_AUTH;
  });

  beforeEach(() => {
    process.env.REQUIRE_AUTH = "true";
    okHandler.mockClear();
  });

  it("401 UNAUTHENTICATED when the Authorization header is missing", async () => {
    const res = await withAuth(okHandler)(makeRequest(), makeContext());
    expect(res.status).toBe(401);
    expect(res.jsonBody).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("401 UNAUTHENTICATED when the header is not a Bearer token", async () => {
    const res = await withAuth(okHandler)(
      makeRequest("Basic dXNlcjpwYXNz"),
      makeContext()
    );
    expect(res.status).toBe(401);
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("401 for a token signed by an unknown key (bad signature)", async () => {
    const token = signTestIdToken({}, { badSignature: true });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(401);
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("401 for a token with a foreign audience", async () => {
    const token = signTestIdToken({ aud: "someone-else.apps.googleusercontent.com" });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(401);
  });

  it("401 for a token from a non-Google issuer", async () => {
    const token = signTestIdToken({ iss: "https://evil.example.com" });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(401);
  });

  it("401 for an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = signTestIdToken({ iat: past - 3600, exp: past });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(401);
  });

  it("403 NOT_AUTHORIZED with verify-your-email copy when email_verified is false", async () => {
    const email = uniqueEmail();
    const token = signTestIdToken({ email, email_verified: false });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(403);
    expect(res.jsonBody).toMatchObject({ error: { code: "NOT_AUTHORIZED" } });
    const message = (res.jsonBody as { error: { message: string } }).error.message;
    expect(message.toLowerCase()).toMatch(/verifi/);
    expect(message.toLowerCase()).toMatch(/google/);
    expect(okHandler).not.toHaveBeenCalled();
    // Signup is never gated by an allowlist — no Users row should exist.
    expect(await getByEmail(email)).toBeNull();
  });

  it("first sign-in auto-creates a Users row on the free tier and proceeds", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    const token = signTestIdToken({ email, sub });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(okHandler.mock.calls[0][2]).toEqual({ sub, email, tier: "free" });

    const row = await getByEmail(email);
    expect(row?.tier).toBe("free");
    expect(row?.sub).toBe(sub);
  });

  it("an existing user's tier is attached to the handler call", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    // First sign-in creates the row (free); an admin flips it to premium.
    await withAuth(okHandler)(
      makeRequest(`Bearer ${signTestIdToken({ email, sub })}`),
      makeContext()
    );
    await setTier(email, "premium");
    okHandler.mockClear();

    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${signTestIdToken({ email, sub })}`),
      makeContext()
    );
    expect(res.status).toBe(200);
    expect(okHandler.mock.calls[0][2]).toEqual({ sub, email, tier: "premium" });
  });

  it("403 NOT_AUTHORIZED with contact-developer copy for a blocked account", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    await withAuth(okHandler)(
      makeRequest(`Bearer ${signTestIdToken({ email, sub })}`),
      makeContext()
    );
    await setBlocked(email, true);
    okHandler.mockClear();

    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${signTestIdToken({ email, sub })}`),
      makeContext()
    );
    expect(res.status).toBe(403);
    expect(res.jsonBody).toMatchObject({ error: { code: "NOT_AUTHORIZED" } });
    const message = (res.jsonBody as { error: { message: string } }).error.message;
    expect(message.toLowerCase()).toMatch(/contact/);
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("never consults the AllowedUsers table", async () => {
    // A completely unlisted AllowedUsers table must not matter — signup is
    // open. This would previously have 403'd as "not on the allowlist".
    await ensureTable("AllowedUsers");
    const email = uniqueEmail();
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${signTestIdToken({ email })}`),
      makeContext()
    );
    expect(res.status).toBe(200);
  });

  it("normalizes the email claim before the Users lookup", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    await withAuth(okHandler)(
      makeRequest(`Bearer ${signTestIdToken({ email, sub })}`),
      makeContext()
    );
    okHandler.mockClear();

    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${signTestIdToken({ email: email.toUpperCase(), sub })}`),
      makeContext()
    );
    expect(res.status).toBe(200);
  });

  it("passes OPTIONS preflight through without auth", async () => {
    const res = await withAuth(okHandler)(
      makeRequest(undefined, "OPTIONS"),
      makeContext()
    );
    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("REQUIRE_AUTH=false bypass passes unauthenticated requests through", async () => {
    process.env.REQUIRE_AUTH = "false";
    const res = await withAuth(okHandler)(makeRequest(), makeContext());
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(okHandler.mock.calls[0][2]).toMatchObject({ tier: "free" });
  });

  it("REQUIRE_AUTH=false still uses a valid token's identity when present", async () => {
    process.env.REQUIRE_AUTH = "false";
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    const token = signTestIdToken({ email, sub });
    await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
    expect(okHandler.mock.calls[0][2]).toMatchObject({ sub, email });
  });
});
