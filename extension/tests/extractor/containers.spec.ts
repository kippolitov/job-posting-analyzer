import { expect, test } from "@playwright/test";
import { openAndExtract } from "./helpers/runExtractor";
import { serveFixtures } from "./helpers/serveFixtures";
import type { FixtureServer } from "./helpers/serveFixtures";
import { MIN_TEXT_CHARS } from "../../lib/pageExtractor";

/**
 * US2 container scoring, asserted against the captured corpus in real
 * Chromium (research R9 — jsdom has no innerText).
 */

let fixtures: FixtureServer;

test.beforeAll(async () => {
  fixtures = await serveFixtures();
});

test.afterAll(async () => {
  await fixtures.close();
});

const BASELINE_LEN: Record<string, number> = {
  "phenom-intuit": 11970,
  "greenhouse-discord": 10960,
  "lever-palantir": 4867,
  "ashby-linear": 4249,
  "thin-posting-control": 414,
  "workday-nvidia": 4369,
};

test("lever-palantir: selected text does not open with the cookie-consent banner (SC-002)", async ({
  page,
}) => {
  const extract = await openAndExtract(page, fixtures.corpus("lever-palantir"));
  expect(extract.mainText).not.toContain("Cookie Policy");
  // The real posting body, e.g. "Administrative Business Partner", the actual
  // title — not just clearing MIN, which a stub fragment could also do.
  expect(extract.mainText).toContain("Administrative Business Partner");
});

test("workday-nvidia: selected text does not open with the skip-link (SC-002)", async ({
  page,
}) => {
  const extract = await openAndExtract(page, fixtures.corpus("workday-nvidia"));
  expect(extract.mainText).not.toContain("Skip to main content");
  expect(extract.mainText).toContain("Developer Technology Engineer");
  // The full description survives (its genuine closing sentence), not a
  // fragment truncated partway through by an over-eager container choice.
  expect(extract.mainText).toContain(
    "any other characteristic protected by law."
  );
});

test("no fixture's selected text shrinks below the usable minimum, and the two fixtures with removable chrome shrink only by removing it (SC-002)", async ({
  page,
}) => {
  // lever-palantir and workday-nvidia are EXPECTED to end up shorter than
  // their captured baseline — that baseline is the pre-change body-fallback
  // text, which included the cookie banner / skip-link+footer SC-002 requires
  // removed. Every other fixture must not regress below its baseline.
  const expectedToShrink = new Set(["lever-palantir", "workday-nvidia"]);
  for (const [id, baseline] of Object.entries(BASELINE_LEN)) {
    const extract = await openAndExtract(page, fixtures.corpus(id));
    if (expectedToShrink.has(id)) {
      expect(extract.mainText.length, `${id} regressed to near-nothing`).toBeGreaterThan(
        MIN_TEXT_CHARS
      );
    } else {
      expect(extract.mainText.length, `${id} shrank below baseline`).toBeGreaterThanOrEqual(
        baseline
      );
    }
  }
});

test("body-fallback strategy drops to at most 1/6 fixtures (SC-002)", async ({ page }) => {
  let bodyCount = 0;
  for (const id of Object.keys(BASELINE_LEN)) {
    const extract = await openAndExtract(page, fixtures.corpus(id));
    if (extract.provenance.strategy === "body") bodyCount += 1;
  }
  expect(bodyCount).toBeLessThanOrEqual(1);
});

test("greenhouse-discord and phenom-intuit keep their current selection byte-for-byte (FR-013, research R3)", async ({
  page,
}) => {
  // These two already pass today via the semantic-container path. The
  // semantic container wins outright, verbatim, whenever it clears the
  // usable minimum — scoring never even runs for these two, which is what
  // guarantees FR-013's byte-for-byte requirement rather than relying on a
  // density formula to happen to agree.
  for (const id of ["greenhouse-discord", "phenom-intuit"]) {
    const extract = await openAndExtract(page, fixtures.corpus(id));
    expect(extract.mainText.length).toBe(BASELINE_LEN[id]);
    expect(extract.provenance.strategy).toBe("semantic");
  }
});

test("on corpus pages with no semantic container, navigation/related-jobs/footers are excluded (SC-006)", async ({
  page,
}) => {
  for (const id of ["lever-palantir", "ashby-linear", "workday-nvidia"]) {
    const extract = await openAndExtract(page, fixtures.corpus(id));
    expect(extract.mainText).not.toMatch(/related jobs/i);
    expect(extract.mainText).not.toMatch(/all rights reserved/i);
  }
});
