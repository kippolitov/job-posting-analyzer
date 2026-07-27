/**
 * Prints the pre-change extraction baseline from the captured corpus
 * (specs/005-resilient-extraction/spec.md — SC-002/SC-003 are defined against
 * these numbers). Read-only: run captureCorpus.ts first.
 *
 * Usage: npx tsx scripts/baselineReport.ts [--md]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Probe } from "./corpusProbe";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.join(dirname, "..", "tests", "fixtures", "pages");

interface Entry {
  platform: string;
  note: string;
  url: string;
  capturedAt: string;
  timeToReadyMs: number | null;
  timeToTextMs: number | null;
  timeToSettleMs: number | null;
  readyOnFirstPoll: boolean;
  baseline: Probe;
}

function main(): void {
  const manifestPath = path.join(corpusDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No corpus at ${corpusDir}. Run: npx tsx scripts/captureCorpus.ts`);
  }
  const entries = (
    JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { entries: Record<string, Entry> }
  ).entries;
  const rows = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));
  const md = process.argv.includes("--md");

  const line = (cells: string[]): string =>
    md ? `| ${cells.join(" | ")} |` : cells.map((c, i) => c.padEnd(i === 0 ? 22 : 14)).join("");

  console.log(line(["fixture", "platform", "predicate@", "text@", "settled@", "text", "jsonLd", "strategy"]));
  if (md) console.log(`|${"---|".repeat(8)}`);

  let bodyFallback = 0;
  let anyStructured = 0;
  let predicateBeforeText = 0;

  for (const [slug, e] of rows) {
    const b = e.baseline;
    if (b.strategy === "body") bodyFallback++;
    if (b.jsonLdCount > 0 || b.signals.microdata > 0) anyStructured++;
    if (e.timeToReadyMs !== null && e.timeToTextMs !== null && e.timeToTextMs > e.timeToReadyMs) {
      predicateBeforeText++;
    }
    console.log(
      line([
        slug,
        e.platform,
        `${e.timeToReadyMs ?? "—"}ms`,
        `${e.timeToTextMs ?? "—"}ms`,
        `${e.timeToSettleMs ?? "—"}ms`,
        String(b.textLen),
        String(b.jsonLdCount),
        b.strategy,
      ])
    );
  }

  const n = rows.length;
  const settle = rows.map(([, e]) => e.timeToSettleMs ?? 0);
  const text = rows.map(([, e]) => e.timeToTextMs ?? 0);
  const max = (xs: number[]): number => xs.reduce((a, b) => Math.max(a, b), 0);

  console.log(`\nCorpus: ${n} fixtures`);
  console.log(`  slowest time-to-text .......... ${max(text)}ms`);
  console.log(`  slowest time-to-settle ........ ${max(settle)}ms   <- the readiness budget floor`);
  console.log(`  body-fallback container ....... ${bodyFallback}/${n}`);
  console.log(`  has JSON-LD or microdata ...... ${anyStructured}/${n}`);
  console.log(`  predicate passed before text .. ${predicateBeforeText}/${n}   <- returns with thin/empty text today`);

  const blobs = rows.flatMap(([slug, e]) => e.baseline.discovered.map((d) => `${slug}: ${d.where} (${d.bytes}B)`));
  console.log(`  posting-shaped state blobs .... ${blobs.length === 0 ? "none found" : blobs.join(", ")}`);
}

main();
