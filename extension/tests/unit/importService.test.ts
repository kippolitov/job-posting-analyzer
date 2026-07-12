import { describe, it, expect, beforeEach } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import { installFakeStorageApi } from "./helpers/mswStorageServer";
import { importFromJson } from "../../services/importService";
import { jobStorage } from "../../services/jobStorage";
import type { JobAnalysis, SavedJob } from "../../types/job";

// Runs the real fetch-backed repository against the contract-faithful fake
// API, same as the other storage suites (Constitution II).
const api = installFakeStorageApi();

beforeEach(() => {
  installMemoryStorage("local");
});

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
  techStack: [],
  fit: null,
  model: "gpt-4o-mini",
  analyzedAt: "2026-07-04T12:00:04Z",
};

function makeJob(overrides: Partial<SavedJob> = {}): SavedJob {
  return {
    schemaVersion: 1,
    canonicalUrl: "https://a.example/1",
    sourceUrl: "https://a.example/1",
    analysis,
    status: "interested",
    notes: "",
    savedAt: "2026-07-04T12:01:00Z",
    updatedAt: "2026-07-04T12:01:00Z",
    ...overrides,
  };
}

function exportFile(jobs: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: "2026-07-10T00:00:00Z",
    jobs,
  });
}

describe("importFromJson", () => {
  it("rejects a file that is not JSON", async () => {
    const result = await importFromJson("not json {");
    expect(result.status).toBe("invalid-file");
    expect(result.errorMessage).toMatch(/not valid JSON/);
  });

  it("rejects JSON that is not a saved-jobs export", async () => {
    const result = await importFromJson(JSON.stringify({ hello: "world" }));
    expect(result.status).toBe("invalid-file");
    expect(result.errorMessage).toMatch(/not a saved-jobs export/);
  });

  it("rejects an unsupported schema version", async () => {
    const result = await importFromJson(
      JSON.stringify({ schemaVersion: 2, jobs: [] })
    );
    expect(result.status).toBe("invalid-file");
    expect(result.errorMessage).toMatch(/schema version/);
  });

  it("uploads every job from the file to the account store", async () => {
    const result = await importFromJson(
      exportFile([
        makeJob({ canonicalUrl: "https://a.example/1" }),
        makeJob({ canonicalUrl: "https://a.example/2" }),
      ])
    );

    expect(result).toEqual({
      status: "completed",
      importedJobs: 2,
      skippedDuplicates: 0,
      invalidEntries: 0,
    });
    await expect(jobStorage.get("https://a.example/1")).resolves.not.toBeNull();
    await expect(jobStorage.get("https://a.example/2")).resolves.not.toBeNull();
  });

  it("skips records already in the library without overwriting them", async () => {
    await jobStorage.save(
      makeJob({ status: "interviewing", notes: "phone screen Friday" })
    );

    const result = await importFromJson(
      exportFile([
        makeJob({ status: "interested", notes: "stale exported notes" }),
        makeJob({ canonicalUrl: "https://a.example/2" }),
      ])
    );

    expect(result.status).toBe("completed");
    expect(result.importedJobs).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    const kept = await jobStorage.get("https://a.example/1");
    expect(kept!.status).toBe("interviewing");
    expect(kept!.notes).toBe("phone screen Friday");
  });

  it("converges when the same file is imported twice", async () => {
    const file = exportFile([
      makeJob({ canonicalUrl: "https://a.example/1" }),
      makeJob({ canonicalUrl: "https://a.example/2" }),
    ]);

    await importFromJson(file);
    const second = await importFromJson(file);

    expect(second.importedJobs).toBe(0);
    expect(second.skippedDuplicates).toBe(2);
    expect(api.jobs.size).toBe(2);
  });

  it("ignores malformed entries and counts them", async () => {
    const result = await importFromJson(
      exportFile([
        makeJob(),
        { canonicalUrl: "https://a.example/2" }, // missing everything else
        "not even an object",
      ])
    );

    expect(result.status).toBe("completed");
    expect(result.importedJobs).toBe(1);
    expect(result.invalidEntries).toBe(2);
  });

  it("reports cap-blocked with partial counts when the library fills up", async () => {
    api.setCap(1);

    const result = await importFromJson(
      exportFile([
        makeJob({ canonicalUrl: "https://a.example/1" }),
        makeJob({ canonicalUrl: "https://a.example/2" }),
      ])
    );

    expect(result.status).toBe("cap-blocked");
    expect(result.importedJobs).toBe(1);
    expect(result.errorMessage).toMatch(/full/i);
  });

  it("reports failed with the counts reached when the service errors mid-import", async () => {
    api.failNext(500);

    const result = await importFromJson(
      exportFile([
        makeJob({ canonicalUrl: "https://a.example/1" }),
        makeJob({ canonicalUrl: "https://a.example/2" }),
      ])
    );

    expect(result.status).toBe("failed");
    expect(result.importedJobs).toBe(0);
    expect(result.errorMessage).toBeTruthy();
  });
});
