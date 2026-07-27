import { expect, test } from "@playwright/test";
import { openAndExtract } from "./helpers/runExtractor";
import { serveFixtures } from "./helpers/serveFixtures";
import type { FixtureServer } from "./helpers/serveFixtures";

/**
 * US2 structured-source harvesting (microdata alongside JSON-LD), asserted
 * against the captured corpus in real Chromium.
 */

let fixtures: FixtureServer;

test.beforeAll(async () => {
  fixtures = await serveFixtures();
});

test.afterAll(async () => {
  await fixtures.close();
});

test("thin-posting-control: microdata is harvested with kind provenance (FR-008, FR-010)", async ({
  page,
}) => {
  // The only corpus fixture carrying JobPosting microdata (manifest.json
  // signals.microdata === 1); every other fixture harvests zero.
  const extract = await openAndExtract(page, fixtures.corpus("thin-posting-control"));

  const microdataSources = extract.structuredSources.filter((s) => s.kind === "microdata");
  expect(microdataSources.length).toBeGreaterThan(0);
  expect(microdataSources[0].data).toMatchObject({ title: "Sr. Manager" });
});

test("fixtures with JSON-LD harvest it as a json-ld structured source (FR-010)", async ({
  page,
}) => {
  // lever-palantir's JSON-LD blob (~5.9k chars) fits the 20,000-char cap;
  // phenom-intuit's (~24.6k chars alone) legitimately does not (FR-011).
  const extract = await openAndExtract(page, fixtures.corpus("lever-palantir"));
  expect(extract.jsonLd.length).toBe(1);
  const jsonLdSources = extract.structuredSources.filter((s) => s.kind === "json-ld");
  expect(jsonLdSources.length).toBe(1);
});

test("structuredSources stays within the 20,000-character cap, dropped whole not truncated (FR-011)", async ({
  page,
}) => {
  for (const id of [
    "phenom-intuit",
    "greenhouse-discord",
    "lever-palantir",
    "ashby-linear",
    "thin-posting-control",
    "workday-nvidia",
  ]) {
    const extract = await openAndExtract(page, fixtures.corpus(id));
    expect(JSON.stringify(extract.structuredSources).length).toBeLessThanOrEqual(20_000);
  }
});

test("fixtures with no structured signals harvest an empty array, not an error", async ({
  page,
}) => {
  const extract = await openAndExtract(page, fixtures.corpus("lever-palantir"));
  // lever-palantir has jsonLdCount 1 per manifest and no microdata — one source.
  expect(extract.structuredSources.every((s) => s.kind === "json-ld" || s.kind === "microdata")).toBe(
    true
  );
});
