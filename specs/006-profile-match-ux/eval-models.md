# Eval: scoring-model choice (PR1, FR-M01–M05)

**Status**: live in prod since 2026-10-29 (T026): free on `gpt-6-luna` at `none`, Premium on `gpt-6-luna-premium` at `low`. Raw results:
[`eval-runs/pr1.json`](./eval-runs/pr1.json).

## Summary for sign-off

- **No configuration passes the absolute gates.** Every candidate, the two
  incumbents included, reports false dealbreakers (SC-008) and falls short of
  90% verdict stability (SC-004) under the PR1 prompt. R2's literal rule
  therefore says: merge the plumbing only and escalate. This document is that
  escalation.
- **The cause is the prompt more than the models.** The PR1 prompt tells the
  model to cap a violating fit at 20, so it pushes the model to claim
  violations, including for facts the posting doesn't state. On score alone,
  every model is 86–91% stable. PR2 removes the cap and adds "an unstated fact
  is not a violation" (research R8), and re-measures SC-002/SC-004/SC-008 with
  the `dealbreakersViolated` field.
- **`gpt-6-luna` is the best on every fit metric:**
  - against `gpt-4o-mini` (free today): fewer false dealbreakers (33 at
    `none`, 19 at `low`, vs 49), zero missed (vs 8), and more stable (82–84%
    vs 68%);
  - against `gpt-5.4-mini` (Premium today), which is the worst of all on
    false dealbreakers (53).
- **Recommendation** (the decision is yours):
  - **Free → `gpt-6-luna` at `none`.** It is better than `gpt-4o-mini` on every
    fit metric, cheaper ($0.000241 vs $0.000292 median, so FR-M05 and SC-009
    cost hold), and retires on or after 2028-01-01, which `gpt-4o-mini`, retiring
    2027-04-14, does not.
  - **Premium → `gpt-6-luna` at `low`.** It is better than free on every metric
    (FR-M02) and a third of `gpt-5.4-nano`'s cost. `gpt-5.4-mini` fails its own
    gate and is the worst measured.
- **Blocker before the switch: `gpt-6-luna` capacity.** At 20K TPM, a full
  posting reserves about 13K tokens (prompt plus the 3,000-token completion
  cap), so the deployment serves about two long analyses a minute. Both tiers on
  it would turn traffic spikes into 429s and timeouts. Raise its TPM or add a
  second deployment for Premium first (needs your approval).

## Azure changes so far

| Date | Change | Detail | Rollback |
|---|---|---|---|
| 2026-10-29 | Created deployment `gpt-5.4-mini` (T013, approved) | Model version 2026-03-17, **DataZoneStandard** (processing stays in the US data zone), 50K TPM, in `job-posting-analyzer-openai` / `job-posting-analyzer-rg`. No fixed charge. | Delete the deployment |
| 2026-10-29 | Prod `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM`: `gpt-5.4-nano` → `gpt-5.4-mini` (approved) | After a two-posting probe through the unchanged production code path (research R2) | Set it back to `gpt-5.4-nano` |
| 2026-10-29 | Prod `AZURE_OPENAI_JOB_TEMPERATURE=0` and `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM=0` on `job-posting-analyzer-func` (T021, approved) | Inert on the deployed code; keeps temperature 0 on both tiers once PR1 deploys (research R1, trap 4). Free still resolves its deployment from `AZURE_OPENAI_DEPLOYMENT`. | Delete both settings |
| 2026-10-29 | Raised deployment `gpt-6-luna` 20K → 100K TPM (approved) | GlobalStandard, model version 2026-09-22, for the free tier. Quota is free; only tokens are billed. | Set capacity back to 20 |
| 2026-10-29 | Created deployment `gpt-6-luna-premium` (approved) | Model version 2026-09-22, **DataZoneStandard** (US data zone, as `gpt-5.4-mini` today), 50K TPM, for Premium only so free spikes can't throttle it. Probe with `reasoning_effort: low` returned 200. | Delete the deployment |
| 2026-10-29 | Prod settings switch on `job-posting-analyzer-func` (T026, approved), after PR1 deployed (`ab18a2d`) | Set `AZURE_OPENAI_JOB_DEPLOYMENT=gpt-6-luna`, `AZURE_OPENAI_JOB_REASONING_EFFORT=none`, `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM=gpt-6-luna-premium`, `AZURE_OPENAI_JOB_REASONING_EFFORT_PREMIUM=low`; deleted both temperature settings. `AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini` kept as the free fallback. Verified: Premium analysis at 16:31 UTC logged `model.usage` on `gpt-6-luna-premium`, 6.8 s, `finishReason: stop`. | Set `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM=gpt-5.4-mini`, `AZURE_OPENAI_JOB_TEMPERATURE=0`, `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM=0`; delete `AZURE_OPENAI_JOB_DEPLOYMENT` and both `…_REASONING_EFFORT` settings |

## API version probe (T014, quickstart P1-2)

Run 2026-10-29 through the PR1 orchestrator (`orchestrateJobAnalysis` with an
`env` override per deployment), strict JSON schema, posting
`postings/onsite-explicit.txt`, profile with the dealbreaker "No fully on-site
roles".

**api-version `2024-12-01-preview`** — passes on all four, so it is the default
in `functions/src/services/modelConfig.ts`.

| Deployment | Setting | Result | Arrangement | Fit | Prompt / completion tokens | Latency |
|---|---|---|---|---|---|---|
| `gpt-4o-mini` | temperature 0 | schema-valid | onsite | 20 | 1,230 / 183 | 2.8 s |
| `gpt-5.4-nano` | temperature 0 | schema-valid | onsite | 20 | 1,228 / 412 (1,024 cached) | 4.0 s |
| `gpt-5.4-mini` | temperature 0 | schema-valid | onsite | 0 | 1,228 / 241 | 2.1 s |
| `gpt-6-luna` | reasoning effort `none` | schema-valid | onsite | 10 | 1,228 / 252 | 2.6 s |

No newer version was needed. Prod has run `2024-08-01-preview` until now, which
rejects `reasoning_effort` (research R1).

## Method

- **Corpus**: 6 short postings (`postings/*.txt`) and 5 full-length postings
  exported from the pages corpus (`postings/full/`, Ashby, Greenhouse, Lever,
  Phenom, Workday). Four fixture profiles. 44 labelled pairs, of which 12
  violate a dealbreaker and 10 are unstated-fact traps (`profiles/pairs.json`).
- **Runs**: 5 per pair, plus each violating pair once more per run with the
  dealbreakers stripped (SC-002 score independence). 280 analyses per
  configuration, 1,680 in all, 2026-10-29. The configurations ran as four
  parallel processes, one per deployment. `gpt-4o-mini` and `gpt-5.4-mini` ran
  at concurrency 1 because they serve prod.
- **Dealbreaker detection: LLM judge, not the planned score proxy.** The PR1
  prompt reports a violation only in prose. The planned proxy (score ≤ 20 plus
  a mention in the rationale) can't tell a cap from a low skills match whose
  rationale calls the dealbreaker satisfied, and it fails on paraphrases. Every
  model looked equally broken under it. `scripts/judgeViolations.ts` instead
  asks `gpt-5.4-mini` for a verdict per dealbreaker on each rationale (violated,
  not violated, or not discussed), with a verbatim quote. A "violated" whose
  quote isn't in the rationale is dropped.
  - **Judge check**: 30 random judgments, read by hand, matched the rationale's
    claim 28 times (93%).
  - **The two misses**: one invented a remote-only conflict from a
    relocation sentence. The other read "remote-only … not satisfied because
    the posting does not state a remote arrangement" as not violated. That one
    undercounts an SC-008 trap, so the false-dealbreaker counts are, if
    anything, slightly low.
- **Cost**: tokens × `functions/scripts/modelPrices.json` (Azure Retail Prices
  API, 2026-10-28, every price confirmed). `gpt-6-luna` bills uncached input at
  its $0.125 cache-write rate, an upper bound. The median is over the whole
  corpus, so short postings pull it down.

## Results

| Config | False dealbreakers (trap / stated) — SC-008, target 0 | Missed — SC-002, target 0 | Verdict stability — SC-004, ≥ 90% | Stability on score alone | Score independence (PR2+) | Median $/analysis | $ per 300 analyses |
|---|---|---|---|---|---|---|---|
| `gpt-4o-mini` t0 (free today) | 49 (20 / 29) | 8 | 68.2% | 90.9% | 83.3% | 0.000292 | 0.09 |
| `gpt-5.4-nano` t0 | 34 (16 / 18) | 5 | 75.0% | 88.6% | 91.7% | 0.000702 | 0.21 |
| **`gpt-6-luna` `none`** | 33 (11 / 22) | **0** | 81.8% | 88.6% | 91.7% | **0.000241** | 0.07 |
| **`gpt-6-luna` `low`** | 19 (8 / 11) | **0** | **84.1%** | 88.6% | 91.7% | 0.000317 | 0.10 |
| `gpt-6-luna` `medium` | **13** (3 / 10) | 5 | 77.3% | 79.5% | 83.3% | 0.000520 | 0.16 |
| `gpt-5.4-mini` t0 (Premium today, gate) | 53 (24 / 29) | 2 | 65.9% | 86.4% | 91.7% | 0.002081 | 0.62 |

- **All configurations**: arrangement accuracy 100% over 155 labelled results,
  0 stated contradictions, and no truncations. Hybrid days were 55/55 except
  `gpt-5.4-nano` at 54/55. `luna-medium` had 2 transient connection errors.
- **"Trap"** false dealbreakers are claimed for a fact the posting doesn't
  state. **"Stated"** ones misjudge a fact it does state; the most common is
  London counted as outside "EU timezones only". Counts are over 5 runs.
- **Score independence** is reported for reference only. The PR1 prompt still
  caps violating scores, so it is gated from PR2.

### Latency (SC-009)

The eval's own p95 (13–46 s) is not a model measurement. Calls on the same
deployment queued behind 429s, and the SDK's internal retries count as latency.
Two clean measurements:

| Measurement | `gpt-6-luna` `none` | `gpt-6-luna` `low` |
|---|---|---|
| One run of all 44 pairs, concurrency 1 | p50 4.0 s, p95 31.2 s | p50 6.9 s, p95 32.4 s |
| Longest posting (`phenom-intuit`, 10.7K prompt tokens) after 65 s idle | 5.2 s | 7.1 s |
| `lever-palantir` (5K prompt tokens) after 65 s idle | 3.5 s | 5.8 s |

Without throttling, luna answers in 3.5–7 s, well inside 30 s. Even one call
at a time against 20K TPM is throttled on full postings, which is the capacity
blocker in the summary. `gpt-5.4-mini` (p95 12.7 s) and `gpt-5.4-nano` (15.4 s)
sit on 50K TPM deployments.

## R2 decision rule, step by step

### Free

1. `gpt-6-luna` `none` must pass SC-008, SC-002, SC-004 and SC-009.
   - SC-008: **fails**, with 33 false dealbreakers.
   - SC-002: passes, 0 missed.
   - SC-004: **fails**, 81.8%.
   - SC-009: cost passes ($0.000241 ≤ $0.000292); latency passes unthrottled.
2. `none` fails SC-004 and SC-008, so the next candidate is `low`, which must
   also pass SC-009.
   - `low` **fails** SC-008 (19) and SC-004 (84.1%).
   - Its median cost of $0.000317 is 8.6% above `gpt-4o-mini`'s, so it
     **fails** SC-009's cost check too.
3. `medium` fails SC-002 (5 missed), SC-004 and SC-008.
4. **No `gpt-6-luna` setting passes**, so R2 escalates: PR1 merges the
   plumbing, and you decide the switch from this report.

### Premium

1. `gpt-5.4-mini` must pass SC-002, SC-004 and SC-008, with p95 ≤ 30 s and
   FR-M02. It **fails** SC-008 (53, the most of any configuration), SC-002 (2
   missed) and SC-004 (65.9%).
2. The fallback discards every candidate that fails SC-002, SC-004 or SC-008.
   That is all of them, so the rule picks nothing, and this escalates as well.
3. **If the gates are relaxed to "best measured"** (R2's ranking: false
   dealbreakers, then missed dealbreakers, then stability):
   - `medium` has the fewest false dealbreakers but misses 5 violations.
   - Among configurations that miss none, `low` comes first.
   - `low` is at least as good as free's `none` on every metric (FR-M02), and
     it costs less than today's Premium median, so FR-M05 holds for the
     fallback.

### Chosen settings (signed off 2026-10-29)

| Tier | Settings | Rollback |
|---|---|---|
| Free | `AZURE_OPENAI_JOB_DEPLOYMENT=gpt-6-luna`, `AZURE_OPENAI_JOB_REASONING_EFFORT=none`, delete `AZURE_OPENAI_JOB_TEMPERATURE` | Delete those two, set `AZURE_OPENAI_JOB_TEMPERATURE=0` (free falls back to `AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini`) |
| Premium | `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM=gpt-6-luna-premium` (DataZoneStandard), `AZURE_OPENAI_JOB_REASONING_EFFORT_PREMIUM=low`, delete `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM` | Set the deployment back to `gpt-5.4-mini` (or `gpt-5.4-nano`) and `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM=0`, delete the effort |

- Applied by T026 after PR1 deploys. The deployed code before PR1 sends
  `temperature: 0`, which luna rejects.
- **Capacity first**: raise `gpt-6-luna` above 20K TPM, or create a second
  luna deployment for Premium. Either needs your approval.
- **Premium cost**: $0.000317 median, about $0.10 for a full 300-analysis
  month. That is below both `gpt-5.4-nano` ($0.21) and `gpt-5.4-mini`
  ($0.62), so FR-M05's waiver is no longer needed.
- Moving Premium off `gpt-5.4-mini` also means the 2027-09-21 retirement
  issue (T027) is not needed. Delete the `gpt-5.4-mini` deployment once the
  rollback window has passed.

## Data processing (research R2)

`gpt-6-luna` is a **GlobalStandard** deployment, so prompts, including the
user's résumé text, may be processed in any Azure region. `gpt-5.4-mini` is
DataZoneStandard (US only). Moving Premium to luna gives that up. Before T026,
check that the privacy policy's wording covers cross-region processing.
Alternatively, create the Premium luna deployment as DataZoneStandard:
`6-luna … Std DZ` meters exist at about 10% above global.

**Decision (2026-10-29)**: any-region (GlobalStandard) processing is accepted
for the free tier. Premium stays in the US data zone on `gpt-6-luna-premium`.

Quota in `eastus2` on 2026-10-29 (1 unit = 1K TPM; quota itself is free,
only tokens are billed): GlobalStandard `gpt-6-luna` 20 of 250 used,
DataZoneStandard `gpt-6-luna` 0 of 100 used.

## Known corpus gaps

- 5 full-length postings and 44 pairs, so each count above moves by 5 for a
  single pair that is wrong on every run.
- No iCIMS posting; SmartRecruiters only as the thin stub, excluded from fit.
- No posting states a USD salary below the fixture minimum, so a missed salary
  violation can't be observed.
- Labels are one person's reading (see `_labelling` in `pairs.json`). The
  borderline calls are London and EU timezones, the inferred hybrid in
  `hybrid-2-days-inferred`, and Bay Area residence without a stated
  arrangement.
- Re-run with `npm run eval:postings -- --configs=scripts/evalConfigs.json
  --runs=5 --out=…`, then `npx tsx scripts/judgeViolations.ts <out>` and
  `npm run eval:postings -- --report=<out>`.

## PR2 — rubric and dealbreakers listed without changing the score

Run 2026-10-29, `--runs=5`, 44 pairs, `detectionMethod: "field"`. Attempt 1 raw output:
[`eval-runs/pr2-attempt1.json`](./eval-runs/pr2-attempt1.json). **Gate failed on both configurations.**

| Configuration | False dealbreakers (SC-008, 0) | Missed (SC-002, 0) | Score independence (SC-002, ≥ 90%) | Verdict stability (SC-004, ≥ 90%) | Arrangement accuracy | p50 / p95 latency |
|---|---|---|---|---|---|---|
| free `gpt-6-luna`, `none` | 31 | 5 | 66.7% | 77.3% | 100% | 3.3 s / 7.8 s |
| Premium `gpt-6-luna-premium`, `low` | 9 | 7 | 66.7% | 75.0% | 100% | 4.9 s / 16.8 s |

Attempt 2 (same day) added a required verbatim posting quote per violation, with the
server dropping violations whose quote is not in the posting; the prompt also says silence is
not a violation. Raw output: [`eval-runs/pr2-attempt2.json`](./eval-runs/pr2-attempt2.json); attempt 1 is
[`eval-runs/pr2-attempt1.json`](./eval-runs/pr2-attempt1.json). **Gate still failed.**

| Configuration (attempt 2) | False dealbreakers | Missed | Score independence | Verdict stability | p50 / p95 latency |
|---|---|---|---|---|---|
| free `gpt-6-luna`, `none` | 26 | 18 | 75.0% | 63.6% | 3.4 s / 9.7 s |
| Premium `gpt-6-luna-premium`, `low` | 2 | 16 | 66.7% | 72.7% | 4.9 s / 15.3 s |

The quote requirement cut false positives but made the model skip real violations (missed
5 → 18 free, 7 → 16 Premium). Verdict stability and score independence did not improve.

Attempt 3 (same day) is the R8 fallback: the fit call no longer sees the profile's dealbreakers,
and a separate call (same deployment, run in parallel) judges them and must quote the posting.
Raw output: [`eval-runs/pr2-attempt3.json`](./eval-runs/pr2-attempt3.json). **Gate still failed.**

| Configuration (attempt 3) | False dealbreakers | Missed | Score independence | Verdict stability | p50 / p95 latency |
|---|---|---|---|---|---|
| free `gpt-6-luna`, `none` | 18 | 11 | 83.3% | 79.5% | 3.9 s / 10.4 s |
| Premium `gpt-6-luna-premium`, `low` | 10 | 20 | 75.0% | 63.6% | 5.2 s / 22.0 s |

With dealbreakers out of the fit call, the with/without pair gets identical input, so the
remaining score-independence gap is pure run-to-run score noise near band edges, the same
noise that limits verdict stability. Prompt and call changes did not reduce it.

Premium cost is not computed because `modelPrices.json` has no `gpt-6-luna-premium` entry.
Per research R8, SC-004 and score independence below 90% mean stop and report before merging.

### Final run (attempt 4, metrics changed with sign-off)

Run 2026-10-29, `--runs=5`, 44 pairs, `detectionMethod: "field"`. Raw output:
[`eval-runs/pr2.json`](./eval-runs/pr2.json). Two changes since attempt 3:

- **The judge.** It returns one check per numbered dealbreaker: a verbatim
  quote, then `violated`, `compatible` or `not stated`. It has reading rules
  for arrangement, salary and location dealbreakers, and the server maps each
  check back to the user's line by number (research R8, "Superseded").
- **The metrics** (approved 2026-10-29, spec.md Clarifications):
  - SC-004 counts runs that agree with their pair's most common verdict.
  - SC-002's independence is gated on identical fit input with and without
    dealbreakers.

**Verdict stability and independence pass on both configurations. False and
missed dealbreakers are still nonzero, so the gate fails on SC-008 and on
SC-002's detection half.**

| Configuration (final) | False dealbreakers (SC-008, 0) | Missed (SC-002, 0) | Fit input identical (SC-002, 100%) | Median score within 5 pts (reported) | Verdict stability, runs (SC-004, ≥ 90%) | Pairs with 5 identical verdicts (reported) | Arrangement accuracy | Median $/analysis | p50 / p95 latency |
|---|---|---|---|---|---|---|---|---|---|
| free `gpt-6-luna`, `none` | 4 | 10 | 100% | 83.3% | **95.5%** | 84.1% | 100% | $0.000302 | 4.1 s / 10.9 s |
| Premium `gpt-6-luna-premium`, `low` | 3 | 14 | 100% | 91.7% | **90.9%** | 68.2% | 100% | n/a (no price entry) | 5.4 s / 21.4 s |

Where the remaining errors are (counts over 5 runs):

| Pair | Dealbreaker | Free | Premium | Note |
|---|---|---|---|---|
| ashby-linear × data-ml | EU timezones only | 4 false | 3 false | "Open to candidates based in the US and Europe"; the label says compatible (labelling call 3), but the models read "only" as exclusive. |
| phenom-intuit × mid-frontend | Remote only | 5 missed | 5 missed | The only hybrid text is a sidebar blog teaser. Labelling call 5 was kept by the product owner. |
| phenom-intuit × data-ml | EU timezones only | 1 missed | 2 missed | Location "New York, New York" next to a site-wide city filter. |
| onsite-explicit × data-ml | EU timezones only | 0 | 4 missed | "Columbus plant" names no state or country. |
| lever-palantir × mid-frontend | Remote only | 2 missed | 1 missed | "Many teams do offer hybrid options". |
| workday-nvidia × data-ml | EU timezones only | 2 missed | 0 | US locations. |
| greenhouse-discord × data-ml | EU timezones only | 0 | 2 missed | San Francisco Bay Area residence. |

Against attempt 3 (free 18 / 11, Premium 10 / 20), false dealbreakers fell
by 78% (free) and 70% (Premium). Misses fell by 9% (free) and 30% (Premium).
Five misses per configuration are the kept phenom-intuit label.

- **Cost.** The free median is $0.000302 per analysis. That is 3.3% above
  PR1's `gpt-4o-mini` baseline ($0.000292) and 3.5% above attempt 3. It is
  the feature cost of the separate dealbreaker call, and the product owner
  accepted up to about +11% on 2026-10-29 (FR-M05).
- **Premium cost** is still not computed: `modelPrices.json` has no
  `gpt-6-luna-premium` entry.

## Sign-off

- [X] Product owner: chosen settings approved (2026-10-29): free `gpt-6-luna`
  at `none`, Premium `gpt-6-luna` at `low`; any-region processing for free.
- [X] Product owner: capacity step approved (2026-10-29): `gpt-6-luna` at
  100K TPM for free, `gpt-6-luna-premium` (DataZoneStandard, 50K TPM) for
  Premium. T027 skipped: Premium leaves `gpt-5.4-mini`.
