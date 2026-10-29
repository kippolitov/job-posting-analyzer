import { describe, it, expect } from "vitest";
import { normalizeFit } from "../../../shared/fitView";
import { NORMALIZE_CASES } from "../../../shared/fitView.fixtures";

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
});
