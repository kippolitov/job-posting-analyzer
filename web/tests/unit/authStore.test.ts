import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clearSession,
  decodeIdToken,
  getSession,
  isExpired,
  needsSilentRefresh,
  setSession,
  subscribe,
} from "@/auth/authStore";

function base64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeToken(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  return `${header}.${payload}.fake-signature`;
}

describe("authStore (research.md R2 — in-memory only)", () => {
  beforeEach(() => {
    clearSession();
  });

  it("decodes sub/email/exp from a well-formed token", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeToken({ sub: "user-1", email: "a@example.com", exp });
    expect(decodeIdToken(token)).toEqual({ sub: "user-1", email: "a@example.com", exp });
  });

  it("returns null for a malformed token", () => {
    expect(decodeIdToken("not-a-jwt")).toBeNull();
    expect(decodeIdToken("a.b")).toBeNull();
  });

  it("returns null when required claims are missing", () => {
    const token = makeToken({ email: "a@example.com" });
    expect(decodeIdToken(token)).toBeNull();
  });

  it("setSession stores the session and getSession reflects it", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeToken({ sub: "user-1", email: "a@example.com", exp });
    const session = setSession(token);
    expect(session).toEqual({ idToken: token, sub: "user-1", email: "a@example.com", exp });
    expect(getSession()).toEqual(session);
  });

  it("setSession with a malformed token clears the session", () => {
    setSession(makeToken({ sub: "user-1", email: "a@example.com", exp: 1 }));
    setSession("garbage");
    expect(getSession()).toBeNull();
  });

  it("clearSession removes the session", () => {
    setSession(
      makeToken({
        sub: "user-1",
        email: "a@example.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    );
    clearSession();
    expect(getSession()).toBeNull();
  });

  it("notifies subscribers on every session change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setSession(
      makeToken({
        sub: "user-1",
        email: "a@example.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    );
    clearSession();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setSession(
      makeToken({
        sub: "user-2",
        email: "b@example.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("needsSilentRefresh is false with no session", () => {
    expect(needsSilentRefresh()).toBe(false);
  });

  it("needsSilentRefresh is true within the refresh window before exp", () => {
    const now = Date.now();
    const exp = Math.floor(now / 1000) + 30; // 30s out
    setSession(makeToken({ sub: "user-1", email: "a@example.com", exp }));
    expect(needsSilentRefresh(60_000, now)).toBe(true);
  });

  it("needsSilentRefresh is false well before the refresh window", () => {
    const now = Date.now();
    const exp = Math.floor(now / 1000) + 3600;
    setSession(makeToken({ sub: "user-1", email: "a@example.com", exp }));
    expect(needsSilentRefresh(60_000, now)).toBe(false);
  });

  it("isExpired is true with no session", () => {
    expect(isExpired()).toBe(true);
  });

  it("isExpired reflects the exp claim", () => {
    const now = Date.now();
    setSession(
      makeToken({ sub: "user-1", email: "a@example.com", exp: Math.floor(now / 1000) - 10 })
    );
    expect(isExpired(now)).toBe(true);

    setSession(
      makeToken({ sub: "user-1", email: "a@example.com", exp: Math.floor(now / 1000) + 10 })
    );
    expect(isExpired(now)).toBe(false);
  });
});
