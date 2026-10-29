import { describe, it, expect } from "vitest";
import { freshness, normalizeFit, rescoreAction, rescoreCostLine } from "shared/fitView";
import {
  COST_LINE_CASES,
  FRESHNESS_CASES,
  NORMALIZE_CASES,
  RESCORE_ACTION_CASES,
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
});
