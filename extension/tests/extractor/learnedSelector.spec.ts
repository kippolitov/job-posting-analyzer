import { expect, test } from "@playwright/test";
import { runExtractor } from "./helpers/runExtractor";

/**
 * Learned-selector read path inside extractPage (FR-028, FR-029,
 * contracts/learned-selectors.md "Read path ordering"). Real Chromium: the
 * body-text measurement this depends on needs innerText (research R9).
 */

const POSTING_BODY =
  "Senior Software Engineer. ".repeat(20) + "We build distributed systems at scale.";

test("a matching learned selector wins ahead of the automatic ladder, strategy learned-selector", async ({
  page,
}) => {
  await page.setContent(
    `<html><body>
      <nav>Home Jobs About</nav>
      <div class="learned-target">${POSTING_BODY}</div>
      <main>Generic fallback main content that is not the real posting body at all, padded out.</main>
    </body></html>`
  );
  const extract = await runExtractor(page, { learnedSelector: ".learned-target" });

  expect(extract.provenance.strategy).toBe("learned-selector");
  expect(extract.mainText).toContain("Senior Software Engineer");
  expect(extract.provenance.learnedSelectorMissed).toBe(false);
});

test("a learned selector matching nothing falls through silently to automatic extraction (SC-009)", async ({
  page,
}) => {
  await page.setContent(
    `<html><body>
      <main>${POSTING_BODY}</main>
    </body></html>`
  );
  const extract = await runExtractor(page, { learnedSelector: ".stale-selector-from-a-redesign" });

  expect(extract.provenance.strategy).toBe("semantic");
  expect(extract.mainText).toContain("Senior Software Engineer");
  expect(extract.provenance.learnedSelectorMissed).toBe(true);
  // No user-visible error — a normal automatic-extraction result (SC-009).
});

test("a learned selector matching an element below the usable minimum still misses (falls through)", async ({
  page,
}) => {
  await page.setContent(
    `<html><body>
      <div class="learned-target">Too short.</div>
      <main>${POSTING_BODY}</main>
    </body></html>`
  );
  const extract = await runExtractor(page, { learnedSelector: ".learned-target" });

  expect(extract.provenance.strategy).toBe("semantic");
  expect(extract.provenance.learnedSelectorMissed).toBe(true);
});

test("with no learnedSelector argument, learnedSelectorMissed is false and extraction is unaffected", async ({
  page,
}) => {
  await page.setContent(`<html><body><main>${POSTING_BODY}</main></body></html>`);
  const extract = await runExtractor(page, {});

  expect(extract.provenance.learnedSelectorMissed).toBe(false);
  expect(extract.provenance.strategy).toBe("semantic");
});
