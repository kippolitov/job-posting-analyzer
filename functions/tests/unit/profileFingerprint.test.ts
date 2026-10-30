import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  fingerprintForRequest,
  profileFingerprint,
} from "../../src/services/profileFingerprint";
import { profileToPromptText } from "../../../shared/types/profile";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("profileFingerprint (research R5)", () => {
  it("is 64 lowercase hex characters", () => {
    expect(profileFingerprint("Senior engineer")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is SHA-256 of the whitespace-normalized serialization", () => {
    const s = "  Senior   engineer\n\nDealbreakers:\n- Remote only  ";
    expect(profileFingerprint(s)).toBe(sha256(s.replace(/\s+/g, " ").trim()));
  });

  it("ignores whitespace-only edits (US1 #6)", () => {
    const a = profileToPromptText({ text: "Senior engineer", dealbreakers: ["Remote only"] });
    const b = profileToPromptText({
      text: "  Senior\t engineer \n",
      dealbreakers: ["Remote only"],
    });
    expect(profileFingerprint(a)).toBe(profileFingerprint(b));
  });

  it("changes when a dealbreaker changes", () => {
    const a = profileToPromptText({ text: "Senior engineer", dealbreakers: ["Remote only"] });
    const b = profileToPromptText({ text: "Senior engineer", dealbreakers: ["Hybrid ok"] });
    expect(profileFingerprint(a)).not.toBe(profileFingerprint(b));
  });
});

describe("fingerprintForRequest", () => {
  const profileData = { text: "Senior engineer", dealbreakers: ["Remote only"] };

  it("fingerprints profileData identically to the equivalent serialized string", () => {
    expect(fingerprintForRequest({ profileData })).toBe(
      fingerprintForRequest({ profile: profileToPromptText(profileData) })
    );
  });

  it("prefers profileData over the legacy profile string", () => {
    expect(fingerprintForRequest({ profileData, profile: "something else" })).toBe(
      profileFingerprint(profileToPromptText(profileData))
    );
  });

  it("returns undefined when no profile is sent", () => {
    expect(fingerprintForRequest({})).toBeUndefined();
    expect(fingerprintForRequest({ profile: "" })).toBeUndefined();
  });
});
