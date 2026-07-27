import { describe, it, expect, afterEach } from "vitest";
import { selectorPath } from "../../lib/selectorPath";

/**
 * Parses HTML and attaches it directly under `document.body`, so the picked
 * element's ancestry is the real page tree `selectorPath` walks in
 * production — no synthetic wrapper div sitting between it and `body`.
 */
function elementFromHTML(html: string): Element {
  const fragment = document.createRange().createContextualFragment(html);
  const el = fragment.firstElementChild!;
  document.body.appendChild(fragment);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("selectorPath (FR-027, research R7)", () => {
  it("prefers #id when present and not machine-generated", () => {
    // No hyphen/underscore before a long run — MACHINE_GENERATED_RE only
    // flags a hyphenated/underscored suffix of 5+ chars, which a plain
    // single-word id like this never has.
    const el = elementFromHTML('<div id="posting">text</div>');
    expect(selectorPath(el)).toBe("#posting");
  });

  it("rejects a machine-generated id (css-in-js hash shape) and falls through", () => {
    const el = elementFromHTML('<div id="css-1x2y3z" class="posting-body">text</div>');
    expect(selectorPath(el)).toBe("div.posting-body");
  });

  it("prefers a [data-*] attribute over class when there is no usable id", () => {
    const el = elementFromHTML(
      '<div data-automation-id="jobPostingDescription" class="css-q3c8ro">text</div>'
    );
    expect(selectorPath(el)).toBe("[data-automation-id]");
  });

  it("rejects machine-generated classes (css-, sc-, jsx-, emotion- prefixes)", () => {
    for (const cls of ["css-1x2y3z", "sc-bZQltl", "jsx-123", "emotion-abc12"]) {
      const el = elementFromHTML(`<div class="${cls}">text</div>`);
      expect(selectorPath(el)).not.toContain(cls);
    }
  });

  it("rejects classes ending in a long generated-looking suffix", () => {
    const el = elementFromHTML('<div class="posting_a1b2c3">text</div>');
    expect(selectorPath(el)).not.toContain("posting_a1b2c3");
  });

  it("falls through to tag.class filtered to human-looking classes", () => {
    const el = elementFromHTML(
      '<div class="css-1x2y3z posting-body content">text</div>'
    );
    expect(selectorPath(el)).toBe("div.posting-body.content");
  });

  it("falls through to tag:nth-of-type(n) when nothing else is usable", () => {
    elementFromHTML("<p>one</p><p>two</p><p>three</p>");
    const third = document.body.children[2];
    expect(selectorPath(third)).toBe("p:nth-of-type(3)");
  });

  it("caps the path at ~4 segments even with a deep, anchor-free ancestry", () => {
    const deepest = elementFromHTML(
      "<div><div><div><div><div><p>deep text</p></div></div></div></div></div>"
    ).querySelector("p")!;
    const path = selectorPath(deepest);
    expect(path.split(" > ").length).toBeLessThanOrEqual(4);
  });

  it("stops climbing once an #id anchor is reached, rather than using the full 4 segments", () => {
    const el = elementFromHTML(
      '<div id="posting"><div><p class="body">text</p></div></div>'
    ).querySelector("p")!;
    const path = selectorPath(el);
    expect(path).toContain("#posting");
    // The anchor ends the walk — no unrelated ancestor segments prepended
    // above it.
    expect(path.startsWith("#posting")).toBe(true);
  });
});
