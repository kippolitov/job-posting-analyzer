import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getProfile,
  putProfile,
  deleteProfile,
} from "../../src/services/profileRepository";
import { profileFingerprint } from "../../src/services/profileFingerprint";
import { ensureTable } from "../../src/services/tablesService";
import { profileToPromptText } from "../../../shared/types/profile";

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

  describe("006 fingerprints and merge PUT (contracts/profile-api.md)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function readRow(sub: string): Promise<Record<string, unknown>> {
      const client = await ensureTable("Profiles");
      return client.getEntity<Record<string, unknown>>(sub, "profile");
    }

    it("GET and PUT return the fingerprint of the serialized profile", async () => {
      const sub = uniqueSub();
      const input = { text: "Engineer", dealbreakers: ["Remote only"] };
      const saved = await putProfile(sub, input);
      const expected = profileFingerprint(profileToPromptText(input));
      expect(saved.fingerprint).toBe(expected);
      expect((await getProfile(sub))?.fingerprint).toBe(expected);
    });

    it("a PUT without preferences or confirmedSkills keeps the stored columns (trap 2)", async () => {
      const sub = uniqueSub();
      await putProfile(sub, { text: "v1", dealbreakers: [] });
      const client = await ensureTable("Profiles");
      await client.updateEntity(
        {
          partitionKey: sub,
          rowKey: "profile",
          preferences: JSON.stringify({ arrangements: ["remote"] }),
          confirmedSkills: JSON.stringify(["Terraform"]),
        },
        "Merge"
      );

      await putProfile(sub, { text: "v2", dealbreakers: ["Remote only"] });

      const row = await readRow(sub);
      expect(row.text).toBe("v2");
      expect(JSON.parse(row.preferences as string)).toEqual({ arrangements: ["remote"] });
      expect(JSON.parse(row.confirmedSkills as string)).toEqual(["Terraform"]);
    });

    it("preferences: null clears stored preferences", async () => {
      const sub = uniqueSub();
      await putProfile(sub, {
        text: "v1",
        dealbreakers: [],
        preferences: { arrangements: ["remote"] },
      });
      await putProfile(sub, { text: "v1", dealbreakers: [], preferences: null });
      const row = await readRow(sub);
      expect(row.preferences ?? null).toBeNull();
    });

    it("prepends the previous fingerprint to history only when it changes, capped at 20, never returned", async () => {
      const sub = uniqueSub();
      const first = await putProfile(sub, { text: "v0", dealbreakers: [] });
      await putProfile(sub, { text: "v1", dealbreakers: [] });
      let row = await readRow(sub);
      expect(JSON.parse(row.fingerprintHistory as string)).toEqual([first.fingerprint]);

      await putProfile(sub, { text: "  v1 ", dealbreakers: [] });
      row = await readRow(sub);
      expect(JSON.parse(row.fingerprintHistory as string)).toEqual([first.fingerprint]);

      for (let i = 2; i <= 25; i++) {
        await putProfile(sub, { text: `v${i}`, dealbreakers: [] });
      }
      row = await readRow(sub);
      const history = JSON.parse(row.fingerprintHistory as string) as string[];
      expect(history).toHaveLength(20);
      expect(history[0]).toBe(profileFingerprint("v24"));
      expect(history).not.toContain(first.fingerprint);

      const loaded = await getProfile(sub);
      expect(loaded).not.toHaveProperty("fingerprintHistory");
    });

    it("a whitespace-only PUT leaves fingerprint and history unchanged", async () => {
      const sub = uniqueSub();
      const before = await putProfile(sub, { text: "Engineer", dealbreakers: ["Remote only"] });
      const after = await putProfile(sub, {
        text: "Engineer \n",
        dealbreakers: ["Remote only"],
      });
      expect(after.fingerprint).toBe(before.fingerprint);
      const row = await readRow(sub);
      expect(JSON.parse((row.fingerprintHistory as string | undefined) ?? "[]")).toEqual([]);
    });

    it("writes schemaVersion 2 (PR4)", async () => {
      const sub = uniqueSub();
      await putProfile(sub, { text: "v1", dealbreakers: [] });
      expect((await readRow(sub)).schemaVersion).toBe(2);
    });

    it("reads a version-1 row as having no preferences", async () => {
      const sub = uniqueSub();
      const client = await ensureTable("Profiles");
      await client.createEntity({
        partitionKey: sub,
        rowKey: "profile",
        text: "old",
        dealbreakers: "[]",
        updatedAt: new Date().toISOString(),
        schemaVersion: 1,
      });
      const loaded = await getProfile(sub);
      expect(loaded?.text).toBe("old");
      expect(loaded).not.toHaveProperty("preferences");
    });

    it("includes preferences in the fingerprint", async () => {
      const sub = uniqueSub();
      const plain = await putProfile(sub, { text: "CV", dealbreakers: [] });
      const withPrefs = await putProfile(sub, {
        text: "CV",
        dealbreakers: [],
        preferences: { arrangements: ["remote"] },
      });
      expect(withPrefs.fingerprint).not.toBe(plain.fingerprint);
      expect(withPrefs.fingerprint).toBe(
        profileFingerprint(
          profileToPromptText({
            text: "CV",
            dealbreakers: [],
            preferences: { arrangements: ["remote"] },
          })
        )
      );
    });

    it("retries a PUT that loses an ETag race and keeps both changes", async () => {
      const sub = uniqueSub();
      await putProfile(sub, { text: "v1", dealbreakers: [] });

      // The repository uses ensureTable's cached client, so spy on that instance.
      const client = await ensureTable("Profiles");
      const original = client.updateEntity.bind(client);
      let raced = false;
      const spy = vi
        .spyOn(client, "updateEntity")
        .mockImplementation(async (...args: Parameters<typeof original>) => {
          if (!raced) {
            raced = true;
            // Another writer lands between our read and our write.
            await original(
              {
                partitionKey: sub,
                rowKey: "profile",
                confirmedSkills: JSON.stringify(["Terraform"]),
              },
              "Merge"
            );
          }
          return original(...args);
        });

      await putProfile(sub, { text: "v2", dealbreakers: ["Remote only"] });
      expect(spy).toHaveBeenCalledTimes(2);

      const row = await readRow(sub);
      expect(row.text).toBe("v2");
      expect(JSON.parse(row.confirmedSkills as string)).toEqual(["Terraform"]);
    });
  });
});
