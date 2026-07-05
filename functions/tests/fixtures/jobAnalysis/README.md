# Recorded model-output fixtures — /api/analyze-job

Each JSON file is a structured-output payload in the exact shape the Azure OpenAI
`json_schema` (strict) response returns for the job-analysis schema, used by
`tests/unit/jobExtractionOrchestrator.test.ts` per the constitution's
"no hollow mocks" rule.

To re-record from the live deployment: run `npm run eval:postings` with
`EVAL_RECORD=1` and copy the desired raw responses here, or capture a response
body from a local `func start` session. Keep payloads realistic and complete —
every schema field present, enums valid.
