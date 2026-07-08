import { describe, it, expect, vi, beforeEach } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi } from "./helpers/mswStorageServer";
import {
  detectLegacyData,
  runMigration,
  declineMigration,
  MIGRATION_MARKER_KEY,
} from "../../services/migrationService";
import type { CandidateProfile, SavedJob } from "../../types/job";

vi.mock("../../services/auth/authService", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-id-token"),
  signInSilently: vi.fn().mockResolvedValue(null),
  signOut: vi.fn().mockResolvedValue(undefined),
  markNotAuthorized: vi.fn().mockResolvedValue(undefined),
}));

const api = installFakeStorageApi();

function makeProfile(text = "Legacy profile"): CandidateProfile {
  return { text, dealbreakers: ["no crypto"], updatedAt: "2026-06-01T00:00:00Z" };
}

function makeJob(canonicalUrl: string, notes = ""): SavedJob {
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    analysis: {
      isJobPosting: true,
      title: "Legacy Role",
      company: "Acme",
      location: null,
      arrangement: "remote",
      arrangementConfidence: "explicit",
      arrangementEvidence: null,
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "senior",
      techStack: [],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-06-01T00:00:00Z",
    },
    status: "interested",
    notes,
    savedAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  };
}

async function keyFor(url: string): Promise<string> {
  return api.seededKey(url);
}

describe("migrationService", () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    store = installMemoryStorage("local").store;
  });

  async function seedLegacy(options: {
    profile?: CandidateProfile;
    jobs?: SavedJob[];
  }): Promise<void> {
    if (options.profile) store.set("profile", options.profile);
    for (const job of options.jobs ?? []) {
      store.set(`job:${await keyFor(job.canonicalUrl)}`, job);
    }
    if ((options.jobs ?? []).length > 0) store.set("job:index", {});
  }

  describe("detectLegacyData", () => {
    it("detects a legacy profile and jobs when no marker exists", async () => {
      await seedLegacy({
        profile: makeProfile(),
        jobs: [makeJob("https://a.example/1")],
      });
      const detected = await detectLegacyData();
      expect(detected).not.toBeNull();
      expect(detected!.profile?.text).toBe("Legacy profile");
      expect(detected!.jobs).toHaveLength(1);
    });

    it("detects jobs-only and profile-only data", async () => {
      await seedLegacy({ jobs: [makeJob("https://a.example/1")] });
      expect((await detectLegacyData())!.profile).toBeNull();

      store.clear();
      await seedLegacy({ profile: makeProfile() });
      expect((await detectLegacyData())!.jobs).toEqual([]);
    });

    it("returns null when the one-time marker exists (completed or declined)", async () => {
      await seedLegacy({ profile: makeProfile() });
      store.set(MIGRATION_MARKER_KEY, { status: "declined", at: "2026-07-01" });
      await expect(detectLegacyData()).resolves.toBeNull();
    });

    it("returns null when there is no legacy data", async () => {
      await expect(detectLegacyData()).resolves.toBeNull();
    });
  });

  describe("runMigration — accept path", () => {
    it("uploads legacy jobs and the profile, writes the marker, deletes legacy keys", async () => {
      const job = makeJob("https://a.example/1");
      await seedLegacy({ profile: makeProfile(), jobs: [job] });
      const data = (await detectLegacyData())!;

      const result = await runMigration(data, {
        resolveProfileConflict: vi.fn(),
      });

      expect(result.status).toBe("completed");
      expect(result.uploadedJobs).toBe(1);
      expect(result.skippedDuplicates).toBe(0);
      expect(api.jobs.size).toBe(1);
      expect(api.getProfile()?.text).toBe("Legacy profile");

      const marker = store.get(MIGRATION_MARKER_KEY) as { status: string };
      expect(marker.status).toBe("completed");
      expect(store.has("profile")).toBe(false);
      expect(store.has("job:index")).toBe(false);
      expect(
        [...store.keys()].filter((k) => k.startsWith("job:"))
      ).toEqual([]);
    });

    it("counts duplicates and lets server-existing entries win (FR-011)", async () => {
      const serverCopy = makeJob("https://a.example/1", "server notes");
      api.jobs.set(await keyFor(serverCopy.canonicalUrl), serverCopy);
      await seedLegacy({
        jobs: [makeJob("https://a.example/1", "local notes"), makeJob("https://a.example/2")],
      });
      const data = (await detectLegacyData())!;

      const result = await runMigration(data, {
        resolveProfileConflict: vi.fn(),
      });

      expect(result.status).toBe("completed");
      expect(result.uploadedJobs).toBe(1);
      expect(result.skippedDuplicates).toBe(1);
      const stored = api.jobs.get(await keyFor("https://a.example/1"))!;
      expect(stored.notes).toBe("server notes");
    });

    it("resolves a profile conflict by explicit user choice — keep local", async () => {
      api.setProfile({
        text: "Server profile",
        dealbreakers: [],
        updatedAt: "2026-07-01T00:00:00Z",
      });
      await seedLegacy({ profile: makeProfile("Local profile") });
      const choose = vi.fn().mockResolvedValue("local");

      const result = await runMigration((await detectLegacyData())!, {
        resolveProfileConflict: choose,
      });

      expect(choose).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("completed");
      expect(result.profileOutcome).toBe("uploaded");
      expect(api.getProfile()?.text).toBe("Local profile");
    });

    it("resolves a profile conflict by explicit user choice — keep server", async () => {
      api.setProfile({
        text: "Server profile",
        dealbreakers: [],
        updatedAt: "2026-07-01T00:00:00Z",
      });
      await seedLegacy({ profile: makeProfile("Local profile") });

      const result = await runMigration((await detectLegacyData())!, {
        resolveProfileConflict: vi.fn().mockResolvedValue("server"),
      });

      expect(result.status).toBe("completed");
      expect(result.profileOutcome).toBe("kept-server");
      expect(api.getProfile()?.text).toBe("Server profile");
    });

    it("surfaces cap overflow without writing the marker or deleting local data", async () => {
      api.setCap(0);
      await seedLegacy({ jobs: [makeJob("https://a.example/1")] });
      const data = (await detectLegacyData())!;

      const result = await runMigration(data, {
        resolveProfileConflict: vi.fn(),
      });

      expect(result.status).toBe("cap-blocked");
      expect(store.has(MIGRATION_MARKER_KEY)).toBe(false);
      expect(
        [...store.keys()].filter((k) => k.startsWith("job:") && k !== "job:index")
      ).toHaveLength(1);
    });

    it("leaves local data intact and writes no marker on partial failure; retry converges", async () => {
      const jobs = [makeJob("https://a.example/1"), makeJob("https://a.example/2")];
      await seedLegacy({ jobs });
      const data = (await detectLegacyData())!;

      // First PUT succeeds, then the server starts failing mid-run.
      let putCount = 0;
      api.server.events.on("request:start", ({ request }) => {
        if (request.method === "PUT" && ++putCount === 2) {
          api.failNext(500);
        }
      });

      const failed = await runMigration(data, {
        resolveProfileConflict: vi.fn(),
      });
      expect(failed.status).toBe("failed");
      expect(store.has(MIGRATION_MARKER_KEY)).toBe(false);
      expect(
        [...store.keys()].filter((k) => k.startsWith("job:") && k !== "job:index")
      ).toHaveLength(2);

      // Retry: idempotent uploads converge (the already-uploaded job is a duplicate).
      api.server.events.removeAllListeners();
      const retry = await runMigration((await detectLegacyData())!, {
        resolveProfileConflict: vi.fn(),
      });
      expect(retry.status).toBe("completed");
      expect(retry.uploadedJobs + retry.skippedDuplicates).toBe(2);
      expect(api.jobs.size).toBe(2);
    });
  });

  describe("declineMigration", () => {
    it("writes the declined marker and touches nothing else", async () => {
      await seedLegacy({
        profile: makeProfile(),
        jobs: [makeJob("https://a.example/1")],
      });
      await declineMigration();

      const marker = store.get(MIGRATION_MARKER_KEY) as { status: string; at: string };
      expect(marker.status).toBe("declined");
      expect(typeof marker.at).toBe("string");
      expect(store.has("profile")).toBe(true);
      expect(api.jobs.size).toBe(0);

      // Never re-offered on this device.
      await expect(detectLegacyData()).resolves.toBeNull();
    });
  });
});
