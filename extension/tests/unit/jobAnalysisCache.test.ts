import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMemoryStorage } from "./helpers/memoryStorage";
import {
  getCached,
  setCached,
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
} from "../../services/jobAnalysisCache";
import type { JobAnalysis } from "../../types/job";

function makeAnalysis(title: string): JobAnalysis {
  return {
    isJobPosting: true,
    title,
    company: "Acme",
    location: null,
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
  };
}

beforeEach(() => {
  installMemoryStorage("session");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-04T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("jobAnalysisCache", () => {
  it("round-trips an analysis by canonical URL", async () => {
    await setCached("https://a.example/jobs/1", makeAnalysis("Role"));
    const hit = await getCached("https://a.example/jobs/1");
    expect(hit?.title).toBe("Role");
  });

  it("misses for unknown URLs", async () => {
    await expect(getCached("https://a.example/none")).resolves.toBeNull();
  });

  it("hits for tracking-param variants of the same posting", async () => {
    await setCached("https://a.example/jobs/1", makeAnalysis("Role"));
    const hit = await getCached("https://a.example/jobs/1?utm_source=x&trk=y");
    expect(hit?.title).toBe("Role");
  });

  it("expires entries after the 14-day TTL", async () => {
    await setCached("https://a.example/jobs/1", makeAnalysis("Role"));
    vi.advanceTimersByTime(CACHE_TTL_MS - 1);
    await expect(getCached("https://a.example/jobs/1")).resolves.not.toBeNull();

    vi.advanceTimersByTime(2);
    await expect(getCached("https://a.example/jobs/1")).resolves.toBeNull();
  });

  it("evicts the least-recently-used entry beyond the cap", async () => {
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
      await setCached(`https://a.example/jobs/${i}`, makeAnalysis(`Role ${i}`));
      vi.advanceTimersByTime(10);
    }
    // Touch the oldest entry so it becomes most-recently-used.
    await getCached("https://a.example/jobs/0");
    vi.advanceTimersByTime(10);

    await setCached("https://a.example/jobs/new", makeAnalysis("New Role"));

    // jobs/1 was the least recently used → evicted; jobs/0 survives.
    await expect(getCached("https://a.example/jobs/1")).resolves.toBeNull();
    await expect(getCached("https://a.example/jobs/0")).resolves.not.toBeNull();
    await expect(getCached("https://a.example/jobs/new")).resolves.not.toBeNull();
  });
});
