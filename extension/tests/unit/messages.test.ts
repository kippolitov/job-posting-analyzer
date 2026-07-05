import { describe, it, expect } from "vitest";
import { MessageType } from "../../types/messages";

describe("MessageType", () => {
  it("defines a stable string value for every message type", () => {
    expect(MessageType).toEqual({
      GET_ACTIVE_TAB: "GET_ACTIVE_TAB",
      ACTIVE_TAB_CHANGED: "ACTIVE_TAB_CHANGED",
      ANALYZE_JOB_PAGE: "ANALYZE_JOB_PAGE",
      JOB_ANALYSIS_RESULT: "JOB_ANALYSIS_RESULT",
      JOB_ANALYSIS_ERROR: "JOB_ANALYSIS_ERROR",
    });
  });
});
