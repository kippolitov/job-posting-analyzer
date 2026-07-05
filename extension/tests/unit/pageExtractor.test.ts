import { describe, it, expect, beforeEach } from "vitest";
import {
  extractPage,
  deriveJsonLdFields,
  MAIN_TEXT_CAP,
  MIN_TEXT_CHARS,
} from "../../lib/pageExtractor";

function setPage(html: string, title = "Test Page"): void {
  document.title = title;
  document.body.innerHTML = html;
}

function jsonLdScript(payload: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

const posting = {
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title: "Senior Backend Engineer",
  hiringOrganization: { "@type": "Organization", name: "Acme" },
  jobLocation: {
    "@type": "Place",
    address: { addressLocality: "Austin", addressRegion: "TX" },
  },
  baseSalary: {
    "@type": "MonetaryAmount",
    currency: "USD",
    value: { "@type": "QuantitativeValue", minValue: 180000, maxValue: 220000, unitText: "YEAR" },
  },
  jobLocationType: "TELECOMMUTE",
};

describe("pageExtractor — extractPage", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("collects a single JSON-LD JobPosting object", () => {
    setPage(`${jsonLdScript(posting)}<main>About the role</main>`);
    const extract = extractPage();
    expect(extract.jsonLd).toHaveLength(1);
    expect(extract.jsonLd[0]).toMatchObject({ "@type": "JobPosting" });
  });

  it("flattens a top-level array and keeps only JobPosting entries", () => {
    setPage(
      `${jsonLdScript([posting, { "@type": "Organization", name: "Acme" }])}<main>Body</main>`
    );
    const extract = extractPage();
    expect(extract.jsonLd).toHaveLength(1);
  });

  it("unwraps @graph containers", () => {
    setPage(
      `${jsonLdScript({ "@context": "https://schema.org", "@graph": [posting, { "@type": "WebSite" }] })}<main>Body</main>`
    );
    const extract = extractPage();
    expect(extract.jsonLd).toHaveLength(1);
    expect(extract.jsonLd[0]).toMatchObject({ title: "Senior Backend Engineer" });
  });

  it("supports @type arrays", () => {
    setPage(
      `${jsonLdScript({ ...posting, "@type": ["JobPosting", "Thing"] })}<main>Body</main>`
    );
    expect(extractPage().jsonLd).toHaveLength(1);
  });

  it("skips malformed JSON-LD without throwing", () => {
    setPage(
      `<script type="application/ld+json">{not valid json,,}</script>${jsonLdScript(posting)}<main>Body</main>`
    );
    const extract = extractPage();
    expect(extract.jsonLd).toHaveLength(1);
  });

  it("collects multiple JobPosting blocks from separate scripts", () => {
    setPage(`${jsonLdScript(posting)}${jsonLdScript({ ...posting, title: "Other" })}<main>Body</main>`);
    expect(extractPage().jsonLd).toHaveLength(2);
  });

  it("filters out non-JobPosting types entirely", () => {
    setPage(`${jsonLdScript({ "@type": "NewsArticle", headline: "x" })}<main>Body</main>`);
    expect(extractPage().jsonLd).toHaveLength(0);
  });

  it("prefers <main> content and excludes nav/footer text", () => {
    setPage(
      `<nav>NAVIGATION LINKS</nav>
       <main>We are hiring a senior engineer. ${"Role details. ".repeat(30)}</main>
       <footer>FOOTER BOILERPLATE</footer>`
    );
    const { mainText } = extractPage();
    expect(mainText).toContain("We are hiring a senior engineer.");
    expect(mainText).not.toContain("NAVIGATION LINKS");
    expect(mainText).not.toContain("FOOTER BOILERPLATE");
  });

  it("falls back to body text with nav/header/footer/aside/script/style stripped", () => {
    setPage(
      `<header>HEADER</header><nav>NAV</nav><aside>ASIDE</aside>
       <div>The actual job description. ${"More content. ".repeat(30)}</div>
       <style>.x{color:red}</style><footer>FOOTER</footer>`
    );
    const { mainText } = extractPage();
    expect(mainText).toContain("The actual job description.");
    for (const noise of ["HEADER", "NAV", "ASIDE", "FOOTER", "color:red"]) {
      expect(mainText).not.toContain(noise);
    }
  });

  it(`caps mainText at ${MAIN_TEXT_CAP} characters`, () => {
    setPage(`<main>${"word ".repeat(20_000)}</main>`);
    expect(extractPage().mainText.length).toBeLessThanOrEqual(MAIN_TEXT_CAP);
  });

  it("returns url, title, and an ISO extractedAt timestamp", () => {
    setPage("<main>Body content here</main>", "Acme — Senior Engineer");
    const extract = extractPage();
    expect(extract.url).toContain("http");
    expect(extract.title).toBe("Acme — Senior Engineer");
    expect(new Date(extract.extractedAt).toString()).not.toBe("Invalid Date");
  });

  it("exposes a thin-content threshold used by the caller", () => {
    expect(MIN_TEXT_CHARS).toBe(300);
  });
});

describe("pageExtractor — deriveJsonLdFields", () => {
  it("derives title, company, location, salary, and remote arrangement", () => {
    const fields = deriveJsonLdFields([posting]);
    expect(fields.title).toBe("Senior Backend Engineer");
    expect(fields.company).toBe("Acme");
    expect(fields.location).toContain("Austin");
    expect(fields.salary).toEqual({
      min: 180000,
      max: 220000,
      currency: "USD",
      period: "year",
    });
    expect(fields.arrangement).toBe("remote");
    expect(fields.arrangementConfidence).toBe("explicit");
  });

  it("returns nulls for absent fields without throwing", () => {
    const fields = deriveJsonLdFields([{ "@type": "JobPosting" }]);
    expect(fields.title).toBeNull();
    expect(fields.company).toBeNull();
    expect(fields.salary).toBeNull();
  });

  it("returns an empty object when no JSON-LD is present", () => {
    expect(deriveJsonLdFields([])).toEqual({});
  });
});
