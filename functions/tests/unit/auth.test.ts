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

async function allowlist(email: string): Promise<void> {
  const client = await ensureTable("AllowedUsers");
  await client.createEntity({
    partitionKey: "AllowedUser",
    rowKey: email.toLowerCase(),
    addedAt: new Date().toISOString(),
  });
}

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

const okHandler = vi.fn(
  (
    _request: HttpRequest,
    _context: InvocationContext,
    _user: { sub: string; email: string }
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

  it("403 NOT_AUTHORIZED when email_verified is false, even if allowlisted", async () => {
    const email = uniqueEmail();
    await allowlist(email);
    const token = signTestIdToken({ email, email_verified: false });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(403);
    expect(res.jsonBody).toMatchObject({ error: { code: "NOT_AUTHORIZED" } });
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("403 NOT_AUTHORIZED for a valid token not on the allowlist — handler never runs", async () => {
    const token = signTestIdToken({ email: uniqueEmail() });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(403);
    expect(res.jsonBody).toMatchObject({ error: { code: "NOT_AUTHORIZED" } });
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("invokes the handler with { sub, email } for an allowlisted user", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    await allowlist(email);
    const token = signTestIdToken({ email, sub });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
      makeContext()
    );
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(okHandler.mock.calls[0][2]).toEqual({ sub, email });
  });

  it("records the sub on the allowlist row on first sign-in", async () => {
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    await allowlist(email);
    const token = signTestIdToken({ email, sub });
    await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
    const client = await ensureTable("AllowedUsers");
    const row = await client.getEntity("AllowedUser", email.toLowerCase());
    expect(row.sub).toBe(sub);
  });

  it("normalizes the email claim before the allowlist lookup", async () => {
    const email = uniqueEmail();
    await allowlist(email);
    const token = signTestIdToken({ email: email.toUpperCase() });
    const res = await withAuth(okHandler)(
      makeRequest(`Bearer ${token}`),
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
  });

  it("REQUIRE_AUTH=false still uses a valid token's identity when present", async () => {
    process.env.REQUIRE_AUTH = "false";
    const email = uniqueEmail();
    const sub = `sub-${randomUUID()}`;
    await allowlist(email);
    const token = signTestIdToken({ email, sub });
    await withAuth(okHandler)(makeRequest(`Bearer ${token}`), makeContext());
    expect(okHandler.mock.calls[0][2]).toEqual({ sub, email });
  });
});
