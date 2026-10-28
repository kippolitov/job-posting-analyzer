# Contract: Analyze endpoints — deltas for 006

**Endpoints**: `POST /api/analyze-job` (extension; function key plus Google ID
token) and `POST /api/analyze-document` (web; Google ID token).
**Requirements**: FR-001, FR-002, FR-004, FR-004a, FR-005, FR-011, FR-012,
FR-016, FR-017 | **Research**: R4–R9, R11

Every change is additive. A request without any new field behaves exactly as it
does today, except for the PR2 side fix in §4.

## 1. Request additions (PR2)

### analyze-job (JSON)

```jsonc
{
  "extract": { /* unchanged PageExtractPayload */ },
  "profile": "…serialized text…",          // existing; new clients keep sending it
  "profileData": {                          // NEW, optional
    "text": "…", "dealbreakers": ["…"],
    "preferences": { /* PR4, optional */ },
    "confirmedSkills": ["…"]                // PR5, optional
  },
  "assumeJobPosting": false,                // existing
  "rescore": { "priorFingerprint": "ab12…" | null }   // NEW, optional: rescore intent
}
```

### analyze-document (multipart)

New optional parts: `profileData` (a JSON string), `rescore` (`"true"`) and
`priorFingerprint` (a 64-hex string, or absent).

### Validation

- `profileData` must have `text: string` and `dealbreakers: string[]`. If it
  fails, the request gets `400 INVALID_REQUEST`. A malformed optional field
  never falls back silently.
- `rescore.priorFingerprint` must be `null` or 64 lowercase hex characters.
- Validation happens **before** metering (§4).

## 2. Server processing order

```text
parse → validate (400/413, no charge)
      → resolve profile: profileData ? profileToPromptText(profileData) : profile
      → fingerprint = sha256(normalizeWhitespace(serialized))
      → [document only] extractDocument (422/413/415, no charge)
      → eligibility (research R6) → charge rescoresUsed or count (429 when exhausted)
      → model call (R1 config)
      → validateQuotes (R9, PR3) → enforceConsistency → resolveDealbreakers / applyPreferences (R8/R11)
      → stamp fit.profileFingerprint
      → if rescore intent ∧ ¬assumeJobPosting ∧ ¬isJobPosting ∧ unavailableRefunds < 10 → refund, postingUnavailable
      → 200
any 5xx after the charge → refund the counter that was charged
```

## 3. Response additions

```jsonc
{
  /* JobAnalysisResponse — fit gains dealbreakersViolated, profileFingerprint (PR2), evidence (PR3) */
  "postingUnavailable": true,      // NEW, only on a rescore that found no posting
  "usage": {
    "count": 12, "limit": 50, "resetsAt": "…", "tier": "free",   // existing
    "charged": "rescore" | "analysis" | "none",                   // NEW
    "rescoresUsed": 3, "rescoresLimit": 10                        // NEW
  }
}
```

`charged: "none"` appears only together with `postingUnavailable: true` when the
refund was granted.

**429 `USAGE_LIMIT_REACHED`**: returned only when the request is charged as an
ordinary analysis and `count ≥ limit`. An eligible rescore with free rescores
left succeeds even when the analysis allowance is used up (spec edge case
"Usage allowance exhausted"). The 429 body's `usage` also gains `rescoresUsed`
and `rescoresLimit`.

## 4. Side fix — charge after validation (PR2)

Today `withUsageMetering` charges `analyze-job` before the body is parsed, so a
400 or 413 costs an analysis and is never refunded. In PR2, `analyze-job` adopts
`analyze-document`'s order: validate, then charge, then call the model. The
charge still happens **before** the model call, so the exactly-one-winner
guarantee at the cap holds. **Regression tests**: a 400 and a 413 leave `count`
unchanged, and N parallel requests at the cap produce exactly one 200.

## 5. Compatibility matrix

| Caller | Backend before 006 | Backend with 006 |
|---|---|---|
| Old extension (no new fields) | today | Gets an additive response. It ignores the new fit fields and `usage` fields. Its fit gets a fingerprint for the string it sent. It is metered as today. |
| New extension or web | Not reachable in production: the backend deploys first, and the extension waits for Chrome Web Store review | Full behaviour |
| New web during the CD window (web live, functions still deploying) | Unknown fields ignored. Charged normally, so the "free" cost line could be wrong for about a minute. | n/a |

## 6. Contract tests (test-first)

- **FR-001 / SC-006**: every client flow sends `profileData`, built from the
  same stored profile, plus `profile === profileToPromptText(profileData)`. The
  flows are the extension's page, paste and region analysis, and the web's
  document analysis.
- The server serializes `profileData` identically to a client's
  `profileToPromptText`. The fingerprints from `profileData` and from the
  equivalent string are equal.
- An old-style body with no `profileData` and no `rescore` is a 200 with an
  unchanged field set plus additive fields.
- Eligibility table tests, for each row of research R6, against Azurite.
- A `postingUnavailable` refund is capped at 10 per month.
