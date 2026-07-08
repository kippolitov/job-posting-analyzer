import { describe, it, expect, vi, beforeEach } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import {
  signIn,
  signInSilently,
  signOut,
  getStoredAuth,
  getIdToken,
  markNotAuthorized,
  isNotAuthorized,
  AUTH_SESSION_KEY,
  SESSION_HORIZON_MS,
} from "../../services/auth/authService";
import type { StoredAuth } from "../../types/auth";

const REDIRECT_URL = "https://extension-id.chromiumapp.org/";
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeIdToken(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: "sub-123",
      email: "user@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    })
  );
  return `${header}.${payload}.fake-signature`;
}

/** Resolves the auth flow with a redirect carrying an id_token for the flow's own nonce. */
function resolveAuthFlowWithToken(extraClaims: Record<string, unknown> = {}): void {
  vi.mocked(chrome.identity.launchWebAuthFlow).mockImplementation((details) => {
    const nonce = new URL(details.url).searchParams.get("nonce");
    const token = makeIdToken({ nonce, ...extraClaims });
    return Promise.resolve(`${REDIRECT_URL}#id_token=${token}&other=1`);
  });
}

function storedAuthFixture(overrides: Partial<StoredAuth> = {}): StoredAuth {
  return {
    idToken: makeIdToken({}),
    expiresAt: Date.now() + 3600_000,
    signedInAt: Date.now() - 1000,
    user: { sub: "sub-123", email: "user@example.com" },
    ...overrides,
  };
}

describe("authService", () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    vi.stubGlobal("WXT_GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID);
    store = installMemoryStorage("local").store;
    vi.mocked(chrome.identity.getRedirectURL).mockReturnValue(REDIRECT_URL);
    vi.mocked(chrome.identity.launchWebAuthFlow).mockReset();
  });

  describe("signIn (interactive)", () => {
    it("builds an OIDC id_token auth URL with a fresh nonce and the chrome.identity redirect", async () => {
      resolveAuthFlowWithToken();
      await signIn();

      const details = vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls[0][0];
      expect(details.interactive).toBe(true);
      const url = new URL(details.url);
      expect(url.origin + url.pathname).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth"
      );
      expect(url.searchParams.get("response_type")).toBe("id_token");
      expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URL);
      expect(url.searchParams.get("scope")).toContain("openid");
      expect(url.searchParams.get("scope")).toContain("email");
      expect(url.searchParams.get("nonce")).toBeTruthy();

      resolveAuthFlowWithToken();
      await signIn();
      const secondUrl = new URL(
        vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls[1][0].url
      );
      expect(secondUrl.searchParams.get("nonce")).not.toBe(
        url.searchParams.get("nonce")
      );
    });

    it("parses the id_token from the redirect hash and persists it with exp and signedInAt", async () => {
      resolveAuthFlowWithToken();
      const before = Date.now();
      const auth = await signIn();

      expect(auth.user).toEqual({ sub: "sub-123", email: "user@example.com" });
      expect(auth.expiresAt).toBeGreaterThan(Date.now());
      expect(auth.signedInAt).toBeGreaterThanOrEqual(before);

      const stored = store.get(AUTH_SESSION_KEY) as StoredAuth;
      expect(stored.idToken).toBe(auth.idToken);
      expect(stored.expiresAt).toBe(auth.expiresAt);
      expect(stored.signedInAt).toBe(auth.signedInAt);
    });

    it("rejects a token whose nonce does not match the request", async () => {
      vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(
        `${REDIRECT_URL}#id_token=${makeIdToken({ nonce: "stale-nonce" })}`
      );
      await expect(signIn()).rejects.toThrow();
      expect(store.has(AUTH_SESSION_KEY)).toBe(false);
    });

    it("throws a canceled AuthError when the user dismisses the flow", async () => {
      vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValue(
        new Error("The user did not approve access.")
      );
      await expect(signIn()).rejects.toMatchObject({ code: "sign-in-canceled" });
    });

    it("clears a previous not-authorized flag on a new interactive sign-in", async () => {
      await markNotAuthorized();
      resolveAuthFlowWithToken();
      await signIn();
      await expect(isNotAuthorized()).resolves.toBe(false);
    });
  });

  describe("signInSilently", () => {
    it("renews with interactive:false and preserves signedInAt", async () => {
      const original = storedAuthFixture({ signedInAt: Date.now() - 5 * 86_400_000 });
      store.set(AUTH_SESSION_KEY, original);
      resolveAuthFlowWithToken();

      const renewed = await signInSilently();
      expect(renewed).not.toBeNull();
      expect(
        vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls[0][0].interactive
      ).toBe(false);
      expect(renewed!.signedInAt).toBe(original.signedInAt);
      expect((store.get(AUTH_SESSION_KEY) as StoredAuth).signedInAt).toBe(
        original.signedInAt
      );
    });

    it("returns null instead of throwing when the silent flow fails", async () => {
      store.set(AUTH_SESSION_KEY, storedAuthFixture());
      vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValue(
        new Error("User interaction required.")
      );
      await expect(signInSilently()).resolves.toBeNull();
    });

    it("returns null when there is no stored session to renew", async () => {
      await expect(signInSilently()).resolves.toBeNull();
      expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    });

    it("refuses renewal past the 30-day horizon without attempting the flow (FR-014a)", async () => {
      store.set(
        AUTH_SESSION_KEY,
        storedAuthFixture({ signedInAt: Date.now() - SESSION_HORIZON_MS - 1000 })
      );
      await expect(signInSilently()).resolves.toBeNull();
      expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    });
  });

  describe("getIdToken", () => {
    it("returns the cached token while it is fresh", async () => {
      const auth = storedAuthFixture();
      store.set(AUTH_SESSION_KEY, auth);
      await expect(getIdToken()).resolves.toBe(auth.idToken);
      expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    });

    it("silently renews an expired token", async () => {
      store.set(AUTH_SESSION_KEY, storedAuthFixture({ expiresAt: Date.now() - 1 }));
      resolveAuthFlowWithToken();
      const token = await getIdToken();
      expect(token).toBeTruthy();
      expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1);
    });

    it("returns null when expired and renewal fails", async () => {
      store.set(AUTH_SESSION_KEY, storedAuthFixture({ expiresAt: Date.now() - 1 }));
      vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValue(new Error("no"));
      await expect(getIdToken()).resolves.toBeNull();
    });
  });

  describe("signOut / stored state", () => {
    it("signOut clears the stored session", async () => {
      store.set(AUTH_SESSION_KEY, storedAuthFixture());
      await signOut();
      expect(store.has(AUTH_SESSION_KEY)).toBe(false);
      await expect(getStoredAuth()).resolves.toBeNull();
    });

    it("markNotAuthorized clears the session and flags the invitation state", async () => {
      store.set(AUTH_SESSION_KEY, storedAuthFixture());
      await markNotAuthorized();
      await expect(getStoredAuth()).resolves.toBeNull();
      await expect(isNotAuthorized()).resolves.toBe(true);
    });
  });
});
