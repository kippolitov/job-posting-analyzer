# Contract: POST /api/analyze-document

The single new backend endpoint. Extracts text from an uploaded document server-side, validates it **before** consuming allowance, then reuses the existing metering service and analyze orchestrator to return the same analysis shape as `POST /api/analyze-job`.

## Request

- **Method / route**: `POST /api/analyze-document`
- **Auth**: `Authorization: Bearer <Google ID token>` — same `withAuth` boundary as every endpoint (aud now accepts the web client ID too; see [web-auth.md](./web-auth.md)).
- **Content-Type**: `multipart/form-data`
- **Fields**:
  | Field | Type | Required | Notes |
  |-------|------|----------|-------|
  | `file` | file part | yes | `.docx` or `.pdf`, ≤ 10 MB. |
  | `profile` | text | no | Candidate profile text (client-supplied, as in `analyze-job`). Omit → `fit: null`. |
  | `assumeJobPosting` | text `"true"`/`"false"` | no | Same semantics as `analyze-job`. |

- **Preflight**: `OPTIONS /api/analyze-document` → `204` with CORS headers (anonymous), mirroring `analyze-job-preflight`.

## Processing order (normative — reject-before-increment, research R7)

1. **Boundary size check** — reject if `Content-Length` (and, defensively, actual byte length) > 10 MB → `413 FILE_TOO_LARGE`. *No allowance touched.*
2. **Magic-byte sniff** — read leading bytes; accept only PDF (`25 50 44 46` = `%PDF`) or ZIP/OOXML (`50 4B 03 04` = `PK␃␄`, then confirmed as `.docx` by successful mammoth parse). MIME/extension are **never** trusted. Mismatch → `415 UNSUPPORTED_FILE_TYPE`. *No allowance touched.*
3. **Text extraction** — `.docx` via `mammoth`, `.pdf` via `unpdf`:
   - password-protected (pdf.js `PasswordException` / mammoth throw) → `422 FILE_PASSWORD_PROTECTED`. *No allowance touched.*
   - corrupt / unreadable (parse throws, wrong internal structure) → `422 FILE_UNREADABLE`. *No allowance touched.*
   - image-only / empty (extracted text is empty or whitespace-only after trim) → `422 FILE_NO_TEXT`. *No allowance touched.*
4. **Meter** — only now call `checkAndIncrement(sub, tier)` (atomic ETag, `meteringService` unchanged):
   - `allowed === false` → `429 USAGE_LIMIT_REACHED` with the **exact** message shape from `analyze-job` (`You've used all <limit> <tier> analyses this month. Your allowance resets on <date>.`) and a `usage` echo.
   - metering outage → `503 SERVICE_ERROR`.
5. **Analyze** — cap extracted text at `MAIN_TEXT_CAP` (40,000), build the synthetic `AnalyzeJobRequest` (research R8), call `orchestrateJobAnalysis(req, tier, warn)`.
   - schema failure after repair retry → `502 SCHEMA_PARSE_FAILED`, **and** `refundOnSystemFailure(sub, tier)` (best-effort).
   - other ≥ 500 → `500 SERVICE_ERROR` + `refundOnSystemFailure`.
6. **Respond** `200` with the analysis, source metadata, and `usage` echo. Uploaded bytes are discarded (never persisted).

## Success response — 200

```jsonc
{
  "analysis": {
    "isJobPosting": true,
    "title": "Senior Backend Engineer",
    "company": "...",
    "location": "...",
    "arrangement": "hybrid",
    "arrangementConfidence": "explicit",
    "arrangementEvidence": "...",
    "daysInOffice": 2,
    "daysRemote": 3,
    "remoteRestrictions": null,
    "salary": { "min": 120000, "max": 160000, "currency": "USD", "period": "year" },
    "seniority": "senior",
    "techStack": ["Go", "Postgres"],
    "fit": { "score": 78, "rationale": "...", "matching": [], "missing": [], "desired": [], "strengths": [], "weaknesses": [] },
    "model": "gpt-4o-mini",
    "analyzedAt": "2026-07-21T12:00:00.000Z"
  },
  "source": "document",
  "filename": "job-description.pdf",
  "saveKey": "<sha256 of ('doc:' + sha256(extractedText))>",
  "usage": { "count": 12, "limit": 50, "resetsAt": "2026-08-01T00:00:00.000Z", "tier": "free" }
}
```

`analysis` is byte-for-byte the same shape as `analyze-job`'s body (identical `JobAnalysisResponse`). The **only** additions are `source`, `filename`, `saveKey`, and the shared `usage` echo.

## Error responses

| Status | code | When | Allowance consumed? |
|--------|------|------|---------------------|
| 400 | `INVALID_REQUEST` | Missing `file` part / malformed multipart. | No |
| 413 | `FILE_TOO_LARGE` | > 10 MB. | No |
| 415 | `UNSUPPORTED_FILE_TYPE` | Not a real `.docx`/`.pdf` by magic bytes. | No |
| 422 | `FILE_PASSWORD_PROTECTED` | Encrypted document. | No |
| 422 | `FILE_UNREADABLE` | Corrupt / mislabeled / parse failure. | No |
| 422 | `FILE_NO_TEXT` | Image-only / no extractable text. | No |
| 429 | `USAGE_LIMIT_REACHED` | Monthly cap reached (post-validation). | No (blocked) |
| 502 | `SCHEMA_PARSE_FAILED` | Model output unusable after repair. | Refunded (best-effort) |
| 503 | `SERVICE_ERROR` | Metering unavailable. | No |
| 500 | `SERVICE_ERROR` | Orchestrator/system failure. | Refunded (best-effort) |

All error bodies use `{ "error": { "code", "message" }, "usage"? }` — plain-language `message` with the accepted formats/size named on validation errors (constitution III, FR-020). Every rejection in steps 1–3 returns **before** step 4, guaranteeing zero allowance consumption for bad files (SC-005).

## Concurrency guarantee

The cap is enforced by `checkAndIncrement`'s atomic ETag primitive alone; N parallel `analyze-document` requests at a 1-remaining allowance yield exactly 1 success (SC-006), identical to `analyze-job`. Validation ordering does not weaken this because the increment is still the single atomic gate.
