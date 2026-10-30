import { describe, it, expect } from "vitest";
import { groupByDay, summarizeJob } from "@/lib/libraryTimeline";
import { formatSalary } from "@/lib/formatJob";
import type { SavedJobPayload } from "@/api/types";
import type { JobAnalysisResponse } from "shared/types/job";

const TZ = "America/Los_Angeles";
// Friday 2026-10-30 12:00 in Los Angeles.
const NOW = new Date("2026-10-30T19:00:00Z");

function job(canonicalUrl: string, savedAt: string, overrides: Partial<JobAnalysisResponse> = {}, extra: Partial<SavedJobPayload> = {}): SavedJobPayload {
  return {
    schemaVersion: 1,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    source: "url",
    filename: "",
    status: "interested",
    notes: "",
    savedAt,
    updatedAt: savedAt,
    analysis: {
      isJobPosting: true,
      title: "Engineer",
      company: "Acme",
      location: null,
      arrangement: "remote",
      arrangementConfidence: "explicit",
      arrangementEvidence: null,
      daysInOffice: null,
      daysRemote: null,
      remoteRestrictions: null,
      salary: null,
      seniority: "unspecified",
      techStack: [],
      fit: null,
      model: "m",
      analyzedAt: savedAt,
      ...overrides,
    },
    ...extra,
  } as SavedJobPayload;
}

describe("groupByDay", () => {
  const jobs = [
    job("https://x.test/today", "2026-10-30T18:00:00Z"),
    job("https://x.test/yesterday", "2026-10-29T18:00:00Z"),
    job("https://x.test/three", "2026-10-27T18:00:00Z"),
    job("https://x.test/lastyear", "2025-03-04T18:00:00Z"),
  ];

  it("headings: Today, Yesterday, weekday and date, and the date with the year", () => {
    const groups = groupByDay(jobs, NOW, TZ);
    expect(groups.map((g) => g.heading)).toEqual([
      "Today",
      "Yesterday",
      "Tuesday, October 27",
      "Tuesday, March 4, 2025",
    ]);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-10-30", "2026-10-29", "2026-10-27", "2025-03-04"]);
  });

  it("puts 23:30 local time on that local day, not the UTC day", () => {
    // 23:30 PDT on Oct 29 is 06:30 UTC on Oct 30.
    const groups = groupByDay([job("https://x.test/late", "2026-10-30T06:30:00Z")], NOW, TZ);
    expect(groups).toHaveLength(1);
    expect(groups[0].heading).toBe("Yesterday");
  });

  it("orders groups and entries newest first, with no empty groups", () => {
    const groups = groupByDay(
      [
        job("https://x.test/a", "2026-10-30T16:00:00Z"),
        job("https://x.test/b", "2026-10-30T18:00:00Z"),
        job("https://x.test/c", "2026-10-29T18:00:00Z"),
      ],
      NOW,
      TZ
    );
    expect(groups.map((g) => g.jobs.map((j) => j.canonicalUrl.slice(-1)))).toEqual([["b", "a"], ["c"]]);
    expect(groupByDay([], NOW, TZ)).toEqual([]);
  });

  it("direction oldest reverses groups and entries under the same headings", () => {
    const groups = groupByDay(
      [
        job("https://x.test/a", "2026-10-30T16:00:00Z"),
        job("https://x.test/b", "2026-10-30T18:00:00Z"),
        job("https://x.test/c", "2026-10-29T18:00:00Z"),
      ],
      NOW,
      TZ,
      "oldest"
    );
    expect(groups.map((g) => g.heading)).toEqual(["Yesterday", "Today"]);
    expect(groups[1].jobs.map((j) => j.canonicalUrl.slice(-1))).toEqual(["a", "b"]);
  });
});

describe("summarizeJob", () => {
  it("states missing salary and arrangement in words", () => {
    const s = summarizeJob(job("https://x.test/a", "2026-10-30T18:00:00Z", { arrangement: "unspecified" }), TZ);
    expect(s.salary).toBe("Salary not stated");
    expect(s.arrangement).toBe("Arrangement not stated");
    expect(s.location).toBeUndefined();
    expect(s.seniority).toBeUndefined();
  });

  it("formats a hybrid posting with office days", () => {
    const s = summarizeJob(
      job("https://x.test/a", "2026-10-30T18:00:00Z", {
        arrangement: "hybrid",
        daysInOffice: 2,
        location: "Austin, TX",
        seniority: "senior",
        salary: { min: 100000, max: 120000, currency: "USD", period: "year" },
      }),
      TZ
    );
    expect(s.arrangement).toBe("Hybrid · 2 days in office");
    expect(s.location).toBe("Austin, TX");
    expect(s.seniority).toBe("senior");
    expect(s.salary).toBe("USD 100,000 – 120,000/year");
  });

  it("source label: host name, file name or Pasted", () => {
    const at = "2026-10-30T18:00:00Z";
    expect(summarizeJob(job("https://jobs.acme.test/1", at, {}, { sourceUrl: "https://jobs.acme.test/1" }), TZ).sourceLabel).toBe("jobs.acme.test");
    expect(summarizeJob(job("doc:abc", at, {}, { source: "document", sourceUrl: "", filename: "role.pdf" }), TZ).sourceLabel).toBe("role.pdf");
    expect(summarizeJob(job("paste:abc", at, {}, { source: "paste", sourceUrl: "" }), TZ).sourceLabel).toBe("Pasted");
  });

  it("savedOn is the local date", () => {
    expect(summarizeJob(job("https://x.test/a", "2026-10-30T06:30:00Z"), TZ).savedOn).toBe("Oct 29, 2026");
  });
});

describe("formatSalary", () => {
  const base = job("https://x.test/a", "2026-10-30T18:00:00Z").analysis;
  it("range, single bound, missing currency and period", () => {
    expect(formatSalary({ ...base, salary: { min: 90000, max: 110000, currency: "EUR", period: "year" } })).toBe("EUR 90,000 – 110,000/year");
    expect(formatSalary({ ...base, salary: { min: 90000, max: null, currency: "EUR", period: null } })).toBe("EUR 90,000");
    expect(formatSalary({ ...base, salary: { min: null, max: 5000, currency: null, period: "month" } })).toBe("5,000/month");
    expect(formatSalary({ ...base, salary: null })).toBeNull();
    expect(formatSalary({ ...base, salary: { min: null, max: null, currency: "USD", period: "year" } })).toBeNull();
  });
});
