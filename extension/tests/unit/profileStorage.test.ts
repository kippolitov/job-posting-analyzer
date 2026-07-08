import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import {
  getProfile,
  setProfile,
  clearProfile,
  profileToPromptText,
  PROFILE_TEXT_MAX,
} from "../../services/profileStorage";
import {
  getIdToken,
  markNotAuthorized,
  signInSilently,
  signOut,
} from "../../services/auth/authService";
import {
  createFakeStorageApi,
  stubApiBaseGlobals,
} from "./helpers/mswStorageServer";

vi.mock("../../services/auth/authService", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-id-token"),
  signInSilently: vi.fn().mockResolvedValue(null),
  signOut: vi.fn().mockResolvedValue(undefined),
  markNotAuthorized: vi.fn().mockResolvedValue(undefined),
}));

const api = createFakeStorageApi();

beforeAll(() => api.server.listen({ onUnhandledRequest: "error" }));
afterAll(() => api.server.close());

beforeEach(() => {
  api.reset();
  stubApiBaseGlobals();
  vi.mocked(getIdToken).mockReset().mockResolvedValue("test-id-token");
  vi.mocked(signInSilently).mockReset().mockResolvedValue(null);
  vi.mocked(signOut).mockClear();
  vi.mocked(markNotAuthorized).mockClear();
});

describe("profileStorage (fetch-backed, contracts/storage-api.md)", () => {
  it("getProfile returns null when the server has no profile (404)", async () => {
    await expect(getProfile()).resolves.toBeNull();
  });

  it("setProfile PUTs and getProfile round-trips the server copy", async () => {
    const saved = await setProfile({
      text: "Principal engineer",
      dealbreakers: [" no crypto ", ""],
    });
    expect(saved.text).toBe("Principal engineer");
    expect(saved.dealbreakers).toEqual(["no crypto"]);
    expect(api.getProfile()).not.toBeNull();

    const loaded = await getProfile();
    expect(loaded).toEqual(saved);
  });

  it("keeps the PROFILE_TEXT_MAX export for the editor's counter", () => {
    expect(PROFILE_TEXT_MAX).toBe(4_000);
  });

  it("clearProfile DELETEs the server copy", async () => {
    await setProfile({ text: "x", dealbreakers: [] });
    await clearProfile();
    expect(api.getProfile()).toBeNull();
    await expect(getProfile()).resolves.toBeNull();
  });

  it("profileToPromptText is unchanged (pure serialization)", () => {
    expect(
      profileToPromptText({
        text: "Engineer",
        dealbreakers: ["no on-site"],
        updatedAt: "2026-07-07T00:00:00Z",
      })
    ).toBe("Engineer\n\nDealbreakers:\n- no on-site");
  });

  it("on 401: renews once then signs out (gate) when renewal fails", async () => {
    api.failNext(401);
    await expect(getProfile()).rejects.toThrow();
    expect(signInSilently).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalled();
  });

  it("on 403: marks the session not-authorized (invitation state)", async () => {
    api.failNext(403);
    await expect(getProfile()).rejects.toThrow();
    expect(markNotAuthorized).toHaveBeenCalled();
  });

  it("surfaces 5xx as retryable, never as an empty profile (FR-015)", async () => {
    api.setProfile({
      text: "existing",
      dealbreakers: [],
      updatedAt: "2026-07-07T00:00:00Z",
    });
    api.failNext(500);
    await expect(getProfile()).rejects.toMatchObject({ retryable: true });
  });
});
