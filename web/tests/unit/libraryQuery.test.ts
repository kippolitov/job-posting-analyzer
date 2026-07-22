import { describe, it, expect } from "vitest";
import { applyLibraryQuery, activeFilterSummary, DEFAULT_LIBRARY_QUERY } from "@/lib/libraryQuery";
import type { SavedJobPayload } from "@/api/types";

function job(
  overrides: Partial<Omit<SavedJobPayload, "analysis">> & {
    analysis?: Partial<SavedJobPayload["analysis"]>;
    fit?: number | null;
  }
): SavedJobPayload {
  const { fit, analysis, ...rest } = overrides;
  return {
    schemaVersion: 1,
    canonicalUrl: `https://example.com/${Math.random()}`,
    sourceUrl: "https://example.com",
    source: "url",
    filename: "",
    status: "interested",
    notes: "",
    savedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
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
      seniority: "senior",
      techStack: [],
      fit: null,
      model: "gpt-4o-mini",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      ...analysis,
      ...(fit !== undefined ? { fit: fit === null ? null : { score: fit, rationale: "" } } : {}),
    },
  };
}

describe("libraryQuery (data-model.md §4, FR-010/FR-011/FR-012)", () => {
  it("DEFAULT_LIBRARY_QUERY has no filters and sorts by saved date desc", () => {
    expect(DEFAULT_LIBRARY_QUERY).toEqual({ text: "", sort: "saved-desc" });
  });

  it("filters by free-text search over title and company", () => {
    const jobs = [
      job({ analysis: { title: "Backend Engineer", company: "Acme" } }),
      job({ analysis: { title: "Product Manager", company: "Globex" } }),
    ];
    const result = applyLibraryQuery(jobs, { ...DEFAULT_LIBRARY_QUERY, text: "backend" });
    expect(result).toHaveLength(1);
    expect(result[0].analysis.title).toBe("Backend Engineer");
  });

  it("search matches company name too", () => {
    const jobs = [
      job({ analysis: { title: "Engineer", company: "Globex" } }),
      job({ analysis: { title: "Engineer", company: "Acme" } }),
    ];
    const result = applyLibraryQuery(jobs, { ...DEFAULT_LIBRARY_QUERY, text: "globex" });
    expect(result).toHaveLength(1);
    expect(result[0].analysis.company).toBe("Globex");
  });

  it("filters by status", () => {
    const jobs = [job({ status: "interested" }), job({ status: "applied" })];
    const result = applyLibraryQuery(jobs, { ...DEFAULT_LIBRARY_QUERY, status: "applied" });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("applied");
  });

  it("filters by arrangement", () => {
    const jobs = [
      job({ analysis: { arrangement: "remote" } }),
      job({ analysis: { arrangement: "onsite" } }),
    ];
    const result = applyLibraryQuery(jobs, { ...DEFAULT_LIBRARY_QUERY, arrangement: "onsite" });
    expect(result).toHaveLength(1);
    expect(result[0].analysis.arrangement).toBe("onsite");
  });

  it("filters by seniority", () => {
    const jobs = [
      job({ analysis: { seniority: "staff" } }),
      job({ analysis: { seniority: "junior" } }),
    ];
    const result = applyLibraryQuery(jobs, { ...DEFAULT_LIBRARY_QUERY, seniority: "staff" });
    expect(result).toHaveLength(1);
    expect(result[0].analysis.seniority).toBe("staff");
  });

  it("filters by fit-score range, excluding postings with no fit score", () => {
    const jobs = [job({ fit: 90 }), job({ fit: 40 }), job({ fit: null })];
    const result = applyLibraryQuery(jobs, { ...DEFAULT_LIBRARY_QUERY, fitMin: 50, fitMax: 100 });
    expect(result).toHaveLength(1);
    expect(result[0].analysis.fit?.score).toBe(90);
  });

  it("combines multiple criteria (AND semantics)", () => {
    const jobs = [
      job({ status: "applied", analysis: { arrangement: "remote", seniority: "senior" }, fit: 80 }),
      job({ status: "applied", analysis: { arrangement: "onsite", seniority: "senior" }, fit: 80 }),
    ];
    const result = applyLibraryQuery(jobs, {
      ...DEFAULT_LIBRARY_QUERY,
      status: "applied",
      arrangement: "remote",
      fitMin: 50,
    });
    expect(result).toHaveLength(1);
    expect(result[0].analysis.arrangement).toBe("remote");
  });

  it("sorts by fit score descending", () => {
    const jobs = [job({ fit: 40 }), job({ fit: 90 }), job({ fit: 10 })];
    const result = applyLibraryQuery(jobs, { ...DEFAULT_LIBRARY_QUERY, sort: "fit-desc" });
    expect(result.map((j) => j.analysis.fit?.score)).toEqual([90, 40, 10]);
  });

  it("sorts by saved date descending by default", () => {
    const jobs = [
      job({ savedAt: "2026-01-01T00:00:00.000Z" }),
      job({ savedAt: "2026-03-01T00:00:00.000Z" }),
      job({ savedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    const result = applyLibraryQuery(jobs, DEFAULT_LIBRARY_QUERY);
    expect(result.map((j) => j.savedAt)).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("empty filter combo with no matches returns an empty array (US2 scenario 5)", () => {
    const jobs = [job({ status: "interested" })];
    const result = applyLibraryQuery(jobs, { ...DEFAULT_LIBRARY_QUERY, status: "archived" });
    expect(result).toEqual([]);
  });

  it("activeFilterSummary lists only the set filters, removable individually", () => {
    const summary = activeFilterSummary({
      ...DEFAULT_LIBRARY_QUERY,
      status: "applied",
      arrangement: "remote",
    });
    expect(summary.map((c) => c.key)).toEqual(["status", "arrangement"]);
  });

  it("activeFilterSummary is empty with no filters set", () => {
    expect(activeFilterSummary(DEFAULT_LIBRARY_QUERY)).toEqual([]);
  });
});
