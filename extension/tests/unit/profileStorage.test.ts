import { describe, it, expect, beforeEach } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import {
  getProfile,
  setProfile,
  clearProfile,
  profileToPromptText,
  PROFILE_TEXT_MAX,
} from "../../services/profileStorage";

beforeEach(() => {
  installMemoryStorage("local");
});

describe("profileStorage", () => {
  it("returns null when no profile is configured", async () => {
    await expect(getProfile()).resolves.toBeNull();
  });

  it("round-trips a profile and stamps updatedAt", async () => {
    await setProfile({
      text: "Principal .NET engineer, Azure, distributed systems",
      dealbreakers: ["no fully on-site roles"],
    });

    const profile = await getProfile();
    expect(profile!.text).toContain("Principal .NET engineer");
    expect(profile!.dealbreakers).toEqual(["no fully on-site roles"]);
    expect(new Date(profile!.updatedAt).toString()).not.toBe("Invalid Date");
  });

  it(`enforces the ${PROFILE_TEXT_MAX}-character limit`, async () => {
    await setProfile({ text: "x".repeat(PROFILE_TEXT_MAX + 500), dealbreakers: [] });
    const profile = await getProfile();
    expect(profile!.text).toHaveLength(PROFILE_TEXT_MAX);
  });

  it("clears the profile", async () => {
    await setProfile({ text: "something", dealbreakers: [] });
    await clearProfile();
    await expect(getProfile()).resolves.toBeNull();
  });

  it("serializes text and dealbreakers for the analysis request", () => {
    const prompt = profileToPromptText({
      text: "Senior TS engineer",
      dealbreakers: ["no on-site", "no crypto"],
      updatedAt: "2026-07-04T00:00:00Z",
    });
    expect(prompt).toContain("Senior TS engineer");
    expect(prompt).toContain("Dealbreakers:");
    expect(prompt).toContain("no on-site");
    expect(prompt).toContain("no crypto");
  });

  it("omits the dealbreaker section when none are set", () => {
    const prompt = profileToPromptText({
      text: "Senior TS engineer",
      dealbreakers: [],
      updatedAt: "2026-07-04T00:00:00Z",
    });
    expect(prompt).toBe("Senior TS engineer");
  });
});
