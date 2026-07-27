import { expect, test } from "@playwright/test";
import { openAndExtract, timeExtraction } from "./helpers/runExtractor";
import { serveFixtures } from "./helpers/serveFixtures";
import type { FixtureServer } from "./helpers/serveFixtures";

/**
 * US1 readiness, asserted in real Chromium against synthetic hydration pages.
 *
 * The captured corpus structurally cannot test this: a saved DOM is ready by
 * construction. These fixtures replay the *timing* the corpus measured.
 */

let fixtures: FixtureServer;

test.beforeAll(async () => {
  fixtures = await serveFixtures();
});

test.afterAll(async () => {
  await fixtures.close();
});

// The budget (6000 ms) plus room for the assertion itself.
test.describe.configure({ timeout: 30_000 });

test("jsonld-early: does not return on JSON-LD alone before body text exists", async ({
  page,
}) => {
  // THE test. Today's predicate — jsonLd.length > 0 || text >= 300 — is
  // satisfied at 0 ms here, with an empty body. A retry loop that reuses it
  // returns immediately with no posting text and is no better than today
  // (FR-001, FR-004a). Body text lands at 1500 ms.
  const { extract, elapsedMs } = await timeExtraction(page, fixtures.hydration("jsonld-early"));

  expect(extract.jsonLd.length).toBe(1);
  expect(extract.mainText.length).toBeGreaterThanOrEqual(300);
  expect(extract.mainText).toContain("ingestion pipelines");
  // Must have waited for the text rather than returning on the JSON-LD.
  expect(elapsedMs).toBeGreaterThan(1000);
  expect(extract.provenance.budgetExpired).toBe(false);
  expect(extract.provenance.attempts).toBeGreaterThan(1);
});

test("phenom-like: returns the settled posting, not the first 300 characters", async ({
  page,
}) => {
  // Text starts at ~3400 ms and grows until ~4300 ms. Returning at first
  // crossing captures ~3% of the posting (FR-002, SC-001).
  const extract = await openAndExtract(page, fixtures.hydration("phenom-like"));

  expect(extract.mainText.length).toBeGreaterThan(11_000);
  expect(extract.provenance.budgetExpired).toBe(false);
});

test("never: gives up inside the budget and says so", async ({ page }) => {
  // The page mutates forever without ever yielding posting text. A loop driven
  // only by observed change would never stop; the hard budget is what does
  // (FR-003, SC-005).
  const { extract, elapsedMs } = await timeExtraction(page, fixtures.hydration("never"));

  expect(extract.provenance.budgetExpired).toBe(true);
  expect(extract.mainText.length).toBeLessThan(300);
  expect(elapsedMs).toBeLessThan(8000);
  expect(elapsedMs).toBeGreaterThanOrEqual(6000);
});

test("fast: returns promptly once text stabilizes", async ({ page }) => {
  // Text lands at 200 ms. Returning should follow within about one stability
  // window, not wait out the budget (SC-004). This is the population the
  // stability window taxes on every analysis.
  const { extract, elapsedMs } = await timeExtraction(page, fixtures.hydration("fast"));

  expect(extract.mainText.length).toBeGreaterThanOrEqual(3900);
  expect(extract.provenance.budgetExpired).toBe(false);
  expect(elapsedMs).toBeLessThan(1200);
});

test("QG-4: settled pages pay the fast path, not the budget", async ({ page }) => {
  // The constitution IV 20% p95 regression gate must be evaluated against fast
  // pages. Measuring only the Phenom case would hide a regression on
  // everything else (plan.md Constitution Check IV). A corpus snapshot is
  // settled by construction, so it exercises the fast path exactly.
  const samples: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const { extract, elapsedMs } = await timeExtraction(page, fixtures.corpus("greenhouse-discord"));
    expect(extract.mainText.length).toBeGreaterThan(10_000);
    samples.push(elapsedMs);
  }

  const p95 = samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
  // Fast path is 150 ms of quiet plus evaluation overhead; a settled page must
  // never approach the 6000 ms budget.
  expect(p95).toBeLessThan(1000);
});
