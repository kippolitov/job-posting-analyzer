# Data Model: Job Posting Analyzer

**Feature**: `001-job-posting-analyzer` | **Date**: 2026-07-04

All types live in `extension/types/job.ts` (extension) and are mirrored by the backend's structured-output schema ([contracts/analyze-job.md](./contracts/analyze-job.md)). Field semantics trace to spec FR-004–FR-010.

## Enumerations

```ts
type Arrangement = 'remote' | 'hybrid' | 'onsite' | 'unspecified';
type ArrangementConfidence = 'explicit' | 'inferred' | 'none';
type Seniority =
  | 'junior' | 'mid' | 'senior' | 'staff' | 'principal'
  | 'manager' | 'director' | 'executive' | 'unspecified';
type JobStatus =
  | 'interested' | 'applied' | 'interviewing'
  | 'rejected' | 'ghosted' | 'archived';
type SalaryPeriod = 'year' | 'month' | 'day' | 'hour';
```

## PageExtract (client-side extraction payload)

Produced by the injected extractor; sent to the backend. Never persisted.

| Field | Type | Rules |
|-------|------|-------|
| `url` | `string` | Raw tab URL at extraction time |
| `canonicalUrl` | `string` | Output of `canonicalUrl.ts`; dedup key source |
| `title` | `string` | `document.title` |
| `jsonLd` | `object[]` | Parsed `schema.org/JobPosting` blocks only; `[]` if none |
| `mainText` | `string` | Cleaned main-content text, ≤ 40,000 chars |
| `extractedAt` | `string` (ISO 8601) | Extraction moment (SPA-staleness anchor) |

**Validation**: if `jsonLd` is empty **and** `mainText.length < 300`, the client skips the backend call ("Not enough page content to analyze").

## JobAnalysis (structured extraction result)

Returned by `POST /api/analyze-job`; cached per canonical URL; snapshotted into SavedJob.

| Field | Type | Rules |
|-------|------|-------|
| `isJobPosting` | `boolean` | `false` → panel shows non-job state, still renders fields |
| `title` | `string \| null` | JSON-LD preferred over body text |
| `company` | `string \| null` | JSON-LD preferred |
| `location` | `string \| null` | Free-form as stated |
| `arrangement` | `Arrangement` | `unspecified` when not stated — never guessed (FR-005) |
| `arrangementConfidence` | `ArrangementConfidence` | `explicit` (stated) / `inferred` (derived) / `none` (unspecified) |
| `arrangementEvidence` | `string \| null` | Verbatim substring of input; **required** when `arrangement != 'unspecified'`; server-validated (research R4) |
| `daysInOffice` | `number \| null` | Integer 0–7; null unless stated/directly inferable (evidence required) |
| `daysRemote` | `number \| null` | Integer 0–7; same rule |
| `remoteRestrictions` | `string \| null` | e.g. "US only" |
| `salary` | `Salary \| null` | See below |
| `seniority` | `Seniority` | `unspecified` when not determinable |
| `techStack` | `string[]` | ≤ 25 items |
| `fit` | `Fit \| null` | Null when no profile configured |
| `model` | `string` | Deployment/model id used (metadata) |
| `analyzedAt` | `string` (ISO 8601) | Server timestamp |

### Salary

| Field | Type | Rules |
|-------|------|-------|
| `min` | `number \| null` | |
| `max` | `number \| null` | |
| `currency` | `string \| null` | ISO code when stated ("USD") |
| `period` | `SalaryPeriod \| null` | |

### Fit

| Field | Type | Rules |
|-------|------|-------|
| `score` | `number` | Integer 0–100; a violated dealbreaker caps it at ≤ 20 (FR-006) |
| `rationale` | `string` | ≤ 400 chars, one-to-two sentences; names any violated dealbreaker |

## SavedJob (persisted posting)

Stored in `chrome.storage.local` at key `job:{sha256(canonicalUrl)}`; listed via `job:index`.

| Field | Type | Rules |
|-------|------|-------|
| `schemaVersion` | `number` | `1` at launch; enables future migration (research R5) |
| `canonicalUrl` | `string` | Dedup key (FR-010) |
| `sourceUrl` | `string` | Original URL as visited |
| `analysis` | `JobAnalysis` | Immutable snapshot at save time; replaced only by Re-analyze |
| `status` | `JobStatus` | Defaults to `'interested'` on save (FR-008) |
| `notes` | `string` | Free text, user-editable |
| `savedAt` | `string` (ISO 8601) | Set once on save |
| `updatedAt` | `string` (ISO 8601) | Touched on every status/notes/analysis change |

**State transitions**: `status` may move freely between any two `JobStatus` values (no enforced workflow); every transition updates `updatedAt` and persists immediately (spec US2 scenario 3).

**Index invariant**: `job:index` holds the set of saved hashes + minimal sort/filter projections (savedAt, arrangement, status); it MUST be updated atomically with the job record write and is rebuilt from `job:*` keys if corrupt.

**Capacity rule**: soft cap 1,000 records; at cap, save prompts the user to prune oldest `archived` entries (or export first).

## CandidateProfile

Single `chrome.storage.local` key (`profile`), edited in the options page; sent only inside analysis requests (FR-007).

| Field | Type | Rules |
|-------|------|-------|
| `text` | `string` | Free text (skills, seniority, domains), ≤ 4,000 chars |
| `dealbreakers` | `string[]` | Optional structured list; each is matched by the model during fit scoring |
| `updatedAt` | `string` (ISO 8601) | |

## Cache entry (jobAnalysisCache)

`chrome.storage.session`, key = canonical URL hash.

| Field | Type | Rules |
|-------|------|-------|
| `analysis` | `JobAnalysis` | |
| `cachedAt` | `string` (ISO 8601) | TTL anchor: entries older than 14 days are misses |
| `lastAccess` | `number` (epoch ms) | LRU ordinal; eviction beyond 200 entries |

Note: session scope means the cache also clears on browser restart, so the 14-day TTL only bites within long-lived browser sessions — accepted trade-off per research R8 (saved jobs cover the durable path).

## Relationships

```
CandidateProfile ─(sent with request)→ PageExtract ─(analyze)→ JobAnalysis
                                                                  │ cached by canonicalUrl (session, LRU 200/14d)
                                                                  │ snapshot on Save
                                                                  ▼
                                                              SavedJob (storage.local, durable)
```

Lookup order on side-panel open (US3): `jobStorage.get(canonicalUrl)` → saved view; else `jobAnalysisCache` → cached view; else backend call.
