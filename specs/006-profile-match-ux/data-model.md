# Data Model: Trustworthy, Actionable Profile Match

**Feature**: `006-profile-match-ux` | **Date**: 2026-10-28 | **Research**: [research.md](./research.md)

Every change is **additive**. No table is created, no row is rewritten, and every
new field is optional on read. The tag on each item names the PR that introduces
it. "Old client" means an extension build published before that PR, which may
still be in use during Chrome Web Store review.

---

## 1. Fit (extended) — `shared/types/job.ts`

Stored inside `SavedJobs.analysisJson`, in the extension session cache
(`jobcache:*`), and returned on every analyze response.

| Field | Type | PR | Notes |
|---|---|---|---|
| `score` | `integer 0–100` | existing | Measures skills, experience and seniority match only. **Never changed by dealbreakers** (FR-005): from PR2 the prompt tells the model not to lower it, and the server never adjusts it. |
| `rationale` | `string` | existing | |
| `matching` / `missing` / `desired` | `string[]` | existing | **Remain label arrays forever** (R4). Old clients render these. |
| `strengths` / `weaknesses` | `string[]` | existing | From PR4, `weaknesses` may start with server-written `"Unverified: …"` notes (R11) |
| `dealbreakersViolated` | `string[]` | PR2 | The user's own wording. The server maps model output to profile lines (R8). Absent means a pre-feature fit. |
| `profileFingerprint` | `string` (64 hex) | PR2 | Fingerprint of the profile actually scored (R5). Absent means version-unknown and therefore no verdict. |
| `evidence` | `FitEvidence` | PR3 | Optional. See below. |

```text
FitEvidence  = { matching?: EvidenceItem[], missing?: EvidenceItem[], desired?: EvidenceItem[] }
EvidenceItem = { label: string, postingQuote: string | null, profileQuote: string | null }
```

**Validation rules**:
- `postingQuote` must be a whitespace-normalized substring of the posting
  haystack. `profileQuote` must be one of the profile haystack. Otherwise the
  quote is set to `null` and a warning is logged (FR-012).
- `profileQuote` is always `null` for `missing` and `desired`.
- A quote is at most 200 characters, truncated on the server after validation.
- `label` equals an entry of the matching label array. Evidence whose label is
  not in the list is dropped.

**Legacy readers**: `isJobAnalysisPayload` and the extension's `isJobAnalysis`
are unchanged and do not inspect any new field.

## 2. NormalizedFit and derived values — `shared/fitView.ts` (PR2)

These are derived and never stored (spec: "Verdict: derived, never stored").

```text
Verdict   = "strong" | "worth-a-shot" | "stretch" | "long-shot" | "dealbreaker" | "unrated"
Freshness = "current" | "out-of-date" | "version-unknown" | "profile-deleted" | "unknown"
```

**Verdict mapping** (FR-009):

| Condition | Verdict | Label |
|---|---|---|
| `profileFingerprint` absent | `unrated` | "Unrated — rescore for a verdict" |
| `dealbreakersViolated.length > 0` | `dealbreaker` | "Dealbreaker" |
| 85–100 | `strong` | "Strong match" |
| 65–84 | `worth-a-shot` | "Worth a shot" |
| 40–64 | `stretch` | "Stretch" |
| 0–39 | `long-shot` | "Long shot" |

**Freshness mapping**, from `fit` and the current fingerprint:

| `fit.profileFingerprint` | Current fingerprint | Freshness |
|---|---|---|
| any | not yet known (fetch failed, nothing cached) | `unknown`, no marker |
| absent | any known value | `version-unknown`, "may be out of date" |
| X | `null`, no profile | `profile-deleted` |
| X | X | `current` |
| X | Y ≠ X | `out-of-date` |

A null fit has no freshness. The existing "Configure profile" or "Score against
your profile" call to action applies instead.

## 3. Candidate Profile (extended)

### Storage — `Profiles` row (PK `sub`, RK `"profile"`)

| Column | Type | PR | Notes |
|---|---|---|---|
| `text` | string ≤ 20,000 | existing | |
| `dealbreakers` | JSON `string[]` | existing | |
| `preferences` | JSON `Preferences` | PR4 | Optional. Absent means none. |
| `confirmedSkills` | JSON `string[]` | PR5 | Optional. Deduplicated case-insensitively on write, in first-seen order. |
| `fingerprintHistory` | JSON `string[]` | PR2 | The last 20 *previous* fingerprints, newest first. Used only by the rescore eligibility check (R6). |
| `updatedAt` | ISO string | existing | Not a fingerprint input |
| `schemaVersion` | number | existing | 1 → 2 in PR4. A version-1 row reads as no preferences and no confirmed skills. |

```text
Preferences = {
  arrangements?: ("remote" | "hybrid" | "onsite")[]                  // non-empty when present
  minSalary?:   { amount: number > 0, currency: ISO-4217 string, period: "year"|"month"|"day"|"hour" }
  seniority?:   { min?: Seniority, max?: Seniority }                  // enum order; min ≤ max
  locations?:   string[]                                              // free text; model-judged only
}
```

**Character cap**: `PROFILE_TEXT_MAX = 20,000` applies to the **serialized**
length of `text` plus the Confirmed skills section. The cap is checked on PUT and
reported with the existing over-limit message. Adding a skill past the cap is
refused (spec edge case).

### Wire — `GET` / `PUT /api/profile` (contract: [profile-api.md](./contracts/profile-api.md))

The response adds `fingerprint: string`, computed on every read and never stored
(PR2), plus `preferences` (PR4) and `confirmedSkills` (PR5). Old clients ignore
these fields.

**Hazard**: an old client's `PUT` sends only `{text, dealbreakers}`. The current
repository uses an upsert with `"Replace"`, so an old client's save would erase
`preferences` and `confirmedSkills`. **Decision**: the profile PUT merges. Fields
the body omits keep their stored values, and only fields the body includes are
replaced. Clearing a field requires sending it as an empty value. This is a
behaviour change to PUT, recorded in the contract and pinned by a test.

### Serialization — `shared/types/profile.ts`

`profileToPromptText(profile)` appends sections only when they are non-empty:

```text
<text>

Dealbreakers:
- <line>

Preferences:            ← PR4
- Work arrangement: remote or hybrid
- Minimum salary: 120000 USD per year
- Seniority: senior to staff
- Locations or timezones: EU timezones only

Confirmed skills:       ← PR5
- Terraform
```

`dealbreakerLinesFromPrompt(text)` is the inverse for the Dealbreakers section
only (PR2). The server uses it for legacy string-only requests.

**Invariant**: for `{text, dealbreakers}` with nothing else, the output is
byte-identical to today's. A contract test pins this, so fingerprints stay
stable across PR2 to PR5.

## 4. Usage (extended) — `Usage` row (PK `sub`, RK `usage-YYYY-MM`)

| Column | Type | PR | Notes |
|---|---|---|---|
| `count` | int | existing | Monthly analyses |
| `limit` | int | existing | Informational. Enforcement always recomputes it from the tier. |
| `rescoresUsed` | int | PR2 | Free rescores used. Absent reads as 0. The cap is `FREE_RESCORES_PER_MONTH = 10` for both tiers. |
| `unavailableRefunds` | int | PR2 | "Posting unavailable" refunds granted. Absent reads as 0. Capped at 10 (R6). |

**Write discipline**: every update uses `updateEntity(…, "Merge", { etag })`.
`Replace` would drop the columns it does not name (R6). The reset is implicit:
a new month means a new row key.

**State transitions** for one rescore-intent request:

```text
eligible ∧ rescoresUsed < 10 ──charge──▶ rescoresUsed+1 ──model──┬─ 5xx ─────────────────▶ rescoresUsed−1 (refund)
                                                                 ├─ isJobPosting=false ∧ unavailableRefunds < 10
                                                                 │        ─────────────▶ rescoresUsed−1, unavailableRefunds+1
                                                                 └─ success ─────────────▶ (kept)
otherwise ─────────────────────▶ count+1 (existing path; 429 when count ≥ limit) ── same refund branches on count
```

## 5. SavedJob (extended) — `SavedJobs` row and `SavedJobPayload`

| Field | Type | PR | Notes |
|---|---|---|---|
| `analysisJson` | JSON | existing | Contains the extended Fit (§1) |
| `source` | `"url" \| "document" \| "paste"` | existing | Picks the library-row rescore action (R7) |
| `unavailableAt` | ISO string \| absent | PR2 | Set through PATCH after a rescore finds no posting. Cleared (`null`) whenever `analysis` is replaced by PUT or PATCH. |

The rescore action shown on each surface is derived from `source`,
`unavailableAt` and freshness (R7). It is not stored.

## 6. Analyze request (extended)

| Field | Endpoint | PR | Notes |
|---|---|---|---|
| `profile` | both | existing | Legacy serialized string. New clients still send it, for safety during the deploy window. |
| `profileData` | both (form field: JSON) | PR2 | `{ text, dealbreakers, preferences?, confirmedSkills? }`. When present, the server serializes it and ignores `profile`. |
| `rescore` | `analyze-job`: `{ priorFingerprint: string \| null }`; `analyze-document`: `rescore=true` and `priorFingerprint` | PR2 | Rescore intent. Eligibility is decided on the server (R6). |

Response additions: `usage.charged`, `usage.rescoresUsed`,
`usage.rescoresLimit`, and `postingUnavailable?: true`. See
[analyze-api.md](./contracts/analyze-api.md).

## 7. Model configuration — environment (PR1)

| Variable | Default when unset | Validation |
|---|---|---|
| `AZURE_OPENAI_JOB_TEMPERATURE[_PREMIUM]` | omitted from the request | finite number in [0, 2] |
| `AZURE_OPENAI_JOB_REASONING_EFFORT[_PREMIUM]` | omitted | one of `none \| low \| medium \| high \| xhigh` |
| `AZURE_OPENAI_API_VERSION` | the version verified in PR1 (R1) | non-empty string |

Premium settings apply only when the Premium deployment is set. Otherwise
Premium uses the free deployment **and** the free settings. Full contract:
[model-config.md](./contracts/model-config.md).

## 8. Evaluation fixtures (PR1) — `functions/tests/fixtures/`

| Path | Shape |
|---|---|
| `postings/full/<slug>.json` | Exact `PageExtractPayload` exported from `extension/tests/fixtures/pages/<slug>/settled.html` by the shipping extractor, plus `{ expectNotScorable?: true }` |
| `profiles/<id>.json` | `{ id, text, dealbreakers, preferences?, confirmedSkills? }` |
| `profiles/pairs.json` | `[{ posting, profile, violations: string[], unstatedFacts: string[], verdictRange?: [Verdict, Verdict] }]` |
| `../scripts/modelPrices.json` | `{ [deployment]: { inputPer1M, cachedInputPer1M, cacheWritePer1M?, outputPer1M, source, asOf } }` |
