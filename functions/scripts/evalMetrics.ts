/**
 * Pure metric helpers for the fit eval (specs/006-profile-match-ux research R3,
 * contracts/eval-harness.md). No I/O, so tests/unit/evalMetrics.test.ts can pin
 * every definition the model decision depends on.
 */

/** The five FR-009 bands. "Unrated" has no place here: every eval fit is scored. */
export type Band = "strong" | "worth-a-shot" | "stretch" | "long-shot" | "dealbreaker";

export type DetectionMethod = "field" | "score-proxy";

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
}

export interface ScoredResult {
  posting: string;
  profile: string;
  /** The dealbreaker lines sent with this request (for the PR1 score proxy). */
  dealbreakers: string[];
  fit: EvalFit | null;
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

/** Share of pairs whose band is identical across every run (SC-004). NaN when empty. */
export function verdictStability(runsByPair: Record<string, Band[]>): number {
  const pairs = Object.values(runsByPair).filter((bands) => bands.length > 0);
  if (pairs.length === 0) return NaN;
  const stable = pairs.filter((bands) => bands.every((band) => band === bands[0])).length;
  return stable / pairs.length;
}

/**
 * The violations a result reports. The field wins when present; otherwise the
 * PR1 proxy counts a dealbreaker when the score is capped and the rationale
 * names it (see `mentions`). The proxy is only valid while the prompt still asks for the cap.
 */
export function reportedViolations(result: ScoredResult): {
  violations: string[];
  method: DetectionMethod;
} {
  const { fit } = result;
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
  pick: (reported: string[], labelled: string[]) => string[]
): DealbreakerTally {
  const labels = new Map(pairs.map((p) => [pairKey(p.posting, p.profile), p]));
  const methods = new Set<DetectionMethod>();
  const details: string[] = [];
  for (const result of results) {
    const label = labels.get(pairKey(result.posting, result.profile));
    if (!label) continue;
    const { violations, method } = reportedViolations(result);
    methods.add(method);
    for (const line of pick(violations, label.violations)) {
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

/** Labelled violations not reported (SC-002, target 0). */
export function missedDealbreakers(results: ScoredResult[], pairs: PairLabel[]): DealbreakerTally {
  return tally(results, pairs, (reported, labelled) => missingFrom(labelled, reported));
}

function medianScoreByPair(samples: ScoreSample[]): Map<string, number> {
  const byPair = new Map<string, number[]>();
  for (const { pair, score } of samples) byPair.set(pair, [...(byPair.get(pair) ?? []), score]);
  return new Map([...byPair].map(([pair, scores]) => [pair, median(scores)]));
}

/**
 * SC-002: share of violating pairs whose band, computed from the score alone,
 * is the same with and without the profile's dealbreakers. Runs are reduced to
 * the median score per pair. NaN when no pair is in both runs.
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
    ([pair, score]) => bandFor(score, []) === bandFor(withoutScores.get(pair)!, [])
  ).length;
  return same / compared.length;
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
