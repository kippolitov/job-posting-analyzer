/**
 * Accuracy eval for the job analyzer (SC-001 / SC-002 / SC-008), extended with
 * the fit eval that decides the scoring model (specs/006 FR-M03,
 * contracts/eval-harness.md). Makes live model calls; on demand, never in CI.
 *
 * Usage:
 *   npm run eval:postings [-- --tier=premium]
 *   npm run eval:postings -- --configs=scripts/evalConfigs.json
 *       [--runs=5] [--concurrency=2] [--only=<postingId>] [--out=<file.json>]
 *   npm run eval:postings -- --report=<saved.json> [--out=<file.json>]
 *
 * Without --configs it behaves as it always has: one tier, arrangement metrics
 * only, over tests/fixtures/postings/manifest.json. --tier=free (default) uses
 * AZURE_OPENAI_JOB_DEPLOYMENT; --tier=premium uses
 * AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM (specs/003-freemium-premium-tier/eval-premium.md).
 *
 * With --configs, each configuration overrides the tier's model settings in
 * process.env and scores every pair in tests/fixtures/profiles/pairs.json
 * --runs times, over the short postings and the full-length postings in
 * postings/full/. Each violating pair is also scored with the profile's
 * dealbreakers and preferences stripped, for SC-002's score independence. The
 * process exits non-zero only when a configuration with "gate": true misses a
 * target.
 *
 * --report rebuilds the reports from a saved --out file without model calls,
 * for example after scripts/judgeViolations.ts has added judged violations.
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import {
  orchestrateJobAnalysis,
  type ModelUsage,
} from "../src/services/jobExtractionOrchestrator";
import type { AnalyzeJobRequest, JobAnalysisResponse, PageExtractPayload } from "../src/models/job";
import type { Tier } from "../src/models/user";
import { profileToPromptText } from "../../shared/types/profile";
import {
  bandFor,
  costPerAnalysis,
  falseDealbreakers,
  median,
  missedDealbreakers,
  p95,
  pairKey,
  reportedViolations,
  scoreIndependence,
  truncations,
  verdictStability,
  type Band,
  type PairLabel,
  type Price,
  type ScoredResult,
} from "./evalMetrics";

interface ManifestEntry {
  file: string;
  /** Human-labeled ground truth. */
  expected: {
    arrangement: "remote" | "hybrid" | "onsite" | "unspecified";
    daysInOffice: number | null;
    /** True when the posting states the arrangement outright. */
    stated: boolean;
  };
}

interface EvalConfig {
  label: string;
  tier: Tier;
  deployment: string;
  temperature?: number;
  reasoningEffort?: string;
  gate: boolean;
}

interface FixtureProfile {
  id: string;
  text: string;
  dealbreakers: string[];
}

interface PriceEntry extends Price {
  source: string;
  asOf: string;
}

const fixturesDir = path.join(__dirname, "..", "tests", "fixtures");
const postingsDir = path.join(fixturesDir, "postings");

/** Above this, long-context pricing may apply; the spec could not confirm the threshold. */
const LONG_CONTEXT_TOKENS = 32_000;
const MAX_429_RETRIES = 5;

// Load env from local.settings.json, same as devServer.ts / func CLI.
try {
  const settings = JSON.parse(
    readFileSync(path.join(__dirname, "..", "local.settings.json"), "utf-8")
  ) as { Values?: Record<string, string> };
  for (const [key, value] of Object.entries(settings.Values ?? {})) {
    process.env[key] = process.env[key] ?? value;
  }
} catch {
  // Fall back to ambient environment variables.
}

function flag(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function positiveInt(argv: string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function parseTier(argv: string[]): Tier {
  const value = flag(argv, "tier");
  if (value === "premium") return "premium";
  if (value && value !== "free") {
    throw new Error(`--tier must be "free" or "premium", got "${value}"`);
  }
  return "free";
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf-8")) as T;
}

function syntheticExtract(id: string, mainText: string): PageExtractPayload {
  return {
    url: `https://eval.example/postings/${id}`,
    canonicalUrl: `https://eval.example/postings/${id}`,
    title: id,
    jsonLd: [],
    mainText,
    extractedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Arrangement-only eval (no --configs): unchanged behaviour.
// ---------------------------------------------------------------------------

async function runArrangementEval(tier: Tier): Promise<void> {
  const manifest = readJson<ManifestEntry[]>(path.join(postingsDir, "manifest.json"));

  const available = new Set(readdirSync(postingsDir));
  let correctArrangement = 0;
  let contradictions = 0;
  let hybridExpected = 0;
  let hybridDaysCorrect = 0;
  const failures: string[] = [];
  const latenciesMs: number[] = [];
  let deploymentName = "";

  for (const entry of manifest) {
    if (!available.has(entry.file)) {
      console.warn(`skipping ${entry.file}: fixture file missing`);
      continue;
    }
    const mainText = readFileSync(path.join(postingsDir, entry.file), "utf-8");
    const startedAt = Date.now();
    const result = await orchestrateJobAnalysis(
      { extract: syntheticExtract(entry.file, mainText) },
      tier
    );
    latenciesMs.push(Date.now() - startedAt);
    deploymentName = result.model;

    const arrangementOk = result.arrangement === entry.expected.arrangement;
    if (arrangementOk) {
      correctArrangement++;
    } else {
      failures.push(
        `${entry.file}: expected ${entry.expected.arrangement}, got ${result.arrangement}` +
          (result.arrangementEvidence ? ` (evidence: "${result.arrangementEvidence}")` : "")
      );
      // A contradiction is being wrong about an arrangement the posting states outright.
      if (entry.expected.stated) contradictions++;
    }

    if (entry.expected.arrangement === "hybrid" && entry.expected.daysInOffice !== null) {
      hybridExpected++;
      if (result.daysInOffice === entry.expected.daysInOffice) hybridDaysCorrect++;
      else
        failures.push(
          `${entry.file}: expected ${entry.expected.daysInOffice} days in office, got ${result.daysInOffice}`
        );
    }
  }

  const total = manifest.length;
  const accuracy = total > 0 ? (correctArrangement / total) * 100 : 0;
  const p95Ms = p95(latenciesMs);

  console.log(`\n=== Job analyzer eval (SC-001 / SC-002 / SC-008) — tier: ${tier} ===`);
  console.log(`Deployment:                    ${deploymentName || "(none evaluated)"}`);
  console.log(`Postings evaluated:            ${total}`);
  console.log(`Arrangement accuracy:          ${accuracy.toFixed(1)}% (target ≥ 90%)`);
  console.log(`Stated-arrangement conflicts:  ${contradictions} (target 0)`);
  console.log(
    `Hybrid day counts:             ${hybridDaysCorrect}/${hybridExpected} extracted correctly`
  );
  console.log(
    `Latency p95:                   ${(p95Ms / 1000).toFixed(1)}s (target ≤ 30s, Constitution IV/QG-4)`
  );
  if (failures.length > 0) {
    console.log("\nMisses:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  if (total < 50) {
    console.warn(
      `\nWARNING: validation set has ${total} postings; SC-001 requires 50 before release sign-off.`
    );
  }

  const pass =
    accuracy >= 90 &&
    contradictions === 0 &&
    hybridDaysCorrect === hybridExpected &&
    p95Ms <= 30_000;
  if (total >= 50 && !pass) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Configuration eval (--configs): fit + arrangement + tokens + cost + latency.
// ---------------------------------------------------------------------------

interface Posting {
  id: string;
  extract: PageExtractPayload;
  expected?: ManifestEntry["expected"];
}

interface Task {
  posting: Posting;
  profile: FixtureProfile;
  run: number;
  /** Scored with dealbreakers and preferences removed (SC-002). */
  stripped: boolean;
}

interface TaskResult {
  posting: string;
  profile: string;
  run: number;
  stripped: boolean;
  model?: string;
  arrangement?: string;
  daysInOffice?: number | null;
  fit?: JobAnalysisResponse["fit"];
  usages: ModelUsage[];
  latencyMs?: number;
  costUsd?: number;
  error?: string;
  /** Added by scripts/judgeViolations.ts. */
  judgedViolations?: string[];
}

function loadPostings(only: string | undefined): Posting[] {
  const manifest = readJson<ManifestEntry[]>(path.join(postingsDir, "manifest.json"));
  const short = manifest.map((entry) => ({
    id: entry.file.replace(/\.txt$/, ""),
    extract: syntheticExtract(
      entry.file,
      readFileSync(path.join(postingsDir, entry.file), "utf-8")
    ),
    expected: entry.expected,
  }));
  const fullDir = path.join(postingsDir, "full");
  const full = readdirSync(fullDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const { expectNotScorable, ...extract } = readJson<
        PageExtractPayload & { expectNotScorable?: boolean }
      >(path.join(fullDir, file));
      return { id: file.replace(/\.json$/, ""), extract, notScorable: expectNotScorable === true };
    })
    .filter((posting) => !posting.notScorable)
    .map(({ id, extract }) => ({ id, extract }));
  return [...short, ...full].filter((posting) => only === undefined || posting.id === only);
}

function loadProfiles(): Map<string, FixtureProfile> {
  const dir = path.join(fixturesDir, "profiles");
  return new Map(
    readdirSync(dir)
      .filter((file) => file.endsWith(".json") && file !== "pairs.json")
      .map((file) => readJson<FixtureProfile>(path.join(dir, file)))
      .map((profile) => [profile.id, profile])
  );
}

/** Points the config's tier at its deployment; "" clears a setting (modelConfig treats it as unset). */
function applyConfig(config: EvalConfig): void {
  const suffix = config.tier === "premium" ? "_PREMIUM" : "";
  process.env[`AZURE_OPENAI_JOB_DEPLOYMENT${suffix}`] = config.deployment;
  process.env[`AZURE_OPENAI_JOB_TEMPERATURE${suffix}`] =
    config.temperature === undefined ? "" : String(config.temperature);
  process.env[`AZURE_OPENAI_JOB_REASONING_EFFORT${suffix}`] = config.reasoningEffort ?? "";
}

function isRateLimited(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: unknown }).status === 429;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTask(task: Task, config: EvalConfig, price: Price | undefined): Promise<TaskResult> {
  const profile = task.stripped ? { text: task.profile.text, dealbreakers: [] } : task.profile;
  const request: AnalyzeJobRequest = {
    extract: task.posting.extract,
    profile: profileToPromptText(profile),
  };
  const base = {
    posting: task.posting.id,
    profile: task.profile.id,
    run: task.run,
    stripped: task.stripped,
  };

  for (let attempt = 0; ; attempt++) {
    const usages: ModelUsage[] = [];
    const startedAt = Date.now();
    try {
      const result = await orchestrateJobAnalysis(request, config.tier, () => {}, (usage) =>
        usages.push(usage)
      );
      return {
        ...base,
        model: result.model,
        arrangement: result.arrangement,
        daysInOffice: result.daysInOffice,
        fit: result.fit,
        usages,
        latencyMs: Date.now() - startedAt,
        costUsd: price
          ? usages.reduce((sum, usage) => sum + costPerAnalysis(usage, price), 0)
          : undefined,
      };
    } catch (err) {
      if (isRateLimited(err) && attempt < MAX_429_RETRIES) {
        await sleep(2_000 * 2 ** attempt + Math.random() * 1_000);
        continue;
      }
      return { ...base, usages, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

async function runPool<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
      done++;
      if (done % 10 === 0 || done === items.length) {
        console.warn(`  ${done}/${items.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

interface ConfigReport {
  config: EvalConfig;
  arrangement: { checked: number; accuracyPct: number; contradictions: number; hybridDays: string };
  fit: {
    pairs: number;
    runs: number;
    falseDealbreakers: number;
    missedDealbreakers: number;
    scoreIndependencePct: number;
    verdictStabilityPct: number;
    detectionMethod: string;
    falseDetails: string[];
    missedDetails: string[];
    unstableDetails: string[];
  };
  tokens: { prompt: number; completion: number; reasoning: number; cached: number; overLongContext: number };
  cost: { medianUsd: number; p95Usd: number; priceSource: string };
  latency: { p50Ms: number; p95Ms: number; truncations: number };
  errors: string[];
  failedTargets: string[];
}

function buildReport(
  config: EvalConfig,
  results: TaskResult[],
  pairs: PairLabel[],
  profiles: Map<string, FixtureProfile>,
  postings: Posting[],
  priceEntry: PriceEntry | undefined
): ConfigReport {
  const ok = results.filter((r) => r.error === undefined);
  const scored = ok.filter((r) => !r.stripped);
  const stripped = ok.filter((r) => r.stripped);

  // Arrangement, over every labelled-posting result (profile runs included).
  const expectedById = new Map(postings.map((p) => [p.id, p.expected]));
  let checked = 0;
  let correct = 0;
  let contradictions = 0;
  let hybridExpected = 0;
  let hybridCorrect = 0;
  for (const r of ok) {
    const expected = expectedById.get(r.posting);
    if (!expected) continue;
    checked++;
    if (r.arrangement === expected.arrangement) correct++;
    else if (expected.stated) contradictions++;
    if (expected.arrangement === "hybrid" && expected.daysInOffice !== null) {
      hybridExpected++;
      if (r.daysInOffice === expected.daysInOffice) hybridCorrect++;
    }
  }

  // Fit.
  const toScored = (r: TaskResult): ScoredResult => ({
    posting: r.posting,
    profile: r.profile,
    dealbreakers: profiles.get(r.profile)?.dealbreakers ?? [],
    fit: r.fit ?? null,
    judgedViolations: r.judgedViolations,
  });
  const scoredResults = scored.map(toScored);
  const falseTally = falseDealbreakers(scoredResults, pairs);
  const missedTally = missedDealbreakers(scoredResults, pairs);

  const bandsByPair: Record<string, Band[]> = {};
  for (const result of scoredResults) {
    if (!result.fit) continue;
    const key = pairKey(result.posting, result.profile);
    (bandsByPair[key] ??= []).push(
      bandFor(result.fit.score, reportedViolations(result).violations)
    );
  }
  const unstableDetails = Object.entries(bandsByPair)
    .filter(([, bands]) => bands.some((band) => band !== bands[0]))
    .map(([key, bands]) => `${key}: ${bands.join(", ")}`);

  const violating = new Set(
    pairs.filter((p) => p.violations.length > 0).map((p) => pairKey(p.posting, p.profile))
  );
  const samples = (rs: TaskResult[]) =>
    rs
      .filter((r) => r.fit && violating.has(pairKey(r.posting, r.profile)))
      .map((r) => ({ pair: pairKey(r.posting, r.profile), score: r.fit!.score }));
  const independence = scoreIndependence(samples(scored), samples(stripped));
  const stability = verdictStability(bandsByPair);

  // Tokens, cost, latency — per analysis (a repair retry belongs to its analysis).
  const usages = ok.flatMap((r) => r.usages);
  const perAnalysis = (pick: (u: ModelUsage) => number) =>
    median(ok.map((r) => r.usages.reduce((sum, u) => sum + pick(u), 0)));
  const costs = ok.map((r) => r.costUsd).filter((c): c is number => c !== undefined);
  const latencies = ok.map((r) => r.latencyMs ?? 0);

  const report: ConfigReport = {
    config,
    arrangement: {
      checked,
      accuracyPct: checked > 0 ? (correct / checked) * 100 : NaN,
      contradictions,
      hybridDays: `${hybridCorrect}/${hybridExpected}`,
    },
    fit: {
      pairs: new Set(scored.map((r) => pairKey(r.posting, r.profile))).size,
      runs: Math.max(0, ...scored.map((r) => r.run + 1)),
      falseDealbreakers: falseTally.count,
      missedDealbreakers: missedTally.count,
      scoreIndependencePct: independence * 100,
      verdictStabilityPct: stability * 100,
      detectionMethod: falseTally.detectionMethod,
      falseDetails: falseTally.details,
      missedDetails: missedTally.details,
      unstableDetails,
    },
    tokens: {
      prompt: perAnalysis((u) => u.promptTokens),
      completion: perAnalysis((u) => u.completionTokens),
      reasoning: perAnalysis((u) => u.reasoningTokens),
      cached: perAnalysis((u) => u.cachedTokens),
      overLongContext: usages.filter((u) => u.promptTokens > LONG_CONTEXT_TOKENS).length,
    },
    cost: {
      medianUsd: median(costs),
      p95Usd: p95(costs),
      priceSource: priceEntry ? `${priceEntry.source}, ${priceEntry.asOf}` : "no price entry",
    },
    latency: { p50Ms: median(latencies), p95Ms: p95(latencies), truncations: truncations(usages) },
    errors: results
      .filter((r) => r.error !== undefined)
      .map((r) => `${pairKey(r.posting, r.profile)}#${r.run}${r.stripped ? " (stripped)" : ""}: ${r.error}`),
    failedTargets: [],
  };

  // Targets (contracts/eval-harness.md). Score independence is gated only once
  // the field exists (PR2+): the PR1 prompt still caps a violating score.
  const targets: [boolean, string][] = [
    [report.errors.length === 0, `errors ${report.errors.length} (target 0)`],
    [report.arrangement.accuracyPct === 100, "arrangement accuracy < 100%"],
    [report.arrangement.contradictions === 0, "stated-arrangement contradictions > 0"],
    [report.fit.falseDealbreakers === 0, `false dealbreakers ${report.fit.falseDealbreakers} (SC-008)`],
    [report.fit.missedDealbreakers === 0, `missed dealbreakers ${report.fit.missedDealbreakers} (SC-002)`],
    [report.fit.verdictStabilityPct >= 90, "verdict stability < 90% (SC-004)"],
    [report.latency.p95Ms <= 30_000, "p95 latency > 30 s (SC-009)"],
  ];
  if (report.fit.detectionMethod === "field") {
    targets.push([report.fit.scoreIndependencePct >= 90, "score independence < 90% (SC-002)"]);
  }
  report.failedTargets = targets.filter(([pass]) => !pass).map(([, message]) => message);
  return report;
}

function pct(value: number): string {
  return Number.isNaN(value) ? "n/a" : `${value.toFixed(1)}%`;
}

function printReport(report: ConfigReport): void {
  const { config, arrangement, fit, tokens, cost, latency } = report;
  const settings = [
    config.temperature !== undefined ? `temperature ${config.temperature}` : undefined,
    config.reasoningEffort !== undefined ? `reasoning_effort ${config.reasoningEffort}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  console.log(`\n=== ${config.label} ${config.gate ? "(gate)" : "(informational)"} ===`);
  console.log(`deployment:   ${config.deployment} (${config.tier}), ${settings || "model defaults"}`);
  console.log(
    `arrangement:  accuracy ${pct(arrangement.accuracyPct)} over ${arrangement.checked}, ` +
      `stated contradictions ${arrangement.contradictions}, hybrid days ${arrangement.hybridDays}`
  );
  console.log(
    `fit:          pairs ${fit.pairs}, runs ${fit.runs}, falseDealbreakers ${fit.falseDealbreakers} (SC-008, target 0), ` +
      `missedDealbreakers ${fit.missedDealbreakers} (SC-002, target 0)`
  );
  console.log(
    `              scoreIndependence ${pct(fit.scoreIndependencePct)} (SC-002, ≥ 90, PR2+), ` +
      `verdictStability ${pct(fit.verdictStabilityPct)} (SC-004, ≥ 90), detectionMethod ${fit.detectionMethod}`
  );
  console.log(
    `tokens:       median prompt ${tokens.prompt} / completion ${tokens.completion} / ` +
      `reasoning ${tokens.reasoning} / cached ${tokens.cached}` +
      (tokens.overLongContext > 0 ? `  ⚠ ${tokens.overLongContext} prompts over 32K` : "")
  );
  console.log(
    `cost:         median $${cost.medianUsd.toFixed(6)}, p95 $${cost.p95Usd.toFixed(6)} per analysis (${cost.priceSource})`
  );
  console.log(
    `latency:      p50 ${(latency.p50Ms / 1000).toFixed(1)}s / p95 ${(latency.p95Ms / 1000).toFixed(1)}s (≤ 30 s), ` +
      `truncations ${latency.truncations}`
  );
  const lists: [string, string[]][] = [
    ["false dealbreakers", fit.falseDetails],
    ["missed dealbreakers", fit.missedDetails],
    ["unstable verdicts", fit.unstableDetails],
    ["errors", report.errors],
  ];
  for (const [title, items] of lists) {
    if (items.length === 0) continue;
    console.log(`  ${title}:`);
    for (const item of items) console.log(`    - ${item}`);
  }
  if (config.gate) {
    console.log(
      report.failedTargets.length === 0
        ? "  GATE: pass"
        : `  GATE: FAIL — ${report.failedTargets.join("; ")}`
    );
  }
}

interface EvalContext {
  postings: Posting[];
  profiles: Map<string, FixtureProfile>;
  pairs: PairLabel[];
  prices: Record<string, PriceEntry>;
}

function loadContext(only: string | undefined): EvalContext {
  const postings = loadPostings(only);
  if (postings.length === 0) throw new Error(`--only=${only} matches no posting`);
  const postingIds = new Set(postings.map((p) => p.id));
  const pairs = readJson<{ pairs: PairLabel[] }>(
    path.join(fixturesDir, "profiles", "pairs.json")
  ).pairs.filter((p) => postingIds.has(p.posting));
  return {
    postings,
    profiles: loadProfiles(),
    pairs,
    prices: readJson<Record<string, PriceEntry>>(path.join(__dirname, "modelPrices.json")),
  };
}

interface SavedRun {
  startedAt: string;
  finishedAt: string;
  args: Record<string, unknown>;
  reports: ConfigReport[];
  results: Record<string, TaskResult[]>;
}

function writeRun(out: string, run: SavedRun): void {
  writeFileSync(path.resolve(out), `${JSON.stringify(run, null, 2)}\n`);
  console.warn(`\nwrote ${out}`);
}

function exitOnGateFailure(reports: ConfigReport[]): void {
  if (reports.some((r) => r.config.gate && r.failedTargets.length > 0)) process.exitCode = 1;
}

async function runConfigEval(argv: string[], configsFile: string): Promise<void> {
  const configs = readJson<EvalConfig[]>(path.resolve(configsFile));
  const runs = positiveInt(argv, "runs", 5);
  const concurrency = positiveInt(argv, "concurrency", 2);
  const only = flag(argv, "only");
  const out = flag(argv, "out");
  const { postings, profiles, pairs, prices } = loadContext(only);
  const postingById = new Map(postings.map((p) => [p.id, p]));

  const tasks: Task[] = [];
  for (let run = 0; run < runs; run++) {
    for (const pair of pairs) {
      const profile = profiles.get(pair.profile);
      if (!profile) throw new Error(`pairs.json names unknown profile "${pair.profile}"`);
      const posting = postingById.get(pair.posting)!;
      tasks.push({ posting, profile, run, stripped: false });
      if (pair.violations.length > 0) tasks.push({ posting, profile, run, stripped: true });
    }
  }

  const startedAt = new Date().toISOString();
  const reports: ConfigReport[] = [];
  const rawResults: Record<string, TaskResult[]> = {};
  for (const config of configs) {
    console.warn(`\n${config.label}: ${tasks.length} analyses (${pairs.length} pairs × ${runs} runs + stripped)`);
    applyConfig(config);
    const price = prices[config.deployment];
    const results = await runPool(tasks, concurrency, (task) => runTask(task, config, price));
    rawResults[config.label] = results;
    const report = buildReport(config, results, pairs, profiles, postings, price);
    reports.push(report);
    printReport(report);
  }

  if (out) {
    writeRun(out, {
      startedAt,
      finishedAt: new Date().toISOString(),
      args: { runs, concurrency, only: only ?? null, configs: configsFile },
      reports,
      results: rawResults,
    });
  }
  exitOnGateFailure(reports);
}

function runSavedReport(argv: string[], file: string): void {
  const saved = readJson<SavedRun>(path.resolve(file));
  const { postings, profiles, pairs, prices } = loadContext(undefined);
  const reports = saved.reports.map(({ config }) => {
    const report = buildReport(
      config,
      saved.results[config.label] ?? [],
      pairs,
      profiles,
      postings,
      prices[config.deployment]
    );
    printReport(report);
    return report;
  });
  const out = flag(argv, "out");
  if (out) writeRun(out, { ...saved, reports });
  exitOnGateFailure(reports);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const configsFile = flag(argv, "configs");
  const reportFile = flag(argv, "report");
  if (reportFile) runSavedReport(argv, reportFile);
  else if (configsFile) await runConfigEval(argv, configsFile);
  else await runArrangementEval(parseTier(argv));
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exitCode = 1;
});
