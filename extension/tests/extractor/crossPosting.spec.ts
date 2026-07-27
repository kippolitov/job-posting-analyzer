import { expect, test, type Page } from "@playwright/test";
import { extractPage } from "../../lib/pageExtractor";
import { MIN_TEXT_CHARS } from "../../lib/pageExtractor";
import { pickerPageScript } from "../../services/pickerService";
import { readLiveSelectionInPage } from "../../services/selectionService";

/**
 * US4 cross-posting generalization (spec T065, SC-008, research R7): a
 * region learned on ONE posting must extract correctly on a DIFFERENT
 * posting from the same board, with no user action — the whole premise of
 * `learnedSelectors` (per-host, not per-posting). Lever's postings on one
 * board share a template but not ids or positions, which is exactly what
 * `selectorPath`'s structural preference (research R7) is for.
 *
 * Hits the live jobs.lever.co/palantir board — genuinely different from
 * every other extractor-lane test, which runs only against captured
 * fixtures or synthetic HTML and needs neither network nor a live backend.
 * Opt-in via LIVE_CORPUS=1 so the unconditional-in-CI invariant documented
 * in playwright.config.ts holds for the rest of the "extractor" project;
 * `npx tsx scripts/captureCorpus.ts --only=lever` already resolves up to 4
 * candidate postings from this same board, so no new resolution tooling is
 * needed here beyond a trimmed copy of that lookup.
 */

const liveCorpusEnabled = process.env.LIVE_CORPUS === "1";
const skipReason =
  "Opt-in: hits the live jobs.lever.co/palantir board. Run with LIVE_CORPUS=1.";

const LISTING = "https://jobs.lever.co/palantir";
const POSTING_HREF = /jobs\.lever\.co\/palantir\/[0-9a-f-]{36}/;
const MAX_WAIT_MS = 20_000;

async function installKeepNamesShim(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.__name ??= (fn: unknown) => fn;
  });
}

async function resolveTwoPostingUrls(page: Page): Promise<[string, string]> {
  await page.goto(LISTING, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const pattern = POSTING_HREF.source;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const hrefs = await page.evaluate((p: string) => {
      const re = new RegExp(p);
      const seen: string[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const h = (a as HTMLAnchorElement).href;
        if (re.test(h) && !seen.includes(h)) seen.push(h);
      }
      return seen;
    }, pattern);
    if (hrefs.length >= 2) return [hrefs[0], hrefs[1]];
    await page.waitForTimeout(250);
  }
  throw new Error(`Fewer than 2 postings found on ${LISTING} within ${MAX_WAIT_MS}ms`);
}

test.describe("cross-posting selector generalization (T065, SC-008)", () => {
  test.skip(!liveCorpusEnabled, skipReason);

  test("a region learned via a picked node generalizes to a different posting on the same board", async ({
    page,
  }) => {
    const [postingA, postingB] = await resolveTwoPostingUrls(page);

    await page.goto(postingA, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500); // Lever's template settles quickly; no SPA hydration wait needed.
    await installKeepNamesShim(page);

    const listResult = await page.evaluate(pickerPageScript, { type: "list" });
    expect(listResult.kind).toBe("candidates");
    if (listResult.kind !== "candidates") throw new Error("unreachable");
    expect(listResult.candidates.length).toBeGreaterThan(0);
    const learnedSelector = listResult.candidates[0].selector;

    await page.goto(postingB, { waitUntil: "commit", timeout: 45_000 });
    await installKeepNamesShim(page);
    const extract = await page.evaluate(extractPage, { learnedSelector });

    expect(extract.provenance.strategy).toBe("learned-selector");
    expect(extract.mainText.length).toBeGreaterThanOrEqual(MIN_TEXT_CHARS);
  });

  test("a region learned via a selection's common ancestor generalizes to a different posting on the same board (FR-023c)", async ({
    page,
  }) => {
    const [postingA, postingB] = await resolveTwoPostingUrls(page);

    await page.goto(postingA, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500);
    await installKeepNamesShim(page);

    const listResult = await page.evaluate(pickerPageScript, { type: "list" });
    expect(listResult.kind).toBe("candidates");
    if (listResult.kind !== "candidates") throw new Error("unreachable");
    const topSelector = listResult.candidates[0].selector;

    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`selector did not match: ${selector}`);
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, topSelector);
    const selectionResult = await page.evaluate(readLiveSelectionInPage);
    expect(selectionResult.ok).toBe(true);
    if (!selectionResult.ok) throw new Error("unreachable");
    const learnedSelector = selectionResult.selector;

    await page.goto(postingB, { waitUntil: "commit", timeout: 45_000 });
    await installKeepNamesShim(page);
    const extract = await page.evaluate(extractPage, { learnedSelector });

    expect(extract.provenance.strategy).toBe("learned-selector");
    expect(extract.mainText.length).toBeGreaterThanOrEqual(MIN_TEXT_CHARS);
  });
});
