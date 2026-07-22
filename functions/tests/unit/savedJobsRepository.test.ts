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
  pruneArchived,
  sha256Hex,
  KeyMismatchError,
  ImmutableFieldError,
  LibraryCapError,
  SAVED_JOBS_SOFT_CAP,
} from "../../src/services/savedJobsRepository";
import type { SavedJobPayload } from "../../src/models/user";

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
    sourceUrl: `${canonicalUrl}?utm_source=x`,
    analysis: {
      isJobPosting: true,
      title: "Senior Engineer",
      company: "Acme",
      location: "Austin, TX",
      arrangement: "hybrid",
      arrangementConfidence: "explicit",
      arrangementEvidence: "3 days in office",
      daysInOffice: 3,
      daysRemote: 2,
      remoteRestrictions: null,
      salary: null,
      seniority: "senior",
      techStack: ["TypeScript"],
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

describe("savedJobsRepository.saveJob", () => {
  it("stores under RowKey = sha256(canonicalUrl) and round-trips the full record", async () => {
    const sub = uniqueSub();
    const job = makeJob();
    const key = keyOf(job.canonicalUrl);

    const saved = await saveJob(sub, key, job);
    expect(saved.canonicalUrl).toBe(job.canonicalUrl);

    const loaded = await getJob(sub, key);
    expect(loaded).not.toBeNull();
    expect(loaded!.analysis).toEqual(job.analysis);
    expect(loaded!.status).toBe("interested");
    expect(loaded!.savedAt).toBe(job.savedAt);
  });

  it("rejects a key that does not match sha256(canonicalUrl)", async () => {
    const job = makeJob();
    await expect(
      saveJob(uniqueSub(), keyOf("https://other.example/job"), job)
    ).rejects.toBeInstanceOf(KeyMismatchError);
  });

  it("preserves the stored savedAt on replace and refreshes updatedAt", async () => {
    const sub = uniqueSub();
    const job = makeJob({ savedAt: "2026-07-01T00:00:00.000Z" });
    const key = keyOf(job.canonicalUrl);
    await saveJob(sub, key, job);

    const replacement = makeJob({
      canonicalUrl: job.canonicalUrl,
      savedAt: "2099-01-01T00:00:00.000Z",
      notes: "replaced",
    });
    const replaced = await saveJob(sub, key, replacement);
    expect(replaced.savedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(replaced.notes).toBe("replaced");
    expect(Date.parse(replaced.updatedAt)).toBeGreaterThan(
      Date.parse(job.updatedAt)
    );
  });

  it("sha256Hex matches the client canonicalKey digest", () => {
    const url = "https://boards.greenhouse.io/acme/jobs/123";
    expect(sha256Hex(url)).toBe(keyOf(url));
  });
});

describe("savedJobsRepository cap behavior", () => {
  it("rejects a NEW row at the premium cap (1,000) but allows replacing an existing one", async () => {
    const sub = uniqueSub();
    // Fill the partition to the cap via batched direct inserts (fast path).
    const { fillPartitionForTests } = await import(
      "../helpers/savedJobsSeeder"
    );
    await fillPartitionForTests(sub, SAVED_JOBS_SOFT_CAP);

    const newJob = makeJob();
    await expect(
      saveJob(sub, keyOf(newJob.canonicalUrl), newJob, "premium")
    ).rejects.toBeInstanceOf(LibraryCapError);

    // Replace of an existing row must still succeed.
    const existingUrl = "https://seeded.example/jobs/0";
    const replacement = makeJob({ canonicalUrl: existingUrl, notes: "updated" });
    await expect(
      saveJob(sub, keyOf(existingUrl), replacement, "premium")
    ).resolves.toMatchObject({ notes: "updated" });

    await expect(countJobs(sub)).resolves.toBe(SAVED_JOBS_SOFT_CAP);
  }, 120_000);

  it("rejects a NEW row at the free cap (100) even though the premium cap is far off", async () => {
    const sub = uniqueSub();
    const { fillPartitionForTests } = await import(
      "../helpers/savedJobsSeeder"
    );
    await fillPartitionForTests(sub, 100);

    const newJob = makeJob();
    await expect(
      saveJob(sub, keyOf(newJob.canonicalUrl), newJob, "free")
    ).rejects.toBeInstanceOf(LibraryCapError);
  }, 30_000);

  it("allows a 101st free-tier row once the account is premium", async () => {
    const sub = uniqueSub();
    const { fillPartitionForTests } = await import(
      "../helpers/savedJobsSeeder"
    );
    await fillPartitionForTests(sub, 100);

    const newJob = makeJob();
    await expect(
      saveJob(sub, keyOf(newJob.canonicalUrl), newJob, "premium")
    ).resolves.toMatchObject({ canonicalUrl: newJob.canonicalUrl });
  }, 30_000);

  it("updates/deletes on an over-cap (downgraded) library still succeed — only new rows are blocked", async () => {
    const sub = uniqueSub();
    const { fillPartitionForTests } = await import(
      "../helpers/savedJobsSeeder"
    );
    await fillPartitionForTests(sub, 100);

    const existingUrl = "https://seeded.example/jobs/0";
    const replacement = makeJob({ canonicalUrl: existingUrl, notes: "still editable" });
    await expect(
      saveJob(sub, keyOf(existingUrl), replacement, "free")
    ).resolves.toMatchObject({ notes: "still editable" });

    await expect(deleteJob(sub, keyOf(existingUrl))).resolves.toBeUndefined();
    await expect(countJobs(sub)).resolves.toBe(99);
  }, 30_000);
});

describe("savedJobsRepository.listJobs", () => {
  it("filters by arrangement and status, sorted savedAt descending", async () => {
    const sub = uniqueSub();
    const older = makeJob({ savedAt: "2026-07-01T00:00:00.000Z" });
    const newer = makeJob({ savedAt: "2026-07-03T00:00:00.000Z" });
    const remote = makeJob({ savedAt: "2026-07-02T00:00:00.000Z" });
    remote.analysis = { ...remote.analysis, arrangement: "remote" };
    const archived = makeJob({
      savedAt: "2026-07-04T00:00:00.000Z",
      status: "archived",
    });
    for (const job of [older, newer, remote, archived]) {
      await saveJob(sub, keyOf(job.canonicalUrl), job);
    }

    const all = await listJobs(sub, {});
    expect(all.map((j) => j.savedAt)).toEqual([
      "2026-07-04T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    ]);

    const hybridOnly = await listJobs(sub, { arrangement: "hybrid" });
    expect(hybridOnly).toHaveLength(3);
    const archivedOnly = await listJobs(sub, { status: "archived" });
    expect(archivedOnly).toHaveLength(1);
    expect(archivedOnly[0].canonicalUrl).toBe(archived.canonicalUrl);
  });

  it("returns only the requesting sub's jobs", async () => {
    const subA = uniqueSub();
    const subB = uniqueSub();
    const job = makeJob();
    await saveJob(subA, keyOf(job.canonicalUrl), job);
    await expect(listJobs(subB, {})).resolves.toEqual([]);
  });
});

describe("savedJobsRepository.patchJob", () => {
  it("updates status/notes, preserves canonicalUrl and savedAt, refreshes updatedAt", async () => {
    const sub = uniqueSub();
    const job = makeJob();
    const key = keyOf(job.canonicalUrl);
    await saveJob(sub, key, job);

    const patched = await patchJob(sub, key, {
      status: "applied",
      notes: "phone screen Friday",
    });
    expect(patched).not.toBeNull();
    expect(patched!.status).toBe("applied");
    expect(patched!.notes).toBe("phone screen Friday");
    expect(patched!.canonicalUrl).toBe(job.canonicalUrl);
    expect(patched!.savedAt).toBe(job.savedAt);
    expect(Date.parse(patched!.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(job.updatedAt)
    );
  });

  it("returns null for a missing record", async () => {
    await expect(
      patchJob(uniqueSub(), keyOf("https://missing.example/x"), { notes: "n" })
    ).resolves.toBeNull();
  });

  it("rejects attempts to change canonicalUrl or savedAt", async () => {
    const sub = uniqueSub();
    const job = makeJob();
    const key = keyOf(job.canonicalUrl);
    await saveJob(sub, key, job);

    await expect(
      patchJob(sub, key, { canonicalUrl: "https://other.example/y" })
    ).rejects.toBeInstanceOf(ImmutableFieldError);
    await expect(
      patchJob(sub, key, { savedAt: "2099-01-01T00:00:00.000Z" })
    ).rejects.toBeInstanceOf(ImmutableFieldError);
    // Echoing the unchanged values back is fine.
    await expect(
      patchJob(sub, key, { canonicalUrl: job.canonicalUrl, savedAt: job.savedAt })
    ).resolves.not.toBeNull();
  });
});

describe("savedJobsRepository delete / prune / export", () => {
  it("deleteJob removes the record and is idempotent", async () => {
    const sub = uniqueSub();
    const job = makeJob();
    const key = keyOf(job.canonicalUrl);
    await saveJob(sub, key, job);
    await deleteJob(sub, key);
    await expect(getJob(sub, key)).resolves.toBeNull();
    await expect(deleteJob(sub, key)).resolves.toBeUndefined();
  });

  it("pruneArchived deletes the oldest archived entries first, up to count", async () => {
    const sub = uniqueSub();
    const oldArchived = makeJob({
      savedAt: "2026-07-01T00:00:00.000Z",
      status: "archived",
    });
    const newArchived = makeJob({
      savedAt: "2026-07-03T00:00:00.000Z",
      status: "archived",
    });
    const active = makeJob({ savedAt: "2026-06-01T00:00:00.000Z" });
    for (const job of [oldArchived, newArchived, active]) {
      await saveJob(sub, keyOf(job.canonicalUrl), job);
    }

    await expect(pruneArchived(sub, 1)).resolves.toBe(1);
    const remaining = await listJobs(sub, {});
    const urls = remaining.map((j) => j.canonicalUrl);
    expect(urls).not.toContain(oldArchived.canonicalUrl);
    expect(urls).toContain(newArchived.canonicalUrl);
    expect(urls).toContain(active.canonicalUrl);

    // Never deletes non-archived entries, even when count exceeds matches.
    await expect(pruneArchived(sub, 10)).resolves.toBe(1);
    await expect(countJobs(sub)).resolves.toBe(1);
  });

  it("exportJobs returns the local-export shape with all jobs, savedAt descending", async () => {
    const sub = uniqueSub();
    const first = makeJob({ savedAt: "2026-07-01T00:00:00.000Z" });
    const second = makeJob({ savedAt: "2026-07-02T00:00:00.000Z" });
    await saveJob(sub, keyOf(first.canonicalUrl), first);
    await saveJob(sub, keyOf(second.canonicalUrl), second);

    const exported = await exportJobs(sub);
    expect(exported.schemaVersion).toBe(1);
    expect(Date.parse(exported.exportedAt)).not.toBeNaN();
    expect(exported.jobs.map((j) => j.savedAt)).toEqual([
      "2026-07-02T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    ]);
    // Each exported record carries the exact SavedJob JSON shape.
    expect(Object.keys(exported.jobs[0]).sort()).toEqual(
      [
        "analysis",
        "canonicalUrl",
        "filename",
        "notes",
        "savedAt",
        "schemaVersion",
        "source",
        "sourceUrl",
        "status",
        "updatedAt",
      ].sort()
    );
  });
});
