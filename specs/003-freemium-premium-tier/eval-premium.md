# SC-008 Eval: Premium vs. Free Deployment

**Status: BLOCKED on Azure provisioning — see "What's missing" below.** This
records what was run, what passed, and exactly what remains before PR 4 can
claim SC-008 sign-off (plan.md Rollout).

## What was run

`functions/scripts/evalPostings.ts` was extended with a `--tier=free|premium`
flag and a p95 latency measurement (target ≤ 30 s, Constitution IV/QG-4 — the
same ceiling applies to both deployments). Verified live against the real
Azure OpenAI resource (`job-posting-analyzer-openai`):

```
$ npm run eval:postings -- --tier=free
=== Job analyzer eval (SC-001 / SC-002 / SC-008) — tier: free ===
Deployment:                    gpt-4o-mini
Postings evaluated:            6
Arrangement accuracy:          100.0% (target ≥ 90%)
Stated-arrangement conflicts:  0 (target 0)
Hybrid day counts:             2/2 extracted correctly
Latency p95:                   2.9s (target ≤ 30s, Constitution IV/QG-4)
```

```
$ npm run eval:postings -- --tier=premium   (AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM unset)
=== Job analyzer eval (SC-001 / SC-002 / SC-008) — tier: premium ===
Deployment:                    gpt-4o-mini   ← correctly fell back to the free deployment
Postings evaluated:            6
Arrangement accuracy:          100.0%
Latency p95:                   2.6s
```

This confirms two things end-to-end against the live API: the free-tier
baseline holds (existing 002/008 behavior unregressed by the freemium
changes), and the tier→deployment fallback (data-model.md, research.md R6)
degrades safely when the premium deployment doesn't exist yet — which is the
current state of the Azure resource (verified via a direct API probe:
`gpt-4.1-mini` returns `DeploymentNotFound`, HTTP 404).

One real bug was caught and fixed by this run: the orchestrator's premium
fallback used `??`, which does not treat an empty string as "unset" —
`local.settings.json` ships `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM: ""` as a
placeholder until the deployment is provisioned, so `??` was passing that
empty string to the OpenAI client and producing a 404. Fixed to an explicit
truthiness check; regression test added
(`tests/unit/jobExtractionOrchestrator.test.ts` — "falls back … when the
premium deployment is an empty-string placeholder").

## What's missing

**The actual free-vs-premium comparison never ran, because the premium
deployment does not exist in Azure yet.** Provisioning it — creating a
`gpt-4.1-mini` deployment on the `job-posting-analyzer-openai` resource,
sizing its TPM (~30K total per plan.md, dynamic quota off), and setting
`AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` in the Function App configuration — is
an infrastructure change with real cost and is explicitly out of scope for an
agent to perform unilaterally (plan.md T043 / quickstart.md "Release gates").

**Also outstanding**: the fixture set has 6 postings, not the 50 SC-001
requires; and there is no fit-scoring ground-truth set to substantiate "the
premium deployment produces noticeably better fit scoring" — that dimension
of SC-008 has no automated harness at all today (`evalPostings.ts` only
scores arrangement/day-count extraction). Building one (labeled
profile+posting pairs with expected fit characteristics) is a separate,
non-trivial effort not covered by this feature's task list.

## Before this gate can pass

1. Provision the `gpt-4.1-mini` deployment in Azure OpenAI (plan.md T043).
2. Set `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` in `functions/local.settings.json`
   (dev) and the Function App config (prod).
3. Re-run both commands above; premium's p95 must stay ≤ 30 s and its
   accuracy must not regress vs. free's baseline captured here.
4. Either accept "extraction parity, no regression" as sufficient for SC-008,
   or build a fit-scoring eval set to substantiate the "noticeably better"
   claim — a product decision, not an engineering one.
5. Record the premium run's numbers in this file, replacing this "blocked"
   status.
