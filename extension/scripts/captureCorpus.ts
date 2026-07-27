/**
 * Captures the extraction fixture corpus
 * (specs/005-resilient-extraction/spec.md — Measurement Corpus).
 *
 * Usage: npx tsx scripts/captureCorpus.ts [--only=<platform>] [--headed]
 *
 * For each source it resolves a live posting from that platform's listing page
 * (postings expire; hard-coded posting URLs rot), then measures the thing the
 * readiness budget actually depends on: **time-to-usable** — how long after
 * navigation commit the shipped extractor's predicate first passes.
 *
 * Output per posting, under tests/fixtures/pages/<slug>/:
 *   served.html   raw origin response, no JS (what a static snapshot sees)
 *   settled.html  document.documentElement.outerHTML once the page stops changing
 *   meta.json     timings, the full poll trace, and the baseline probe
 *
 * IMPORTANT: settled.html is a DOM snapshot, not a replayable site. It is
 * enough to re-measure container selection and structured-signal harvesting
 * (Story 2) offline and in CI, but it CANNOT exercise readiness (Story 1) —
 * a snapshot is ready by construction. Story 1's budget comes from the
 * timings recorded here against live sites, and its regression test needs a
 * synthetic delayed-hydration fixture instead.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROBE_EXPR, type Probe } from "./corpusProbe";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dirname, "..", "tests", "fixtures", "pages");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Poll cadence and ceiling for the readiness measurement. */
const POLL_MS = 100;
const MAX_WAIT_MS = 20_000;
/** Text length must hold steady this long before the page counts as settled. */
const QUIET_MS = 600;

interface Source {
  slug: string;
  platform: string;
  /** Listing page to resolve a live posting from. */
  listing?: string;
  /** Anchor hrefs matching this are postings. */
  postingHref?: RegExp;
  /** Bypasses listing resolution when a stable posting URL is known. */
  directUrl?: string;
  /**
   * Reject a candidate posting yielding less settled text than this and try
   * the next link on the board. Boards carry stub postings with no description
   * (measured: a Visa "Sr. Manager" whose entire document is 2,061 chars), and
   * a stub silently becomes a fixture that proves nothing about extraction.
   * Set 0 to keep whatever the first link gives — used for the deliberate
   * thin-posting control.
   */
  minTextChars?: number;
  /** Why this source is in the corpus. */
  note: string;
}

const DEFAULT_MIN_TEXT = 1500;
/** How many board links to try before accepting the best of a bad lot. */
const MAX_CANDIDATES = 4;

const SOURCES: Source[] = [
  {
    slug: "phenom-intuit",
    platform: "Phenom People",
    directUrl:
      "https://jobs.intuit.com/job/new-york/staff-software-engineer/27595/97097980048?cid=seo_google",
    note: "The reported failure. Client-hydrated main; extraction succeeds once settled.",
  },
  {
    slug: "greenhouse-discord",
    platform: "Greenhouse",
    listing: "https://job-boards.greenhouse.io/discord",
    postingHref: /\/discord\/jobs\/\d+/,
    note: "Largely server-rendered — the control case for 'already ready, no added latency'.",
  },
  {
    slug: "lever-palantir",
    platform: "Lever",
    listing: "https://jobs.lever.co/palantir",
    postingHref: /jobs\.lever\.co\/palantir\/[0-9a-f-]{36}/,
    note: "Lever's standard posting template.",
  },
  {
    slug: "ashby-linear",
    platform: "Ashby",
    listing: "https://jobs.ashbyhq.com/linear",
    postingHref: /\/linear\/[0-9a-f-]{36}/,
    note: "Client-rendered React board; posting body arrives after hydration.",
  },
  {
    slug: "thin-posting-control",
    platform: "SmartRecruiters",
    directUrl: "https://jobs.smartrecruiters.com/Visa/744000133907678-sr-manager",
    minTextChars: 0,
    note:
      "SmartRecruiters' posting template, and a TRUE NEGATIVE rather than a " +
      "failure. A stub posting: 2,061 chars in the whole " +
      "document, 414 in main, stable to 15s. No extraction strategy can rescue " +
      "it. Guards against 'improvements' that fabricate content on thin pages, " +
      "and is the correct target for the thin-content error.",
  },
  {
    slug: "workday-nvidia",
    platform: "Workday",
    listing: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    postingHref: /\/NVIDIAExternalCareerSite\/job\//,
    note: "Fully client-rendered; the hardest readiness case and a likely no-semantic-container case.",
  },
];

interface PollSample {
  t: number;
  /** Current extractor's predicate (passes on JSON-LD alone). */
  ready: boolean;
  /** Body text alone cleared the minimum. */
  textReady: boolean;
  textLen: number;
  jsonLdCount: number;
}

interface CaptureMeta {
  slug: string;
  platform: string;
  note: string;
  url: string;
  capturedAt: string;
  /** ms from navigation commit until the CURRENT extractor's predicate passed. */
  timeToReadyMs: number | null;
  /** ms until body text alone cleared the minimum — the real readiness signal. */
  timeToTextMs: number | null;
  /** ms until selected-text length held steady for QUIET_MS. */
  timeToSettleMs: number | null;
  /** True when the FIRST poll (~immediately after commit) already passed. */
  readyOnFirstPoll: boolean;
  trace: PollSample[];
  baseline: Probe;
  servedBytes: number;
  settledBytes: number;
  /** Held in memory while candidates are compared; stripped before meta.json. */
  servedHtml: string;
  settledHtml: string;
}

async function resolvePostingUrls(page: Page, source: Source): Promise<string[]> {
  if (source.directUrl) return [source.directUrl];
  if (!source.listing || !source.postingHref) {
    throw new Error(`${source.slug}: needs directUrl or listing+postingHref`);
  }

  await page.goto(source.listing, { waitUntil: "domcontentloaded", timeout: 45_000 });

  const pattern = source.postingHref.source;
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
    if (hrefs.length > 0) return hrefs.slice(0, MAX_CANDIDATES);
    await page.waitForTimeout(250);
  }
  throw new Error(
    `${source.slug}: no posting link matching ${source.postingHref} on ${source.listing} ` +
      `within ${MAX_WAIT_MS}ms (board may be empty or the URL shape changed)`
  );
}

async function capture(browser: Browser, source: Source): Promise<CaptureMeta> {
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  try {
    const resolver = await context.newPage();
    let candidates: string[];
    try {
      candidates = await resolvePostingUrls(resolver, source);
    } finally {
      await resolver.close();
    }

    const floor = source.minTextChars ?? DEFAULT_MIN_TEXT;
    let best: CaptureMeta | null = null;
    for (const url of candidates) {
      const meta = await captureOne(context, source, url);
      if (!best || meta.baseline.textLen > best.baseline.textLen) best = meta;
      if (meta.baseline.textLen >= floor) break;
      if (candidates.length > 1) {
        process.stdout.write(`(${meta.baseline.textLen}<${floor}, next) `);
      }
    }
    if (!best) throw new Error(`${source.slug}: no candidate captured`);

    const dir = path.join(outDir, source.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "served.html"), best.servedHtml);
    fs.writeFileSync(path.join(dir, "settled.html"), best.settledHtml);
    const { servedHtml: _s, settledHtml: _h, ...persisted } = best;
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(persisted, null, 2));
    return best;
  } finally {
    await context.close();
  }
}

async function captureOne(
  context: BrowserContext,
  source: Source,
  url: string
): Promise<CaptureMeta> {
  const page = await context.newPage();
  try {
    // Raw origin response, no JS — what a flattened static snapshot would see.
    const served = await context.request.get(url, { headers: { "User-Agent": UA } });
    const servedHtml = await served.text();

    // waitUntil "commit" starts the clock at the earliest point the extension
    // could plausibly be asked to extract.
    await page.goto(url, { waitUntil: "commit", timeout: 45_000 });
    const t0 = Date.now();

    const trace: PollSample[] = [];
    let timeToReadyMs: number | null = null;
    let timeToTextMs: number | null = null;
    let timeToSettleMs: number | null = null;
    let lastLen = -1;
    let lastChangeAt = t0;

    while (Date.now() - t0 < MAX_WAIT_MS) {
      let probe: Probe;
      try {
        probe = (await page.evaluate(PROBE_EXPR)) as Probe;
      } catch {
        // Navigation / reload mid-evaluate — skip this sample.
        await page.waitForTimeout(POLL_MS);
        continue;
      }
      const t = Date.now() - t0;
      trace.push({
        t,
        ready: probe.ready,
        textReady: probe.textReady,
        textLen: probe.textLen,
        jsonLdCount: probe.jsonLdCount,
      });

      if (probe.ready && timeToReadyMs === null) timeToReadyMs = t;
      if (probe.textReady && timeToTextMs === null) timeToTextMs = t;

      // Settle on the TEXT, never on `ready`. `ready` passes the moment
      // JSON-LD lands — on JSON-LD-bearing SPAs that is before the body text
      // exists at all, so settling on it stops the clock at zero text and
      // reports a fictitious time-to-ready.
      if (probe.textLen !== lastLen) {
        lastLen = probe.textLen;
        lastChangeAt = Date.now();
      } else if (probe.textReady && Date.now() - lastChangeAt >= QUIET_MS) {
        timeToSettleMs = t;
        break;
      }
      await page.waitForTimeout(POLL_MS);
    }

    const baseline = (await page.evaluate(PROBE_EXPR)) as Probe;
    const settledHtml = await page.evaluate(() => document.documentElement.outerHTML);

    return {
      slug: source.slug,
      platform: source.platform,
      note: source.note,
      url,
      capturedAt: new Date().toISOString(),
      timeToReadyMs,
      timeToTextMs,
      timeToSettleMs,
      readyOnFirstPoll: trace[0]?.ready ?? false,
      trace,
      baseline,
      servedBytes: servedHtml.length,
      settledBytes: settledHtml.length,
      servedHtml,
      settledHtml,
    };
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  const headed = process.argv.includes("--headed");
  const sources = only ? SOURCES.filter((s) => s.slug.includes(only) || s.platform.toLowerCase().includes(only.toLowerCase())) : SOURCES;
  if (sources.length === 0) throw new Error(`No source matches --only=${only}`);

  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: !headed });
  const captured: CaptureMeta[] = [];
  const failed: { slug: string; error: string }[] = [];

  try {
    for (const source of sources) {
      process.stdout.write(`capturing ${source.slug} (${source.platform})… `);
      try {
        const meta = await capture(browser, source);
        captured.push(meta);
        console.log(
          `ok — predicate@${meta.timeToReadyMs ?? "never"}ms text@${meta.timeToTextMs ?? "never"}ms settled@${meta.timeToSettleMs ?? "never"}ms ` +
            `text=${meta.baseline.textLen} jsonLd=${meta.baseline.jsonLdCount} strategy=${meta.baseline.strategy}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ slug: source.slug, error: message });
        console.log(`FAILED — ${message.split("\n")[0]}`);
      }
    }
  } finally {
    await browser.close();
  }

  // Merge into the manifest rather than overwriting: a partial run (--only, or
  // a board that was down) must not drop previously captured entries.
  const manifestPath = path.join(outDir, "manifest.json");
  const existing: Record<string, unknown> = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { entries?: Record<string, unknown> }).entries ?? {}
    : {};
  for (const meta of captured) {
    existing[meta.slug] = {
      platform: meta.platform,
      note: meta.note,
      url: meta.url,
      capturedAt: meta.capturedAt,
      timeToReadyMs: meta.timeToReadyMs,
      timeToTextMs: meta.timeToTextMs,
      timeToSettleMs: meta.timeToSettleMs,
      readyOnFirstPoll: meta.readyOnFirstPoll,
      baseline: meta.baseline,
    };
  }
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ updatedAt: new Date().toISOString(), entries: existing }, null, 2)
  );

  console.log(`\n${captured.length} captured, ${failed.length} failed → ${outDir}`);
  for (const f of failed) console.log(`  ! ${f.slug}: ${f.error.split("\n")[0]}`);
}

void main();
