import { describe, it, expect } from "vitest";
import {
  bandFor,
  costPerAnalysis,
  falseDealbreakers,
  median,
  missedDealbreakers,
  p95,
  pairKey,
  scoreIndependence,
  truncations,
  verdictStability,
  type PairLabel,
  type ScoredResult,
} from "../../scripts/evalMetrics";

// specs/006-profile-match-ux/contracts/eval-harness.md, research R3

const ONSITE = "No fully on-site roles";

function result(
  posting: string,
  profile: string,
  fit: ScoredResult["fit"],
  dealbreakers: string[] = [ONSITE]
): ScoredResult {
  return { posting, profile, dealbreakers, fit };
}

const pairs: PairLabel[] = [
  { posting: "onsite", profile: "backend", violations: [ONSITE], unstatedFacts: [] },
  { posting: "silent", profile: "backend", violations: [], unstatedFacts: ["arrangement"] },
];

describe("bandFor (FR-009 bands)", () => {
  it.each([
    [100, "strong"],
    [85, "strong"],
    [84, "worth-a-shot"],
    [65, "worth-a-shot"],
    [64, "stretch"],
    [40, "stretch"],
    [39, "long-shot"],
    [0, "long-shot"],
  ] as const)("score %i → %s", (score, band) => {
    expect(bandFor(score, [])).toBe(band);
  });

  it("any violation → dealbreaker, whatever the score", () => {
    expect(bandFor(95, [ONSITE])).toBe("dealbreaker");
  });
});

describe("verdictStability (SC-004)", () => {
  it("is the share of pairs whose band is identical across runs", () => {
    expect(
      verdictStability({
        a: ["strong", "strong", "strong"],
        b: ["stretch", "stretch", "worth-a-shot"],
        c: ["dealbreaker", "dealbreaker"],
        d: ["long-shot"],
      })
    ).toBe(0.75);
  });

  it("is NaN with no pairs, so a gate can never pass vacuously", () => {
    expect(verdictStability({})).toBeNaN();
  });
});

describe("falseDealbreakers / missedDealbreakers", () => {
  describe("field detection (fit.dealbreakersViolated present)", () => {
    it("counts a reported violation the pair is not labelled with as false", () => {
      const results = [
        result("silent", "backend", {
          score: 70,
          rationale: "Good match.",
          dealbreakersViolated: [ONSITE],
        }),
      ];
      const tally = falseDealbreakers(results, pairs);
      expect(tally.count).toBe(1);
      expect(tally.detectionMethod).toBe("field");
      expect(tally.details[0]).toContain("silent");
    });

    it("matches labelled violations case- and whitespace-insensitively", () => {
      const results = [
        result("onsite", "backend", {
          score: 72,
          rationale: "Strong skills match.",
          dealbreakersViolated: ["  no fully   ON-SITE roles "],
        }),
      ];
      expect(falseDealbreakers(results, pairs).count).toBe(0);
      expect(missedDealbreakers(results, pairs).count).toBe(0);
    });

    it("counts a labelled violation that is not reported as missed", () => {
      const results = [
        result("onsite", "backend", {
          score: 72,
          rationale: "Strong skills match.",
          dealbreakersViolated: [],
        }),
      ];
      const tally = missedDealbreakers(results, pairs);
      expect(tally.count).toBe(1);
      expect(tally.detectionMethod).toBe("field");
    });
  });

  describe("PR1 score proxy (no field)", () => {
    it("reports a violation when score ≤ 20 and the rationale mentions the dealbreaker", () => {
      const results = [
        result("onsite", "backend", {
          score: 15,
          rationale: "The role violates your dealbreaker: no fully on-site roles.",
        }),
      ];
      expect(missedDealbreakers(results, pairs)).toMatchObject({
        count: 0,
        detectionMethod: "score-proxy",
      });
    });

    it("does not report a violation above 20, even when the rationale mentions it", () => {
      const results = [
        result("onsite", "backend", {
          score: 21,
          rationale: "Mentions No fully on-site roles but scores well.",
        }),
      ];
      expect(missedDealbreakers(results, pairs).count).toBe(1);
    });

    it("does not report a violation at ≤ 20 without a rationale mention", () => {
      const results = [
        result("onsite", "backend", { score: 10, rationale: "Weak skills match." }),
      ];
      expect(missedDealbreakers(results, pairs).count).toBe(1);
    });

    it("flags a capped score on a silent posting as a false dealbreaker (SC-008 trap)", () => {
      const results = [
        result("silent", "backend", {
          score: 20,
          rationale: "Assumed on-site, which conflicts with No fully on-site roles.",
        }),
      ];
      expect(falseDealbreakers(results, pairs)).toMatchObject({
        count: 1,
        detectionMethod: "score-proxy",
      });
    });
  });

  it("treats a null fit as reporting nothing", () => {
    const results = [result("onsite", "backend", null)];
    expect(missedDealbreakers(results, pairs).count).toBe(1);
    expect(falseDealbreakers(results, pairs).count).toBe(0);
  });

  it("reports mixed detection when some results carry the field and some don't", () => {
    const results = [
      result("onsite", "backend", { score: 10, rationale: `Violates ${ONSITE}.` }),
      result("silent", "backend", { score: 70, rationale: "Fine.", dealbreakersViolated: [] }),
    ];
    expect(falseDealbreakers(results, pairs).detectionMethod).toBe("mixed");
  });

  it("ignores results with no labelled pair", () => {
    const results = [
      result("unlabelled", "backend", { score: 5, rationale: ONSITE, dealbreakersViolated: [ONSITE] }),
    ];
    expect(falseDealbreakers(results, pairs).count).toBe(0);
    expect(missedDealbreakers(results, pairs).count).toBe(0);
  });

  it("counts every run separately", () => {
    const fit = { score: 70, rationale: "x", dealbreakersViolated: [ONSITE] };
    const results = [result("silent", "backend", fit), result("silent", "backend", fit)];
    expect(falseDealbreakers(results, pairs).count).toBe(2);
  });
});

describe("scoreIndependence (SC-002)", () => {
  const key = pairKey("onsite", "backend");
  const other = pairKey("onsite", "frontend");

  it("is the share of violating pairs whose score-only band matches with and without dealbreakers", () => {
    const withDealbreakers = [
      { pair: key, score: 72 },
      { pair: other, score: 15 },
    ];
    const withoutDealbreakers = [
      { pair: key, score: 70 },
      { pair: other, score: 68 },
    ];
    expect(scoreIndependence(withDealbreakers, withoutDealbreakers)).toBe(0.5);
  });

  it("compares the median score per pair across runs", () => {
    const withDealbreakers = [72, 74, 10].map((score) => ({ pair: key, score }));
    const withoutDealbreakers = [70, 71, 73].map((score) => ({ pair: key, score }));
    expect(scoreIndependence(withDealbreakers, withoutDealbreakers)).toBe(1);
  });

  it("skips pairs missing from the stripped run, and is NaN with none to compare", () => {
    expect(scoreIndependence([{ pair: key, score: 70 }], [])).toBeNaN();
  });
});

describe("costPerAnalysis", () => {
  const usage = { promptTokens: 2_000_000, completionTokens: 1_000_000, cachedTokens: 1_000_000 };

  it("bills uncached input, cached input and output at their own rates", () => {
    const cost = costPerAnalysis(usage, {
      inputPer1M: 0.15,
      cachedInputPer1M: 0.075,
      outputPer1M: 0.6,
    });
    expect(cost).toBeCloseTo(0.15 + 0.075 + 0.6, 10);
  });

  it("bills uncached input at the cache-write rate when that is higher, as an upper bound", () => {
    const cost = costPerAnalysis(usage, {
      inputPer1M: 0.1,
      cachedInputPer1M: 0.01,
      cacheWritePer1M: 0.125,
      outputPer1M: 0.5,
    });
    expect(cost).toBeCloseTo(0.125 + 0.01 + 0.5, 10);
  });

  it("never treats a cache hit as cheaper when the cached rate is not lower", () => {
    const noCache = costPerAnalysis(
      { ...usage, cachedTokens: 0 },
      { inputPer1M: 0.2, cachedInputPer1M: 0.2, outputPer1M: 1.25 }
    );
    const allCached = costPerAnalysis(
      { ...usage, cachedTokens: usage.promptTokens },
      { inputPer1M: 0.2, cachedInputPer1M: 0.2, outputPer1M: 1.25 }
    );
    expect(allCached).toBeCloseTo(noCache, 10);
  });

  it("is 0 for zero tokens", () => {
    expect(
      costPerAnalysis(
        { promptTokens: 0, completionTokens: 0, cachedTokens: 0 },
        { inputPer1M: 1, cachedInputPer1M: 1, outputPer1M: 1 }
      )
    ).toBe(0);
  });
});

describe("p95 and median", () => {
  it("p95 uses the nearest-rank definition on unsorted input", () => {
    const samples = Array.from({ length: 20 }, (_, i) => 20 - i); // 20..1
    expect(p95(samples)).toBe(19);
    expect(p95([5])).toBe(5);
    expect(p95([])).toBe(0);
  });

  it("median handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("truncations", () => {
  it('counts finishReason === "length"', () => {
    expect(
      truncations([
        { finishReason: "stop" },
        { finishReason: "length" },
        { finishReason: null },
        { finishReason: "length" },
      ])
    ).toBe(2);
  });
});
