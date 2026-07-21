# Data Model: Companion Web Application

Scope of change is deliberately small: **one** additive extension to the existing `SavedJobs` shape (to carry document-sourced entries) plus new **client-side-only** view state in `web/`. No new tables; `Users`, `Usage`, and `Profile` are untouched.

## 1. Shared types (moved, not redefined)

The analysis/job types currently duplicated between `extension/types/job.ts` and `functions/src/models/job.ts` move to `shared/types/` and are imported by `extension/`, `web/`, and (via re-export) `functions/`. This is a **refactor with no shape change** — `Arrangement`, `ArrangementConfidence`, `Seniority`, `SalaryPeriod`, `Salary`, `Fit`, `JobStatus`, `JOB_STATUSES`, `ARRANGEMENTS`, `JobAnalysisPayload`, `JobAnalysisResponse`, `MAIN_TEXT_CAP` keep identical definitions. `functions/src/models/job.ts` re-exports from `shared/` to avoid churn in server imports.

## 2. SavedJobs — document-source extension

### Existing shape (unchanged fields)

`SavedJobEntity` (Table row): `partitionKey = Google sub`, `rowKey = sha256(canonicalUrl)`, plus `canonicalUrl`, `sourceUrl`, `title`, `company`, `arrangement`, `status`, `notes`, `analysisJson`, `savedAt`, `updatedAt`, `schemaVersion`.

`SavedJobPayload` (wire): `schemaVersion`, `canonicalUrl`, `sourceUrl`, `analysis`, `status`, `notes`, `savedAt`, `updatedAt`.

### New fields (additive)

| Field | Type | Applies to | Notes |
|-------|------|-----------|-------|
| `source` | `"url" \| "document"` | all rows | **Discriminator.** Absent/`"url"` on existing rows via migration default (see §2.3) — backward compatible. |
| `filename` | `string` | `source="document"` | The uploaded document's original filename (display + provenance). Empty string for `source="url"`. |

For `source="document"` rows:
- `canonicalUrl` is **not** an http URL. It carries the synthetic identity `doc:<sha256(extractedText)>` (namespaced so it can never collide with a real URL and so existing URL-hash logic still "just works" when it hashes this string).
- `sourceUrl` is empty (no origin URL); the UI shows `filename` instead of a link.
- `rowKey = sha256(canonicalUrl) = sha256("doc:" + sha256(extractedText))` — same hashing primitive as URL rows, so `saveJob` key-verification (`sha256Hex(payload.canonicalUrl) === key`) is unchanged.

### 2.1 State & lifecycle

Identical to existing saved jobs: `status` transitions across `JOB_STATUSES` (`interested → applied → interviewing → rejected/ghosted/archived`), `notes` editable, `analysis` snapshot immutable except via re-save. Last-write-wins per row. **Cap and over-cap read-only-on-downgrade semantics apply unchanged** — a document-sourced save is a new row and is refused with the existing `LibraryCapError` (409) when the partition is at the tier cap (100 free / 1,000 premium); a downgraded over-cap library stays read-only-for-additions, never truncated.

### 2.2 Validation changes

`isSavedJobPutBody` currently hard-requires `isHttpUrl(canonicalUrl)`. It becomes **discriminated**:
- `source` omitted or `"url"` → validate exactly as today (`isHttpUrl(canonicalUrl)` required, `filename` ignored/empty).
- `source === "document"` → require `canonicalUrl` to match `^doc:[0-9a-f]{64}$`, require non-empty `filename`, `sourceUrl` may be empty; `analysis`, `status`, `notes`, timestamps validated as today.

`SavedJobAnalysis` snapshot is unchanged (`isJobPosting`, `title`, `company`, `arrangement`, `model`, `analyzedAt`, …) — a document analysis produces the same snapshot as a page analysis.

### 2.3 Migration / backward compatibility

No data migration job. Reads default a missing `source` to `"url"` and a missing `filename` to `""` at the repository boundary, so pre-existing rows and older extension clients keep working. `schemaVersion` bumps for rows written with the new fields; the extension and web tolerate both.

## 3. Document-analysis transient objects (not persisted)

| Object | Lifetime | Notes |
|--------|----------|-------|
| **UploadedDocumentBytes** | Request-scoped, in-memory only | The raw `.docx`/`.pdf` bytes from `request.formData()`. Never written to storage; discarded when the request ends. 10 MB hard cap at the boundary. |
| **ExtractedText** | Request-scoped | Result of mammoth/unpdf extraction; capped at `MAIN_TEXT_CAP` (40,000) before the orchestrator. Its `sha256` becomes the document identity/`saveKey`. |
| **DocumentAnalysisResult** (wire, response) | Returned to client, not stored server-side | `{ analysis: JobAnalysisResponse, source: "document", filename: string, saveKey: string, usage: {count,limit,resetsAt,tier} }`. `saveKey = sha256("doc:" + sha256(extractedText))`. The client uses `saveKey` to PUT into `/api/jobs/{saveKey}` if the user chooses to save. |

**Retention invariant (FR-025, SC-008)**: after any document request — success, rejection, or mid-way failure — zero document bytes persist. Only a *saved* result persists, and only as the analysis snapshot + `filename` (never the original file); document-sourced rows expose no file download.

## 4. Client-side view state (`web/`, ephemeral)

Not persisted server-side; recomputed from the fetched library on each load.

| State | Shape | Purpose |
|-------|-------|---------|
| **LibraryQuery** | `{ text: string; status?: JobStatus; arrangement?: Arrangement; seniority?: Seniority; fitMin?: number; fitMax?: number; sort: SortKey }` | Drives client-side search/filter/sort over the fetched `SavedJobPayload[]`. Fit range 0–100. |
| **CompareSelection** | `SavedJobPayload[]` (small fixed max) | Postings chosen for side-by-side view. |
| **AuthSession** | `{ idToken: string; sub: string; email: string; exp: number } \| null` | **In-memory only** (research R2). Refreshed silently before `exp`. |

## 5. Entity relationships (unchanged topology)

```
Account (Google sub)
 ├── Profile            (1:1)   — GET/PUT /api/profile, ≤ 20,000 chars, shared
 ├── Usage              (1 per UTC month) — atomic metering, shared
 └── SavedJobs          (0..cap) — PK=sub, RK=sha256(canonicalUrl)
                                    source ∈ {url, document}
                                    document rows: canonicalUrl = "doc:"+sha256(text), + filename
```

The web app and the extension are two clients of this one server-side model — no per-surface copy, matching FR-004/FR-005.
