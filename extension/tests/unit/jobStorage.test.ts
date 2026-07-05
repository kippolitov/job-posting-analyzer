import { describe, it, expect, beforeEach } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import {
  jobStorage,
  LibraryFullError,
  SAVED_JOBS_SOFT_CAP,
} from "../../services/jobStorage";
import type { JobAnalysis, SavedJob } from "../../types/job";

const analysis: JobAnalysis = {
  isJobPosting: true,
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Austin, TX",
  arrangement: "hybrid",
  arrangementConfidence: "explicit",
  arrangementEvidence: "hybrid, 3 days per week",
  daysInOffice: 3,
  daysRemote: 2,
  remoteRestrictions: null,
  salary: null,
  seniority: "senior",
  techStack: ["C#"],
  fit: null,
  model: "gpt-4o-mini",
  analyzedAt: "2026-07-04T12:00:04Z",
};

function makeJob(overrides: Partial<SavedJob> = {}): SavedJob {
  return {
    schemaVersion: 1,
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
    sourceUrl: "https://boards.greenhouse.io/acme/jobs/1?gh_src=x",
    analysis,
    status: "interested",
    notes: "",
    savedAt: "2026-07-04T12:01:00Z",
    updatedAt: "2026-07-04T12:01:00Z",
    ...overrides,
  };
}

let storage: ReturnType<typeof installMemoryStorage>;

beforeEach(() => {
  storage = installMemoryStorage("local");
});

describe("jobStorage", () => {
  it("round-trips a saved job by canonical URL", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    await expect(jobStorage.get(job.canonicalUrl)).resolves.toEqual(job);
  });

  it("returns null for unknown URLs", async () => {
    await expect(jobStorage.get("https://example.com/none")).resolves.toBeNull();
  });

  it("deduplicates: saving the same canonical URL twice keeps one record", async () => {
    await jobStorage.save(makeJob());
    await jobStorage.save(makeJob({ notes: "second save" }));
    const all = await jobStorage.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.notes).toBe("second save");
  });

  it("lists jobs sorted by savedAt descending", async () => {
    await jobStorage.save(
      makeJob({ canonicalUrl: "https://a.example/1", savedAt: "2026-07-01T00:00:00Z" })
    );
    await jobStorage.save(
      makeJob({ canonicalUrl: "https://a.example/2", savedAt: "2026-07-03T00:00:00Z" })
    );
    await jobStorage.save(
      makeJob({ canonicalUrl: "https://a.example/3", savedAt: "2026-07-02T00:00:00Z" })
    );
    const all = await jobStorage.list();
    expect(all.map((j) => j.canonicalUrl)).toEqual([
      "https://a.example/2",
      "https://a.example/3",
      "https://a.example/1",
    ]);
  });

  it("filters by arrangement and by status", async () => {
    await jobStorage.save(makeJob({ canonicalUrl: "https://a.example/1" }));
    await jobStorage.save(
      makeJob({
        canonicalUrl: "https://a.example/2",
        status: "applied",
        analysis: { ...analysis, arrangement: "remote" },
      })
    );

    const remote = await jobStorage.list({ arrangement: "remote" });
    expect(remote).toHaveLength(1);
    expect(remote[0]!.canonicalUrl).toBe("https://a.example/2");

    const applied = await jobStorage.list({ status: "applied" });
    expect(applied).toHaveLength(1);

    const both = await jobStorage.list({ arrangement: "hybrid", status: "applied" });
    expect(both).toHaveLength(0);
  });

  it("update patches fields and bumps updatedAt", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    await jobStorage.update(job.canonicalUrl, { status: "interviewing", notes: "call Tue" });

    const updated = await jobStorage.get(job.canonicalUrl);
    expect(updated!.status).toBe("interviewing");
    expect(updated!.notes).toBe("call Tue");
    expect(updated!.savedAt).toBe(job.savedAt);
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse(job.updatedAt));
  });

  it("update on a missing record is a no-op", async () => {
    await expect(
      jobStorage.update("https://a.example/none", { status: "applied" })
    ).resolves.toBeUndefined();
  });

  it("remove deletes the record and its index entry", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    await jobStorage.remove(job.canonicalUrl);
    await expect(jobStorage.get(job.canonicalUrl)).resolves.toBeNull();
    await expect(jobStorage.list()).resolves.toEqual([]);
  });

  it("exportAll produces a JSON document with every saved job", async () => {
    await jobStorage.save(makeJob({ canonicalUrl: "https://a.example/1" }));
    await jobStorage.save(makeJob({ canonicalUrl: "https://a.example/2" }));

    const exported = JSON.parse(await jobStorage.exportAll()) as {
      schemaVersion: number;
      exportedAt: string;
      jobs: SavedJob[];
    };
    expect(exported.schemaVersion).toBe(1);
    expect(new Date(exported.exportedAt).toString()).not.toBe("Invalid Date");
    expect(exported.jobs).toHaveLength(2);
  });

  it("rebuilds the index from job records when the index is corrupt", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    storage.store.set("job:index", "not-an-index");

    const all = await jobStorage.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.canonicalUrl).toBe(job.canonicalUrl);
  });

  it("rejects new saves once the soft cap is reached", async () => {
    // Seed a full index without materializing 1,000 records.
    const index: Record<string, unknown> = {};
    for (let i = 0; i < SAVED_JOBS_SOFT_CAP; i++) {
      index[`hash${i}`] = {
        canonicalUrl: `https://a.example/${i}`,
        savedAt: "2026-07-01T00:00:00Z",
        arrangement: "remote",
        status: "archived",
      };
    }
    storage.store.set("job:index", index);

    await expect(
      jobStorage.save(makeJob({ canonicalUrl: "https://a.example/new" }))
    ).rejects.toBeInstanceOf(LibraryFullError);
  });

  it("updating an existing job is allowed at the cap", async () => {
    const job = makeJob();
    await jobStorage.save(job);
    const index = storage.store.get("job:index") as Record<string, unknown>;
    for (let i = 0; Object.keys(index).length < SAVED_JOBS_SOFT_CAP; i++) {
      index[`hash${i}`] = {
        canonicalUrl: `https://a.example/${i}`,
        savedAt: "2026-07-01T00:00:00Z",
        arrangement: "remote",
        status: "archived",
      };
    }
    await expect(jobStorage.save({ ...job, notes: "still fine" })).resolves.toBeUndefined();
  });

  it("propagates storage quota failures as actionable errors", async () => {
    storage.failNextSet();
    await expect(jobStorage.save(makeJob())).rejects.toThrow(/quota/i);
  });

  it("pruneArchived removes the oldest archived entries first", async () => {
    await jobStorage.save(
      makeJob({
        canonicalUrl: "https://a.example/old-archived",
        status: "archived",
        savedAt: "2026-06-01T00:00:00Z",
      })
    );
    await jobStorage.save(
      makeJob({
        canonicalUrl: "https://a.example/new-archived",
        status: "archived",
        savedAt: "2026-07-01T00:00:00Z",
      })
    );
    await jobStorage.save(
      makeJob({ canonicalUrl: "https://a.example/active", savedAt: "2026-05-01T00:00:00Z" })
    );

    const removed = await jobStorage.pruneArchived(1);
    expect(removed).toBe(1);
    await expect(jobStorage.get("https://a.example/old-archived")).resolves.toBeNull();
    await expect(jobStorage.get("https://a.example/new-archived")).resolves.not.toBeNull();
    await expect(jobStorage.get("https://a.example/active")).resolves.not.toBeNull();
  });
});
