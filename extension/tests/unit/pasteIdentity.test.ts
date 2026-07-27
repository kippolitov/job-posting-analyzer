import { describe, it, expect } from "vitest";
import { pasteIdentity } from "../../lib/pasteIdentity";

describe("pasteIdentity (FR-021, research R6)", () => {
  it("hashes to a stable paste:<sha256 hex> identity", async () => {
    const key = await pasteIdentity("A job posting about a software engineer role.");
    expect(key).toMatch(/^paste:[0-9a-f]{64}$/);
  });

  it("resolves the same text with differing incidental whitespace to the same key", async () => {
    const a = await pasteIdentity("We are hiring a  Software\nEngineer  in Austin.");
    const b = await pasteIdentity("We are hiring a Software Engineer in Austin.");
    expect(a).toBe(b);
  });

  it("gives different texts different keys", async () => {
    const a = await pasteIdentity("Posting one, a distinct job description.");
    const b = await pasteIdentity("Posting two, a completely different role.");
    expect(a).not.toBe(b);
  });
});
