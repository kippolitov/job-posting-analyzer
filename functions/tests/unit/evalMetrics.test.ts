import { describe, it, expect } from "vitest";
import {
  bandFor,
  costPerAnalysis,
  dealbreakerChecks,
  dealbreakerRecall,
  falseDealbreakers,
  fitInputIndependence,
  identicalVerdictShare,
  median,
  missedDealbreakers,
  p95,
  pairKey,
  reportedViolations,
  scoreIndependence,
  splitFalseDealbreakers,
  truncations,
  quoteStats,
  verbatimRate,
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
  it("is the share of runs that give their pair's most common verdict", () => {
    expect(
      verdictStability({
        a: ["strong", "strong", "strong"],
        b: ["stretch", "stretch", "worth-a-shot"],
        c: ["dealbreaker", "dealbreaker"],
        d: ["long-shot"],
        e: [],
      })
    ).toBe(8 / 9);
  });

  it("counts one tied verdict as the most common", () => {
    expect(verdictStability({ a: ["stretch", "long-shot"] })).toBe(0.5);
  });

  it("is NaN with no runs, so a gate can never pass vacuously", () => {
    expect(verdictStability({})).toBeNaN();
    expect(verdictStability({ a: [] })).toBeNaN();
  });
});

describe("identicalVerdictShare (reported, not gated)", () => {
  it("is the share of pairs whose band is identical across runs", () => {
    expect(
      identicalVerdictShare({
        a: ["strong", "strong", "strong"],
        b: ["stretch", "stretch", "worth-a-shot"],
        c: ["dealbreaker", "dealbreaker"],
        d: ["long-shot"],
      })
    ).toBe(0.75);
  });
});

describe("fitInputIndependence (SC-002)", () => {
  it("is the share of pairs whose fit input is identical with and without dealbreakers", () => {
    expect(
      fitInputIndependence([
        { pair: "a", withDealbreakers: "same", withoutDealbreakers: "same" },
        { pair: "b", withDealbreakers: "x\nDealbreakers:", withoutDealbreakers: "x" },
      ])
    ).toBe(0.5);
  });

  it("is NaN with no pairs", () => {
    expect(fitInputIndependence([])).toBeNaN();
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

    it.each([
      ["No fully on-site roles", "The role is fully on-site five days a week, which violates the candidate's dealbreaker."],
      ["Remote only", "Requires on-site work, violating the candidate's remote-only dealbreaker."],
      ["EU timezones only", "It also violates the candidate's EU-timezones-only dealbreaker."],
    ])(
      "accepts a paraphrased mention of %j when the rationale says dealbreaker and names its content words",
      (line, rationale) => {
        const reported = reportedViolations(
          result("x", "y", { score: 12, rationale }, [line, "Minimum salary 120000 USD per year"])
        );
        expect(reported).toEqual({ violations: [line], method: "score-proxy" });
      }
    );

    it("does not accept content words without the word dealbreaker", () => {
      const reported = reportedViolations(
        result("x", "y", { score: 12, rationale: "A poor match for a remote frontend engineer." }, [
          "Remote only",
        ])
      );
      expect(reported.violations).toEqual([]);
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
          rationale: "Assumed on-site, which violates the dealbreaker: fully on-site roles.",
        }),
      ];
      expect(falseDealbreakers(results, pairs)).toMatchObject({
        count: 1,
        detectionMethod: "score-proxy",
      });
    });
  });

  describe("judged detection (judgedViolations present)", () => {
    it("uses the judged list over both the field and the score proxy", () => {
      const judged = {
        ...result("onsite", "backend", {
          score: 5,
          rationale: `Violates ${ONSITE}.`,
          dealbreakersViolated: [],
        }),
        judgedViolations: [ONSITE],
      };
      expect(reportedViolations(judged)).toEqual({ violations: [ONSITE], method: "judge" });
    });

    it("counts a judged-empty list on a capped score as no violation", () => {
      const results = [
        {
          ...result("silent", "backend", {
            score: 8,
            rationale: "Fully remote, which satisfies the candidate's dealbreaker. Weak skills match.",
          }),
          judgedViolations: [],
        },
      ];
      expect(falseDealbreakers(results, pairs)).toMatchObject({ count: 0, detectionMethod: "judge" });
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

describe("dealbreaker targets (approved 2026-10-29)", () => {
  const REMOTE = "Remote only";
  const SALARY = "Minimum salary 120000 USD per year";
  const facts = { [ONSITE]: "arrangement", [REMOTE]: "arrangement", [SALARY]: "salary" };
  const labels: PairLabel[] = [
    { posting: "onsite", profile: "backend", violations: [ONSITE], unstatedFacts: [] },
    // States an arrangement (hybrid) but no salary.
    { posting: "hybrid", profile: "frontend", violations: [REMOTE], unstatedFacts: ["salary"] },
  ];
  const fit = (dealbreakersViolated: string[]) => ({ score: 50, rationale: "x", dealbreakersViolated });

  describe("splitFalseDealbreakers", () => {
    it("calls a false report a trap when its fact is one the posting does not state (SC-008)", () => {
      const results = [result("hybrid", "frontend", fit([REMOTE, SALARY]), [REMOTE, SALARY])];
      const { trap, stated } = splitFalseDealbreakers(results, labels, facts);
      expect(trap.count).toBe(1);
      expect(trap.details[0]).toContain(SALARY);
      expect(stated.count).toBe(0);
    });

    it("calls a false report on a stated fact a misreading", () => {
      const results = [result("onsite", "backend", fit([ONSITE, REMOTE]), [ONSITE, REMOTE])];
      const { trap, stated } = splitFalseDealbreakers(results, labels, facts);
      expect(trap.count).toBe(0);
      expect(stated.count).toBe(1);
    });

    it("counts a line with no known fact as a trap, the stricter reading", () => {
      const results = [result("hybrid", "frontend", fit(["No startups"]), ["No startups"])];
      expect(splitFalseDealbreakers(results, labels, facts).trap.count).toBe(1);
    });
  });

  describe("dealbreakerChecks", () => {
    it("counts every dealbreaker line sent with a scored, labelled result", () => {
      const results = [
        result("onsite", "backend", fit([]), [ONSITE]),
        result("hybrid", "frontend", fit([]), [REMOTE, SALARY]),
        result("hybrid", "frontend", null, [REMOTE, SALARY]),
        result("unlabelled", "backend", fit([]), [ONSITE]),
      ];
      expect(dealbreakerChecks(results, labels)).toBe(3);
    });
  });

  describe("dealbreakerRecall (SC-002)", () => {
    it("is the share of labelled violations reported, over every run", () => {
      const results = [
        result("onsite", "backend", fit([ONSITE])),
        result("onsite", "backend", fit([])),
        result("hybrid", "frontend", fit([REMOTE]), [REMOTE, SALARY]),
        result("hybrid", "frontend", null, [REMOTE, SALARY]),
      ];
      expect(dealbreakerRecall(results, labels)).toBe(0.5);
    });

    it("is NaN with no labelled violations", () => {
      expect(dealbreakerRecall([result("silent", "backend", fit([]))], pairs)).toBeNaN();
    });
  });
});

describe("scoreIndependence (SC-002)", () => {
  const key = pairKey("onsite", "backend");
  const other = pairKey("onsite", "frontend");

  it("is the share of violating pairs whose median scores are within 5 points with and without dealbreakers", () => {
    // 62/67 cross a band edge but are 5 apart; 15/25 share a band but are 10 apart.
    const withDealbreakers = [
      { pair: key, score: 62 },
      { pair: other, score: 15 },
    ];
    const withoutDealbreakers = [
      { pair: key, score: 67 },
      { pair: other, score: 25 },
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

describe("evidence quote metrics (SC-003)", () => {
  const fit = (evidence: unknown) => ({ score: 70, rationale: "r", evidence }) as never;

  it("counts the quotes that survived validation", () => {
    const stats = quoteStats(
      fit({
        matching: [
          { label: "a", postingQuote: "p", profileQuote: "q" },
          { label: "b", postingQuote: null, profileQuote: "q" },
        ],
        missing: [{ label: "c", postingQuote: "p", profileQuote: null }],
        desired: [],
      }),
      1
    );
    expect(stats).toEqual({ kept: 4, dropped: 1 });
  });

  it("counts nothing for a fit without evidence", () => {
    expect(quoteStats(null, 0)).toEqual({ kept: 0, dropped: 0 });
    expect(quoteStats({ score: 70, rationale: "r" }, 0)).toEqual({ kept: 0, dropped: 0 });
  });

  it("is kept over kept plus dropped, and NaN when nothing was quoted", () => {
    expect(verbatimRate([{ kept: 19, dropped: 1 }, { kept: 20, dropped: 0 }])).toBeCloseTo(97.5);
    expect(verbatimRate([{ kept: 0, dropped: 0 }])).toBeNaN();
    expect(verbatimRate([])).toBeNaN();
  });
});
