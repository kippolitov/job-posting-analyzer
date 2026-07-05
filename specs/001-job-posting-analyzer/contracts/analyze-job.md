# Contract: POST /api/analyze-job

**Feature**: `001-job-posting-analyzer` | **Date**: 2026-07-04

New Azure Functions HTTP endpoint. Auth, hosting, and CORS behavior are identical to the existing `POST /api/analyze` (function-key auth). Non-streaming: one request, one JSON response.

## Request

`POST /api/analyze-job`
`Content-Type: application/json`

```json
{
  "extract": {
    "url": "https://www.linkedin.com/jobs/view/3941...?refId=abc",
    "canonicalUrl": "https://www.linkedin.com/jobs/view/3941",
    "title": "Senior Backend Engineer - Acme | LinkedIn",
    "jsonLd": [ { "@type": "JobPosting", "title": "Senior Backend Engineer", "...": "..." } ],
    "mainText": "About the role ... hybrid, 3 days per week in our Austin office ...",
    "extractedAt": "2026-07-04T12:00:00Z"
  },
  "profile": "Principal-level .NET engineer; dealbreakers: no fully on-site roles",
  "assumeJobPosting": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `extract` | `PageExtract` | yes | See [data-model.md](../data-model.md); `mainText` ≤ 40,000 chars (server rejects larger with 413) |
| `profile` | `string` | no | Candidate profile text; when absent, response `fit` is `null` |
| `assumeJobPosting` | `boolean` | no (default `false`) | `true` = user forced "Analyze anyway" on a page previously labeled non-job |

## Response — 200

Body is a `JobAnalysis` (fields per [data-model.md](../data-model.md)), e.g.:

```json
{
  "isJobPosting": true,
  "title": "Senior Backend Engineer",
  "company": "Acme",
  "location": "Austin, TX",
  "arrangement": "hybrid",
  "arrangementConfidence": "explicit",
  "arrangementEvidence": "hybrid, 3 days per week in our Austin office",
  "daysInOffice": 3,
  "daysRemote": 2,
  "remoteRestrictions": null,
  "salary": { "min": 180000, "max": 220000, "currency": "USD", "period": "year" },
  "seniority": "senior",
  "techStack": ["C#", ".NET 8", "Azure", "Kubernetes"],
  "fit": { "score": 84, "rationale": "Strong match on .NET and Azure at senior level; hybrid arrangement satisfies your no-fully-onsite dealbreaker." },
  "model": "gpt-4o-mini",
  "analyzedAt": "2026-07-04T12:00:04Z"
}
```

### Model output schema (authoritative)

Enforced via Azure OpenAI `response_format: json_schema` with `strict: true`. The server appends `model` and `analyzedAt` after validation; they are not model-generated.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["isJobPosting", "title", "company", "location", "arrangement",
               "arrangementConfidence", "arrangementEvidence", "daysInOffice",
               "daysRemote", "remoteRestrictions", "salary", "seniority",
               "techStack", "fit"],
  "properties": {
    "isJobPosting": { "type": "boolean" },
    "title":    { "type": ["string", "null"] },
    "company":  { "type": ["string", "null"] },
    "location": { "type": ["string", "null"] },
    "arrangement": { "enum": ["remote", "hybrid", "onsite", "unspecified"] },
    "arrangementConfidence": { "enum": ["explicit", "inferred", "none"] },
    "arrangementEvidence": { "type": ["string", "null"],
      "description": "Verbatim quote from the posting; required when arrangement != unspecified" },
    "daysInOffice": { "type": ["integer", "null"], "minimum": 0, "maximum": 7 },
    "daysRemote":   { "type": ["integer", "null"], "minimum": 0, "maximum": 7 },
    "remoteRestrictions": { "type": ["string", "null"] },
    "salary": { "type": ["object", "null"], "additionalProperties": false,
      "required": ["min", "max", "currency", "period"],
      "properties": {
        "min": { "type": ["number", "null"] }, "max": { "type": ["number", "null"] },
        "currency": { "type": ["string", "null"] },
        "period": { "enum": ["year", "month", "day", "hour", null] } } },
    "seniority": { "enum": ["junior", "mid", "senior", "staff", "principal",
                             "manager", "director", "executive", "unspecified"] },
    "techStack": { "type": "array", "items": { "type": "string" }, "maxItems": 25 },
    "fit": { "type": ["object", "null"], "additionalProperties": false,
      "required": ["score", "rationale"],
      "properties": {
        "score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "rationale": { "type": "string", "maxLength": 400 } } }
  }
}
```

### Server-side post-validation (before responding)

1. **Evidence backstop**: if `arrangement != "unspecified"` and `arrangementEvidence` (whitespace-normalized) is not a substring of the model input, rewrite `arrangement: "unspecified"`, `arrangementConfidence: "none"`, `arrangementEvidence: null`, `daysInOffice: null`, `daysRemote: null`, and log the downgrade.
2. **Hybrid-days consistency**: `daysInOffice`/`daysRemote` non-null only when `arrangement == "hybrid"` (else nulled).
3. **Fit gating**: `fit` forced to `null` when the request carried no `profile`.

## Response — errors

Typed error body in all non-200 cases:

```json
{ "error": { "code": "SCHEMA_PARSE_FAILED", "message": "Human-readable explanation" } }
```

| Status | Code | When | Client behavior |
|--------|------|------|-----------------|
| 400 | `INVALID_REQUEST` | Missing/malformed `extract` | Bug; surfaced as generic error + Retry |
| 401 | — | Bad/missing function key | Config error banner |
| 413 | `EXTRACT_TOO_LARGE` | `mainText` > 40,000 chars | Should not occur (extractor caps at 40,000 — defense-in-depth only); surfaced as generic error + Retry |
| 502 | `SCHEMA_PARSE_FAILED` | Model output failed schema after one repair retry | Error banner + Retry; client still renders JSON-LD-derived fields |
| 504 | `UPSTREAM_TIMEOUT` | Model call exceeded 30 s | Error banner + Retry; JSON-LD-derived fields rendered |

Client timeout: 30 s (matches existing `analysisClient` convention).

## Compatibility notes

- Existing endpoints (`/api/analyze`, `/api/chat`) are untouched; this contract is additive.
- `extension/types/job.ts` and this schema must stay in lockstep; contract tests (msw) pin the response shape, and the eval harness exercises the live schema.
