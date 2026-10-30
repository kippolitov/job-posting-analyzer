import { describe, it, expect } from "vitest";
import {
  ariaFitLabel,
  evidenceFor,
  filterByVerdict,
  freshness,
  mergeRequirementRows,
  normalizeFit,
  previewMissing,
  rescoreAction,
  rescoreCostLine,
  scoredByLabel,
  scoreTone,
  sortByFit,
  verdictFor,
  verdictLabel,
} from "shared/fitView";
import {
  COST_LINE_CASES,
  EVIDENCE_CASES,
  FILTER_CASES,
  FILTER_INPUT,
  FRESHNESS_CASES,
  MERGE_CASES,
  NORMALIZE_CASES,
  PREVIEW_MISSING_CASES,
  RESCORE_ACTION_CASES,
  SCORED_BY_CASES,
  SORT_CASES,
  SORT_INPUT,
  VERDICT_CASES,
  VERDICT_LABELS,
} from "shared/fitView.fixtures";

/**
 * Runs the shared fitView fixture table against this client's build of
 * shared/fitView.ts. Deliberately duplicated in
 * extension/tests/unit/fitView.test.ts (research R10, FR-023 guard): a
 * divergence fails this client's CI.
 */
describe("shared fitView (web build)", () => {
  describe("normalizeFit", () => {
    it.each(NORMALIZE_CASES)("%s", (_name, input, expected) => {
      expect(() => normalizeFit(input)).not.toThrow();
      expect(normalizeFit(input)).toEqual(expected);
    });
  });

  describe("freshness", () => {
    it.each(FRESHNESS_CASES)("%s", (_name, fit, current, expected) => {
      expect(freshness(fit, current)).toBe(expected);
    });
  });

  describe("rescoreAction", () => {
    it.each(RESCORE_ACTION_CASES)("%s", (_name, job, fresh, surface, expected) => {
      expect(rescoreAction(job, fresh, surface)).toEqual(expected);
    });
  });

  describe("rescoreCostLine", () => {
    it.each(COST_LINE_CASES)("%s", (_name, usage, expected) => {
      expect(rescoreCostLine(usage)).toBe(expected);
    });
  });

  describe("verdict", () => {
    it.each(VERDICT_CASES)("%s", (_name, fit, expected, aria) => {
      const normalized = normalizeFit(fit)!;
      expect(verdictFor(normalized)).toBe(expected);
      expect(scoreTone(normalized)).toBe(expected);
      expect(ariaFitLabel(fit)).toBe(aria);
    });

    it.each(VERDICT_LABELS)("label for %s", (verdict, label) => {
      expect(verdictLabel(verdict)).toBe(label);
    });
  });

  describe("evidenceFor", () => {
    it.each(EVIDENCE_CASES)("%s", (_name, fit, list, label, expected) => {
      expect(evidenceFor(fit, list, label)).toEqual(expected);
    });
  });

  describe("previewMissing", () => {
    it.each(PREVIEW_MISSING_CASES)("%s", (_name, fit, expected) => {
      expect(previewMissing(fit)).toEqual(expected);
    });
  });

  describe("scoredByLabel", () => {
    it.each(SCORED_BY_CASES)("%s", (_name, analysis, expected) => {
      expect(scoredByLabel(analysis)).toBe(expected);
    });
  });

  describe("sortByFit", () => {
    it.each(SORT_CASES)("%s", (_name, direction, ids) => {
      expect(sortByFit(SORT_INPUT, direction).map((j) => j.id)).toEqual(ids);
    });
    it("does not mutate its input", () => {
      const before = SORT_INPUT.map((j) => j.id);
      sortByFit(SORT_INPUT, "highest");
      expect(SORT_INPUT.map((j) => j.id)).toEqual(before);
    });
  });

  describe("filterByVerdict", () => {
    it.each(FILTER_CASES)("%s", (_name, verdict, ids) => {
      expect(filterByVerdict(FILTER_INPUT, verdict).map((j) => j.id)).toEqual(ids);
    });
    it("never matches an unrated fit or an unscored job", () => {
      for (const [, verdict] of FILTER_CASES) {
        const ids = filterByVerdict(FILTER_INPUT, verdict).map((j) => j.id);
        expect(ids).not.toContain("unrated-80");
        expect(ids).not.toContain("none");
      }
    });
  });

  describe("mergeRequirementRows", () => {
    it.each(MERGE_CASES)("%s", (_name, fits, expected) => {
      expect(mergeRequirementRows(fits)).toEqual(expected);
    });
  });
});
