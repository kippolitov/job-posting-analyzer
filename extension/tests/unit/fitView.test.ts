import { describe, it, expect } from "vitest";
import {
  ariaFitLabel,
  freshness,
  normalizeFit,
  previewMissing,
  rescoreAction,
  rescoreCostLine,
  scoredByLabel,
  scoreTone,
  verdictFor,
  verdictLabel,
} from "../../../shared/fitView";
import {
  COST_LINE_CASES,
  FRESHNESS_CASES,
  NORMALIZE_CASES,
  PREVIEW_MISSING_CASES,
  RESCORE_ACTION_CASES,
  SCORED_BY_CASES,
  VERDICT_CASES,
  VERDICT_LABELS,
} from "../../../shared/fitView.fixtures";

/**
 * Runs the shared fitView fixture table against this client's build of
 * shared/fitView.ts. Deliberately duplicated in web/tests/unit/fitView.test.ts
 * (research R10, FR-023 guard): a divergence fails this client's CI.
 */
describe("shared fitView (extension build)", () => {
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
});
