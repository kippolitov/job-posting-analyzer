import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getProfile,
  putProfile,
  deleteProfile,
} from "../../src/services/profileRepository";

function uniqueSub(): string {
  return `sub-${randomUUID()}`;
}

describe("profileRepository", () => {
  it("returns null for a user with no stored profile", async () => {
    await expect(getProfile(uniqueSub())).resolves.toBeNull();
  });

  it("round-trips a profile per sub", async () => {
    const sub = uniqueSub();
    const saved = await putProfile(sub, {
      text: "Principal .NET engineer",
      dealbreakers: ["no on-site", "no defense"],
    });
    expect(saved.text).toBe("Principal .NET engineer");
    expect(saved.dealbreakers).toEqual(["no on-site", "no defense"]);
    expect(Date.parse(saved.updatedAt)).not.toBeNaN();

    const loaded = await getProfile(sub);
    expect(loaded).toEqual(saved);
  });

  it("scopes profiles strictly per sub", async () => {
    const subA = uniqueSub();
    const subB = uniqueSub();
    await putProfile(subA, { text: "A's profile", dealbreakers: [] });
    await expect(getProfile(subB)).resolves.toBeNull();
  });

  it("truncates text at 20,000 characters (full-resume sized)", async () => {
    const sub = uniqueSub();
    const saved = await putProfile(sub, {
      text: "x".repeat(21_000),
      dealbreakers: [],
    });
    expect(saved.text).toHaveLength(20_000);
  });

  it("trims dealbreakers and drops empties", async () => {
    const sub = uniqueSub();
    const saved = await putProfile(sub, {
      text: "t",
      dealbreakers: ["  no crypto  ", "", "   ", "no gambling"],
    });
    expect(saved.dealbreakers).toEqual(["no crypto", "no gambling"]);
  });

  it("sets updatedAt server-side on every put", async () => {
    const sub = uniqueSub();
    const first = await putProfile(sub, { text: "v1", dealbreakers: [] });
    await new Promise((r) => setTimeout(r, 5));
    const second = await putProfile(sub, { text: "v2", dealbreakers: [] });
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(
      Date.parse(first.updatedAt)
    );
  });

  it("deleteProfile removes the row and is idempotent", async () => {
    const sub = uniqueSub();
    await putProfile(sub, { text: "t", dealbreakers: [] });
    await deleteProfile(sub);
    await expect(getProfile(sub)).resolves.toBeNull();
    await expect(deleteProfile(sub)).resolves.toBeUndefined();
  });
});
