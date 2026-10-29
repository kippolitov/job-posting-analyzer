/**
 * Exports the captured pages corpus as the exact analyze-job wire extracts the
 * extension would send, for the functions eval harness (specs/006 research R3).
 *
 * Runs the SHIPPING extractPage over each settled.html in real Chromium, the
 * same lane as rescoreCorpus.ts, and writes
 * functions/tests/fixtures/postings/full/<slug>.json. The output is committed
 * so the functions eval never needs Playwright. Re-run only when the pages
 * corpus or pageExtractor.ts changes.
 *
 * `url` and `canonicalUrl` are the captured page's live URL, not the localhost
 * fixture server's, and `extractedAt` is the capture time, so a re-run with an
 * unchanged extractor produces byte-identical files.
 *
 * Usage: npx tsx scripts/exportCorpusExtracts.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { canonicalize } from "../lib/canonicalUrl";
import { MAIN_TEXT_CAP } from "../lib/pageExtractor";
import { runExtractor } from "../tests/extractor/helpers/runExtractor";
import { serveFixtures } from "../tests/extractor/helpers/serveFixtures";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.join(dirname, "..", "tests", "fixtures", "pages");
const outDir = path.join(
  dirname,
  "..",
  "..",
  "functions",
  "tests",
  "fixtures",
  "postings",
  "full"
);

/** Exported for the thin-content guard, never scored for fit. */
const NOT_SCORABLE = new Set(["thin-posting-control"]);

interface Entry {
  url: string;
  capturedAt: string;
}

async function main(): Promise<void> {
  const manifestPath = path.join(corpusDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No corpus at ${corpusDir}. Run: npx tsx scripts/captureCorpus.ts`);
  }
  const entries = (
    JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { entries: Record<string, Entry> }
  ).entries;
  const slugs = Object.keys(entries).sort();
  fs.mkdirSync(outDir, { recursive: true });

  const fixtures = await serveFixtures();
  const browser = await chromium.launch();

  try {
    for (const slug of slugs) {
      const page = await browser.newPage();
      try {
        await page.goto(fixtures.corpus(slug), { waitUntil: "load" });
        const raw = await runExtractor(page);
        const { url, capturedAt } = entries[slug];
        const extract = {
          url,
          canonicalUrl: canonicalize(url),
          title: raw.title,
          jsonLd: raw.jsonLd,
          structuredSources: raw.structuredSources,
          mainText: raw.mainText.slice(0, MAIN_TEXT_CAP),
          extractedAt: capturedAt,
          ...(NOT_SCORABLE.has(slug) ? { expectNotScorable: true } : {}),
        };
        const file = path.join(outDir, `${slug}.json`);
        fs.writeFileSync(file, `${JSON.stringify(extract, null, 2)}\n`);
        console.log(`${slug.padEnd(22)} ${String(extract.mainText.length).padStart(6)} chars`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await fixtures.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
