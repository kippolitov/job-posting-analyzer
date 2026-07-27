/**
 * Prints the POST-change extraction scoreboard by running the CURRENT
 * extractPage over the captured corpus in real Chromium.
 *
 * This is the counterpart to baselineReport.ts, and the distinction is the
 * whole point: baselineReport.ts reads capture-time numbers out of
 * manifest.json and embeds the old extractor as a frozen string in
 * corpusProbe.ts, so it CANNOT observe a change to pageExtractor.ts. It is the
 * historical baseline SC-002 is a delta against, and neither it nor
 * corpusProbe.ts may be edited. This script is what moves.
 *
 * One row is not reproducible here and that is expected: "predicate passed
 * before text" is derived from live page timings recorded during capture
 * (timeToTextMs > timeToReadyMs). A settled snapshot has no time-to-text, so
 * SC-003 is verified on the jsonld-early hydration fixture instead — see
 * tests/extractor/readiness.spec.ts and tasks.md T028.
 *
 * Usage: npx tsx scripts/rescoreCorpus.ts [--md]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { runExtractor } from "../tests/extractor/helpers/runExtractor";
import { serveFixtures } from "../tests/extractor/helpers/serveFixtures";
import { PROBE_EXPR } from "./corpusProbe";
import type { Probe } from "./corpusProbe";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.join(dirname, "..", "tests", "fixtures", "pages");

interface Entry {
  platform: string;
  baseline: Probe;
}

interface Row {
  slug: string;
  platform: string;
  /** Frozen extractor over THIS snapshot — the honest "was" for an offline delta. */
  wasTextLen: number;
  wasStrategy: string;
  /** Current extractor over the same snapshot. */
  textLen: number;
  strategy: string;
  /** Capture-time number from the LIVE page; a snapshot-fidelity check only. */
  liveTextLen: number;
  jsonLdCount: number;
  head: string;
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
  const md = process.argv.includes("--md");

  const fixtures = await serveFixtures();
  const browser = await chromium.launch();
  const rows: Row[] = [];

  try {
    for (const slug of slugs) {
      const page = await browser.newPage();
      try {
        await page.goto(fixtures.corpus(slug), { waitUntil: "load" });
        // Both extractors over the SAME frozen snapshot. The manifest's
        // baseline was recorded against the live page at capture time, so it is
        // not a valid basis for an offline delta — it is reported separately as
        // a fidelity check that the snapshot still represents the live page.
        const was = (await page.evaluate(PROBE_EXPR)) as Probe;
        const extract = await runExtractor(page);
        rows.push({
          slug,
          platform: entries[slug].platform,
          wasTextLen: was.textLen,
          wasStrategy: was.strategy,
          textLen: extract.mainText.length,
          strategy: extract.provenance.strategy,
          liveTextLen: entries[slug].baseline.textLen,
          jsonLdCount: extract.jsonLd.length,
          head: extract.mainText.slice(0, 60).replace(/\n/g, " "),
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await fixtures.close();
  }

  report(rows, entries, md);
}

function report(rows: Row[], entries: Record<string, Entry>, md: boolean): void {
  const line = (cells: string[]): string =>
    md ? `| ${cells.join(" | ")} |` : cells.map((c, i) => c.padEnd(i === 0 ? 22 : 14)).join("");

  console.log(
    line(["fixture", "platform", "text (was)", "text (now)", "strategy (was)", "strategy (now)"])
  );
  if (md) console.log(`|${"---|".repeat(6)}`);

  for (const r of rows) {
    console.log(
      line([r.slug, r.platform, String(r.wasTextLen), String(r.textLen), r.wasStrategy, r.strategy])
    );
  }

  const n = rows.length;
  const wasBodyFallback = rows.filter((r) => r.wasStrategy === "body").length;
  const bodyFallback = rows.filter((r) => r.strategy === "body").length;
  const shrunk = rows.filter((r) => r.textLen < r.wasTextLen);
  const drifted = rows.filter((r) => Math.abs(r.wasTextLen - r.liveTextLen) > r.liveTextLen * 0.1);

  console.log(`\nCorpus: ${n} fixtures — frozen extractor vs current, same snapshots`);
  console.log(
    `  body-fallback container ....... ${bodyFallback}/${n}   <- was ${wasBodyFallback}/${n}; SC-002 needs <=1/${n}`
  );
  console.log(
    `  selected text shrank .......... ${shrunk.length}/${n}${
      shrunk.length > 0 ? `   <- ${shrunk.map((r) => r.slug).join(", ")}` : "   <- SC-002 ok"
    }`
  );
  console.log(`  predicate passed before text .. n/a  <- capture-time metric; see tasks.md T028`);
  console.log(
    `  snapshot fidelity ............. ${n - drifted.length}/${n} within 10% of the live capture${
      drifted.length > 0 ? `   <- drifted: ${drifted.map((r) => r.slug).join(", ")}` : ""
    }`
  );

  console.log(`\nSelected-text heads (eyeball for chrome leaking in):`);
  for (const r of rows) console.log(`  ${r.slug.padEnd(22)} ${r.head}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
