# Contract: Evaluation harness (PR1, extended in PR2 and PR3)

**Requirements**: FR-M03, SC-002, SC-003, SC-004, SC-008, SC-009 | **Research**: R2, R3

The harness is run on demand and never in CI. It makes live model calls.

## CLI

```bash
cd functions
npm run eval:postings -- [--tier=free|premium] [--configs=scripts/evalConfigs.json]
                         [--runs=5] [--concurrency=2] [--only=<postingId>]
                         [--out=../specs/006-profile-match-ux/eval-runs/<label>.json]
```

- With no `--configs`, it behaves like today: one tier, arrangement metrics only,
  over `postings/*.txt`. This keeps backwards compatibility with 003's
  `eval-premium.md` procedure.
- `--configs` lists `{ label, tier, deployment, temperature?, reasoningEffort? }`.
  The harness overrides `process.env` per configuration before calling
  `orchestrateJobAnalysis`. No HTTP or metering is involved.
- Fit metrics run only over `profiles/pairs.json`. Arrangement metrics run over
  every posting.

## Corpus preparation

```bash
cd extension
npx tsx scripts/exportCorpusExtracts.ts   # writes functions/tests/fixtures/postings/full/<slug>.json
```

This runs the shipping `extractPage` in real Chromium over each `settled.html`,
through `runExtractor` and `serveFixtures`. It is re-run only when the pages
corpus or the extractor changes, and its output is committed.

## Report (stdout and `--out` JSON)

For each configuration:

```text
config, deployment, settings
arrangement: accuracy %, stated contradictions, hybrid days n/m          (existing)
fit: pairs, runs, falseDealbreakers (SC-008, target 0),
     missedDealbreakers (SC-002, target 0), scoreIndependence % (SC-002, ≥ 90, PR2+),
     verdictStability % (SC-004, ≥ 90),
     evidenceVerbatim % (SC-003, ≥ 95, PR3+), detectionMethod: "field" | "score-proxy"
tokens: median prompt / completion / reasoning / cached
cost: median and p95 $ per analysis (modelPrices.json; price source and date printed)
latency: p50 / p95 (≤ 30 s), truncations (finish_reason=length)
```

**Exit code**: non-zero when any configuration with `"gate": true` fails a
target. The configurations being decided between in PR1 are informational.

## Outputs committed by PR1

- `functions/scripts/evalConfigs.json`: the candidate configurations from
  research R2.
- `functions/scripts/modelPrices.json`.
- `specs/006-profile-match-ux/eval-models.md`: the comparison table, the chosen
  free and Premium settings, and the known corpus gaps (iCIMS, SmartRecruiters
  stub, sample size). You sign it off before any prod settings change.
