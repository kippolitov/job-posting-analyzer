# SC-008 Eval: Premium vs. Free Deployment

**Status: extraction parity confirmed (2026-07-15) — no regression, premium model
substituted (see "Model substitution" below). Fit-scoring "noticeably better" claim
still unsubstantiated (no automated harness) — see "Still outstanding".**

## Model substitution: gpt-4.1-mini → gpt-5.4-nano

Plan.md's original premium pick, `gpt-4.1-mini`, could not be deployed when T043
provisioned the premium deployment: Azure now rejects **all** new deployments of the
gpt-4.1/gpt-4o/o4-mini generation with `ServiceModelDeprecating` (that whole family's
inference cutoff is ~Oct 2026, `gpt-4o-mini` — the free deployment — included). The
premium deployment was created as **`gpt-5.4-nano`** instead (GA, deprecation runway
to 2027-03-18): $0.20/$1.25 per 1M in/out tokens, worst-case 300 analyses/mo ≈ $1.28,
margin ≈ $2.97/mo after Paddle's cut — healthier than the original gpt-4.1-mini plan
(~$2/mo). See quickstart.md Release gates for the full TPM-sizing writeup.

This forced a real code fix, not just config: gpt-5.4-nano (and every other
currently-deployable model — the entire gpt-5.x generation) rejects the legacy
`max_tokens` chat-completions parameter with `400 Unsupported parameter`; it requires
`max_completion_tokens`. Confirmed via direct API probes that `max_completion_tokens`
works identically on the existing `gpt-4o-mini` free deployment, so
`jobExtractionOrchestrator.ts` now sends `max_completion_tokens` unconditionally
(no per-model branch needed) — see the diff to `src/services/jobExtractionOrchestrator.ts`.
Full unit (185) + integration (75) suites pass after the change.

## What was run

`functions/scripts/evalPostings.ts` (`--tier=free|premium`), against the live Azure
OpenAI resource (`job-posting-analyzer-openai`, eastus2):

```
$ npm run eval:postings -- --tier=free
=== Job analyzer eval (SC-001 / SC-002 / SC-008) — tier: free ===
Deployment:                    gpt-4o-mini
Postings evaluated:            6
Arrangement accuracy:          100.0% (target ≥ 90%)
Stated-arrangement conflicts:  0 (target 0)
Hybrid day counts:             2/2 extracted correctly
Latency p95:                   1.8s (target ≤ 30s, Constitution IV/QG-4)
```

```
$ npm run eval:postings -- --tier=premium
=== Job analyzer eval (SC-001 / SC-002 / SC-008) — tier: premium ===
Deployment:                    gpt-5.4-nano
Postings evaluated:            6
Arrangement accuracy:          100.0% (target ≥ 90%)
Stated-arrangement conflicts:  0 (target 0)
Hybrid day counts:             2/2 extracted correctly
Latency p95:                   2.4s (target ≤ 30s, Constitution IV/QG-4)
```

Both tiers: 100% arrangement accuracy, zero conflicts, correct hybrid-day extraction,
p95 latency far under the 30 s ceiling. **No extraction regression** on this fixture
set — SC-008's parity requirement holds.

(Earlier run, before the premium deployment existed, additionally confirmed the
tier→deployment fallback degrades safely when `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM`
is unset/empty — a real bug in that fallback's `??` vs empty-string handling was
caught and fixed then; regression test in `tests/unit/jobExtractionOrchestrator.test.ts`.)

## Still outstanding

- **Fixture set has 6 postings, not the 50 SC-001 requires** — before release
  sign-off, grow the validation set.
- **No fit-scoring ground-truth set** to substantiate "the premium deployment
  produces noticeably better fit scoring" — `evalPostings.ts` only scores
  arrangement/day-count extraction, not fit quality. Building one (labeled
  profile+posting pairs with expected fit characteristics) is a separate,
  non-trivial effort not covered by this feature's task list. Accepting
  "extraction parity, no regression" as sufficient for SC-008 (vs. requiring a
  fit-scoring harness) is a product decision, not an engineering one.
- **gpt-4o-mini (free) deprecates for inference 2026-10-01** — regardless of the
  premium substitution above, the free deployment needs its own model migration
  before then. Track as follow-up work, not blocking this feature's release.
