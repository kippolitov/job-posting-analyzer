import { describe, it, expect } from "vitest";
import { canonicalize, canonicalKey } from "../../lib/canonicalUrl";

describe("canonicalUrl — canonicalize", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    {
      name: "LinkedIn job view keeps only the job id",
      input:
        "https://www.linkedin.com/jobs/view/3941572809/?refId=aBcD&trackingId=xYz&trk=flagship3_search",
      expected: "https://www.linkedin.com/jobs/view/3941572809",
    },
    {
      name: "LinkedIn without params normalizes trailing slash",
      input: "https://www.linkedin.com/jobs/view/1234567/",
      expected: "https://www.linkedin.com/jobs/view/1234567",
    },
    {
      name: "Indeed viewjob keeps only the jk param",
      input:
        "https://www.indeed.com/viewjob?jk=abc123def&from=serp&vjs=3&tk=1hqxyz",
      expected: "https://www.indeed.com/viewjob?jk=abc123def",
    },
    {
      name: "Greenhouse strips gh_src and utm params",
      input:
        "https://boards.greenhouse.io/acme/jobs/4567890?gh_src=8a7b6c&utm_source=linkedin&utm_medium=social",
      expected: "https://boards.greenhouse.io/acme/jobs/4567890",
    },
    {
      name: "Lever strips lever-origin and ref, drops trailing slash",
      input:
        "https://jobs.lever.co/acme/f6c2a-11d4/?lever-origin=applied&ref=jobboard",
      expected: "https://jobs.lever.co/acme/f6c2a-11d4",
    },
    {
      name: "Ashby strips utm params",
      input:
        "https://jobs.ashbyhq.com/acme/91b2c3d4?utm_campaign=launch&utm_content=cta",
      expected: "https://jobs.ashbyhq.com/acme/91b2c3d4",
    },
    {
      name: "host and scheme are lowercased",
      input: "HTTPS://Careers.Example.COM/positions/123",
      expected: "https://careers.example.com/positions/123",
    },
    {
      name: "fragment is dropped",
      input: "https://example.com/jobs/1#apply-now",
      expected: "https://example.com/jobs/1",
    },
    {
      name: "non-tracking query params are preserved",
      input: "https://example.com/jobs?id=5&utm_source=x&fbclid=abc&gclid=def",
      expected: "https://example.com/jobs?id=5",
    },
    {
      name: "src, source, mkt_tok, trackingid stripped case-insensitively",
      input:
        "https://example.com/careers/42?SRC=email&Source=newsletter&mkt_tok=T0K&TrackingId=99",
      expected: "https://example.com/careers/42",
    },
    {
      name: "refid stripped",
      input: "https://example.com/careers/42?refid=xyz",
      expected: "https://example.com/careers/42",
    },
    {
      name: "trailing slash dropped on non-root paths",
      input: "https://example.com/jobs/55/",
      expected: "https://example.com/jobs/55",
    },
    {
      name: "root path collapses to origin",
      input: "https://example.com/?utm_source=x",
      expected: "https://example.com",
    },
  ];

  it.each(cases)("$name", ({ input, expected }) => {
    expect(canonicalize(input)).toBe(expected);
  });

  it("returns the input unchanged when it is not a valid URL", () => {
    expect(canonicalize("not a url")).toBe("not a url");
  });
});

describe("canonicalUrl — canonicalKey", () => {
  it("produces a 64-char lowercase hex SHA-256 digest", async () => {
    const key = await canonicalKey("https://example.com/jobs/1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is identical for tracking-param variants of the same posting", async () => {
    const a = await canonicalKey(
      "https://www.linkedin.com/jobs/view/3941572809/?refId=aaa&trk=one"
    );
    const b = await canonicalKey(
      "https://www.linkedin.com/jobs/view/3941572809?trackingId=bbb&utm_source=email"
    );
    expect(a).toBe(b);
  });

  it("differs for genuinely different postings", async () => {
    const a = await canonicalKey("https://www.linkedin.com/jobs/view/1");
    const b = await canonicalKey("https://www.linkedin.com/jobs/view/2");
    expect(a).not.toBe(b);
  });
});
