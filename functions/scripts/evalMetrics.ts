/**
 * Pure metric helpers for the fit eval (specs/006-profile-match-ux research R3,
 * contracts/eval-harness.md). No I/O, so tests/unit/evalMetrics.test.ts can pin
 * every definition the model decision depends on.
 */

/** The five FR-009 bands. "Unrated" has no place here: every eval fit is scored. */
export type Band = "strong" | "worth-a-shot" | "stretch" | "long-shot" | "dealbreaker";

export type DetectionMethod = "judge" | "field" | "score-proxy";

export interface PairLabel {
  posting: string;
  profile: string;
  /** Profile dealbreaker lines the posting truly violates, given what it states. */
  violations: string[];
  /** Facts the posting is silent on (SC-008 traps). */
  unstatedFacts: string[];
  verdictRange?: [string, string];
}

/** The fit fields the metrics read; `dealbreakersViolated` arrives in PR2. */
export interface EvalFit {
  score: number;
  rationale: string;
  dealbreakersViolated?: string[];
  /** PR3: quotes behind the matching, missing and desired labels. */
  evidence?: Partial<Record<"matching" | "missing" | "desired", { postingQuote: string | null; profileQuote: string | null }[]>>;
}

export interface ScoredResult {
  posting: string;
  profile: string;
  /** The dealbreaker lines sent with this request (for the PR1 score proxy). */
  dealbreakers: string[];
  fit: EvalFit | null;
  /** Violations an LLM judge read from the rationale (scripts/judgeViolations.ts). */
  judgedViolations?: string[];
}

export interface DealbreakerTally {
  count: number;
  detectionMethod: DetectionMethod | "mixed";
  details: string[];
}

export interface ScoreSample {
  pair: string;
  score: number;
}

export interface Price {
  inputPer1M: number;
  cachedInputPer1M: number;
  cacheWritePer1M?: number;
  outputPer1M: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

/** The PR1 prompt still asks the model to cap a violating fit at 20 (research R2). */
const PROXY_SCORE_CAP = 20;

export function pairKey(posting: string, profile: string): string {
  return `${posting}×${profile}`;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Words a dealbreaker line can drop when the model paraphrases it. */
const FILLER_WORDS = new Set(["no", "not", "only", "role", "roles", "per", "a", "an", "the", "of", "in"]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * The model names a violated dealbreaker in its own words ("the candidate's
 * remote-only dealbreaker"), so an exact mention is not required: saying
 * "dealbreaker" and naming every content word of the line counts too.
 */
function mentions(rationale: string, line: string): boolean {
  if (normalize(rationale).includes(normalize(line))) return true;
  const rationaleWords = new Set(words(rationale));
  if (![...rationaleWords].some((word) => word.startsWith("dealbreaker"))) return false;
  const content = words(line).filter((word) => !FILLER_WORDS.has(word));
  return content.length > 0 && content.every((word) => rationaleWords.has(word));
}

export function bandFor(score: number, violations: readonly string[]): Band {
  if (violations.length > 0) return "dealbreaker";
  if (score >= 85) return "strong";
  if (score >= 65) return "worth-a-shot";
  if (score >= 40) return "stretch";
  return "long-shot";
}

/**
 * SC-004: share of all runs that give their pair's most common verdict.
 * Measured per run, not per pair, so one borderline score in five runs costs
 * one run rather than the whole pair (approved 2026-10-29). NaN when empty.
 */
export function verdictStability(runsByPair: Record<string, Band[]>): number {
  let runs = 0;
  let agreeing = 0;
  for (const bands of Object.values(runsByPair)) {
    const counts = new Map<Band, number>();
    for (const band of bands) counts.set(band, (counts.get(band) ?? 0) + 1);
    runs += bands.length;
    agreeing += Math.max(0, ...counts.values());
  }
  return runs === 0 ? NaN : agreeing / runs;
}

/** Share of pairs whose band is identical across every run (the pre-2026-10-29 SC-004, reported only). */
export function identicalVerdictShare(runsByPair: Record<string, Band[]>): number {
  const pairs = Object.values(runsByPair).filter((bands) => bands.length > 0);
  if (pairs.length === 0) return NaN;
  const stable = pairs.filter((bands) => bands.every((band) => band === bands[0])).length;
  return stable / pairs.length;
}

/**
 * The violations a result reports. A judge's reading wins, then the field;
 * otherwise the PR1 proxy counts a dealbreaker when the score is capped and
 * the rationale names it (see `mentions`). The proxy is only valid while the
 * prompt still asks for the cap, and it cannot tell a cap from a low skills
 * match, which is why PR1 is graded by the judge.
 */
export function reportedViolations(result: ScoredResult): {
  violations: string[];
  method: DetectionMethod;
} {
  const { fit } = result;
  if (result.judgedViolations) return { violations: result.judgedViolations, method: "judge" };
  if (fit && Array.isArray(fit.dealbreakersViolated)) {
    return { violations: fit.dealbreakersViolated, method: "field" };
  }
  if (!fit || fit.score > PROXY_SCORE_CAP) return { violations: [], method: "score-proxy" };
  return {
    violations: result.dealbreakers.filter((line) => mentions(fit.rationale, line)),
    method: "score-proxy",
  };
}

function tally(
  results: ScoredResult[],
  pairs: PairLabel[],
  pick: (reported: string[], labelled: string[], label: PairLabel) => string[]
): DealbreakerTally {
  const labels = new Map(pairs.map((p) => [pairKey(p.posting, p.profile), p]));
  const methods = new Set<DetectionMethod>();
  const details: string[] = [];
  for (const result of results) {
    const label = labels.get(pairKey(result.posting, result.profile));
    if (!label) continue;
    const { violations, method } = reportedViolations(result);
    methods.add(method);
    for (const line of pick(violations, label.violations, label)) {
      details.push(`${pairKey(result.posting, result.profile)}: ${line}`);
    }
  }
  const detectionMethod = methods.size > 1 ? "mixed" : [...methods][0] ?? "field";
  return { count: details.length, detectionMethod, details };
}

function missingFrom(lines: string[], from: string[]): string[] {
  const present = new Set(from.map(normalize));
  return lines.filter((line) => !present.has(normalize(line)));
}

/** Reported violations the pair is not labelled with (SC-008, target 0). */
export function falseDealbreakers(results: ScoredResult[], pairs: PairLabel[]): DealbreakerTally {
  return tally(results, pairs, (reported, labelled) => missingFrom(reported, labelled));
}

/** Labelled violations not reported (SC-002 reports them; `dealbreakerRecall` gates). */
export function missedDealbreakers(results: ScoredResult[], pairs: PairLabel[]): DealbreakerTally {
  return tally(results, pairs, (reported, labelled) => missingFrom(labelled, reported));
}

/**
 * Splits false dealbreakers (approved 2026-10-29). A **trap** is claimed for a
 * fact the posting does not state: the line's fact (`facts`, from pairs.json
 * `dealbreakerFacts`) is in the pair's `unstatedFacts`. SC-008 allows none. A
 * line with no known fact counts as a trap, the stricter reading. The rest
 * misread a fact the posting does state.
 */
export function splitFalseDealbreakers(
  results: ScoredResult[],
  pairs: PairLabel[],
  facts: Record<string, string>
): { trap: DealbreakerTally; stated: DealbreakerTally } {
  const factOf = new Map(Object.entries(facts).map(([line, fact]) => [normalize(line), fact]));
  const isTrap = (line: string, label: PairLabel) => {
    const fact = factOf.get(normalize(line));
    return fact === undefined || label.unstatedFacts.includes(fact);
  };
  return {
    trap: tally(results, pairs, (reported, labelled, label) =>
      missingFrom(reported, labelled).filter((line) => isTrap(line, label))
    ),
    stated: tally(results, pairs, (reported, labelled, label) =>
      missingFrom(reported, labelled).filter((line) => !isTrap(line, label))
    ),
  };
}

/** Dealbreaker lines judged: one per line, per scored result with a labelled pair. */
export function dealbreakerChecks(results: ScoredResult[], pairs: PairLabel[]): number {
  const labelled = new Set(pairs.map((p) => pairKey(p.posting, p.profile)));
  return results
    .filter((r) => r.fit && labelled.has(pairKey(r.posting, r.profile)))
    .reduce((sum, r) => sum + r.dealbreakers.length, 0);
}

/** SC-002 (≥ 75%, approved 2026-10-29): share of labelled violations reported, over every run. NaN when none. */
export function dealbreakerRecall(results: ScoredResult[], pairs: PairLabel[]): number {
  const labels = new Map(pairs.map((p) => [pairKey(p.posting, p.profile), p]));
  const expected = results.reduce(
    (sum, r) => sum + (labels.get(pairKey(r.posting, r.profile))?.violations.length ?? 0),
    0
  );
  if (expected === 0) return NaN;
  return (expected - missedDealbreakers(results, pairs).count) / expected;
}

function medianScoreByPair(samples: ScoreSample[]): Map<string, number> {
  const byPair = new Map<string, number[]>();
  for (const { pair, score } of samples) byPair.set(pair, [...(byPair.get(pair) ?? []), score]);
  return new Map([...byPair].map(([pair, scores]) => [pair, median(scores)]));
}

/** Points two median scores may differ by and still count as the same score. */
const SCORE_TOLERANCE = 5;

/**
 * SC-002, reported only: share of violating pairs whose median score is within
 * SCORE_TOLERANCE points with and without the profile's dealbreakers. With
 * identical fit input (`fitInputIndependence`) the difference is run-to-run
 * noise. NaN when no pair is in both runs.
 */
export function scoreIndependence(
  withDealbreakers: ScoreSample[],
  withoutDealbreakers: ScoreSample[]
): number {
  const withScores = medianScoreByPair(withDealbreakers);
  const withoutScores = medianScoreByPair(withoutDealbreakers);
  const compared = [...withScores].filter(([pair]) => withoutScores.has(pair));
  if (compared.length === 0) return NaN;
  const same = compared.filter(
    ([pair, score]) => Math.abs(score - withoutScores.get(pair)!) <= SCORE_TOLERANCE
  ).length;
  return same / compared.length;
}

export interface FitInputPair {
  pair: string;
  /** The serialized fit-call input for the full profile and for the stripped one. */
  withDealbreakers: string;
  withoutDealbreakers: string;
}

/**
 * SC-002 gate (approved 2026-10-29): share of violating pairs whose fit call
 * receives identical input with and without dealbreakers, so the score cannot
 * depend on them. NaN when empty.
 */
export function fitInputIndependence(pairs: FitInputPair[]): number {
  if (pairs.length === 0) return NaN;
  return pairs.filter((p) => p.withDealbreakers === p.withoutDealbreakers).length / pairs.length;
}

/**
 * Dollars for one completion. Cached tokens bill at the cached rate. The usage
 * report does not say which uncached tokens were written to the cache, so when
 * a cache write costs more than plain input (gpt-6-luna) every uncached token
 * is billed at the write rate: an upper bound, never an assumed saving.
 */
export function costPerAnalysis(usage: TokenUsage, price: Price): number {
  const uncached = Math.max(0, usage.promptTokens - usage.cachedTokens);
  const uncachedRate = Math.max(price.inputPer1M, price.cacheWritePer1M ?? 0);
  return (
    (uncached * uncachedRate +
      usage.cachedTokens * price.cachedInputPer1M +
      usage.completionTokens * price.outputPer1M) /
    1_000_000
  );
}

/** Nearest-rank p95, as the arrangement eval has always reported it. */
export function p95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function median(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function truncations(usages: { finishReason: string | null }[]): number {
  return usages.filter((u) => u.finishReason === "length").length;
}

export interface QuoteStats {
  kept: number;
  dropped: number;
}

/**
 * One analysis's evidence quotes (research R9): `kept` survived validation,
 * `dropped` is the orchestrator's count of fabricated ones it nulled.
 */
export function quoteStats(fit: EvalFit | null | undefined, dropped: number): QuoteStats {
  let kept = 0;
  for (const items of Object.values(fit?.evidence ?? {})) {
    for (const item of items ?? []) {
      if (item.postingQuote) kept++;
      if (item.profileQuote) kept++;
    }
  }
  return { kept, dropped };
}

/** SC-003: the share of returned quotes that were verbatim, in percent; NaN when none were returned. */
export function verbatimRate(stats: QuoteStats[]): number {
  const kept = stats.reduce((sum, s) => sum + s.kept, 0);
  const dropped = stats.reduce((sum, s) => sum + s.dropped, 0);
  return kept + dropped === 0 ? NaN : (kept / (kept + dropped)) * 100;
}
