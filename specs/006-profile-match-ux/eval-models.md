# Eval: scoring-model choice (PR1, FR-M01–M05)

**Status**: in progress. The comparison and the decision are filled in by T024
from `eval-runs/pr1.json`.

## Azure changes so far

| Date | Change | Detail | Rollback |
|---|---|---|---|
| 2026-10-29 | Created deployment `gpt-5.4-mini` (T013, approved) | Model version 2026-03-17, **DataZoneStandard** (processing stays in the US data zone), 50K TPM, in `job-posting-analyzer-openai` / `job-posting-analyzer-rg`. No fixed charge. | Delete the deployment |
| 2026-10-29 | Prod `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM`: `gpt-5.4-nano` → `gpt-5.4-mini` (approved) | After a two-posting probe through the unchanged production code path (research R2) | Set it back to `gpt-5.4-nano` |

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
