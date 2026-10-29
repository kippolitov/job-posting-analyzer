import { describe, it, expect } from "vitest";
import { pasteIdentity } from "../../../shared/pasteIdentity";

/**
 * The same literal vector is asserted in extension/tests/unit/pasteIdentity.test.ts,
 * proving the server and the extension key a paste identically (research R7).
 */
const VECTOR_TEXT = "We are hiring a Software Engineer in Austin.";
const VECTOR_KEY =
  "paste:40df62e8a3fe15f0cdb143b8d4b12916c1d73bf84d9338f66ab219b5f04e1564";

describe("shared pasteIdentity (server)", () => {
  it("matches the fixed test vector", async () => {
    expect(await pasteIdentity(VECTOR_TEXT)).toBe(VECTOR_KEY);
  });

  it("gives whitespace and line-ending variants the same key", async () => {
    expect(await pasteIdentity("  We are hiring a  Software\r\nEngineer\tin Austin.\n")).toBe(
      VECTOR_KEY
    );
  });

  it("has the paste:<sha256 hex> shape", async () => {
    expect(await pasteIdentity("Anything at all")).toMatch(/^paste:[0-9a-f]{64}$/);
  });
});
