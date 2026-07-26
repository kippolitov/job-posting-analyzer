import { describe, it, expect } from "vitest";
import { MessageType } from "../../types/messages";

describe("MessageType", () => {
  it("defines a stable string value for every message type", () => {
    expect(MessageType).toEqual({
      GET_ACTIVE_TAB: "GET_ACTIVE_TAB",
      ACTIVE_TAB_CHANGED: "ACTIVE_TAB_CHANGED",
      ANALYZE_JOB_PAGE: "ANALYZE_JOB_PAGE",
      CANCEL_ANALYSIS: "CANCEL_ANALYSIS",
      JOB_ANALYSIS_RESULT: "JOB_ANALYSIS_RESULT",
      JOB_ANALYSIS_ERROR: "JOB_ANALYSIS_ERROR",
      ANALYZE_PASTED_TEXT: "ANALYZE_PASTED_TEXT",
      PASTE_ANALYSIS_RESULT: "PASTE_ANALYSIS_RESULT",
      PASTE_ANALYSIS_ERROR: "PASTE_ANALYSIS_ERROR",
      ANALYZE_SCOPED_REGION: "ANALYZE_SCOPED_REGION",
    });
  });
});
