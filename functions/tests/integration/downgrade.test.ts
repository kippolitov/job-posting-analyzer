import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  saveJob,
  getJob,
  listJobs,
  patchJob,
  deleteJob,
  countJobs,
  exportJobs,
  LibraryCapError,
} from "../../src/services/savedJobsRepository";
import type { SavedJobPayload } from "../../src/models/user";

/**
 * FR-021..023: downgrade is data-touchless — the webhook flips tier alone,
 * and the tier-aware cap check (already tier-dependent per T017) does the
 * rest. This test proves the interaction; it needs no new production code
 * (tasks.md T033 note).
 */

function uniqueSub(): string {
  return `sub-${randomUUID()}`;
}

function keyOf(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}

function makeJob(overrides: Partial<SavedJobPayload> = {}): SavedJobPayload {
  const canonicalUrl =
    overrides.canonicalUrl ?? `https://example.com/jobs/${randomUUID()}`;
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    analysis: {
      isJobPosting: true,
      title: "Senior Engineer",
      company: "Acme",
      location: "Remote",
      arrangement: "remote",
      arrangementConfidence: "explicit",
      arrangementEvidence: "fully remote",
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "senior",
      techStack: [],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-07-04T12:00:04Z",
    },
    status: "interested",
    notes: "",
    savedAt: "2026-07-04T12:01:00.000Z",
    updatedAt: "2026-07-04T12:01:00.000Z",
    ...overrides,
  } as SavedJobPayload;
}

describe("downgrade — over-cap library stays read-only-for-additions (FR-021..023)", () => {
  it(
    "a 400-job library survives a premium→free flip: list/get/update/delete/export succeed, new save 409s",
    async () => {
      const sub = uniqueSub();
      const { fillPartitionForTests } = await import("../helpers/savedJobsSeeder");
      await fillPartitionForTests(sub, 400);
      await expect(countJobs(sub)).resolves.toBe(400);

      // Premium tier: still well under the 1,000 cap.
      const existingKey = "https://seeded.example/jobs/0";
      await expect(
        saveJob(sub, keyOf(existingKey), makeJob({ canonicalUrl: existingKey }), "premium")
      ).resolves.toMatchObject({ canonicalUrl: existingKey });

      // Downgrade (webhook flips tier alone — nothing here touches the data).
      const list = await listJobs(sub, {});
      expect(list).toHaveLength(400);
      const get = await getJob(sub, keyOf(existingKey));
      expect(get).not.toBeNull();
      const patched = await patchJob(sub, keyOf(existingKey), { notes: "still editable" });
      expect(patched?.notes).toBe("still editable");
      const exported = await exportJobs(sub);
      expect(exported.jobs).toHaveLength(400);

      // New save is blocked at the free cap (100) even though 400 < premium's 1,000.
      const newJob = makeJob();
      await expect(
        saveJob(sub, keyOf(newJob.canonicalUrl), newJob, "free")
      ).rejects.toBeInstanceOf(LibraryCapError);

      // Deletes still work over-cap.
      await expect(
        deleteJob(sub, keyOf(existingKey))
      ).resolves.toBeUndefined();
      await expect(countJobs(sub)).resolves.toBe(399);
    },
    60_000
  );

  it("deleting down to the free cap restores saves; re-upgrading restores the 1,000 cap", async () => {
    const sub = uniqueSub();
    const { fillPartitionForTests } = await import("../helpers/savedJobsSeeder");
    await fillPartitionForTests(sub, 100);
    await expect(countJobs(sub)).resolves.toBe(100);

    const blockedJob = makeJob();
    await expect(
      saveJob(sub, keyOf(blockedJob.canonicalUrl), blockedJob, "free")
    ).rejects.toBeInstanceOf(LibraryCapError);

    // Delete one to drop to 99 — a new free-tier save now succeeds.
    await deleteJob(sub, keyOf("https://seeded.example/jobs/0"));
    await expect(countJobs(sub)).resolves.toBe(99);
    await expect(
      saveJob(sub, keyOf(blockedJob.canonicalUrl), blockedJob, "free")
    ).resolves.toMatchObject({ canonicalUrl: blockedJob.canonicalUrl });
    await expect(countJobs(sub)).resolves.toBe(100);

    // Re-upgrade restores headroom up to 1,000.
    const anotherJob = makeJob();
    await expect(
      saveJob(sub, keyOf(anotherJob.canonicalUrl), anotherJob, "premium")
    ).resolves.toMatchObject({ canonicalUrl: anotherJob.canonicalUrl });
  }, 30_000);
});
