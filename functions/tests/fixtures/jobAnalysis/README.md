# Recorded model-output fixtures — /api/analyze-job

Each JSON file is a structured-output payload in the exact shape the Azure OpenAI
`json_schema` (strict) response returns for the job-analysis schema, used by
`tests/unit/jobExtractionOrchestrator.test.ts` per the constitution's
"no hollow mocks" rule.

To re-record from the live deployment: run `npm run eval:postings` with
`EVAL_RECORD=1` and copy the desired raw responses here, or capture a response
body from a local `func start` session. Keep payloads realistic and complete —
every schema field present, enums valid.

## What each fixture proves

| Fixture | Proves |
|---|---|
| `explicit-hybrid.json` | Hybrid extraction with verbatim evidence and day counts |
| `onsite-with-days.json` | Day counts are nulled when the arrangement is not hybrid |
| `hallucinated-evidence.json` | Evidence that is not in the input downgrades to `unspecified` |
| `non-job.json` | `isJobPosting: false` with no downgrade side effects |
| `with-fit.json` | A full fit breakdown survives when a profile is sent |
| `dealbreaker-onsite.json` | 006 R8: a violated dealbreaker copied verbatim keeps the user's wording, and the score (72) is never lowered for it (FR-005) |
| `dealbreaker-paraphrased.json` | 006 R8: a paraphrase ("no on-site") maps to the profile line by containment; an unmatched entry ("Must sponsor visas") is kept with one warning |

From 006 PR2 the schema requires `fit.dealbreakersViolated`, so every fixture
with a non-null `fit` carries it (an empty array when nothing is violated).
