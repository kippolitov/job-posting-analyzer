# Data Model: Account-Backed Persistent Storage

All server-side data lives in three Azure Table Storage tables in the Function App's existing storage account (`AzureWebJobsStorage`). Client-side types in `extension/types/job.ts` (`CandidateProfile`, `SavedJob`, `JobAnalysis`, `JobStatus`, `Arrangement`) are unchanged — the tables are a persistence encoding of the same shapes.

## Identity claims (from the verified Google ID token)

| Claim | Use |
|---|---|
| `sub` | Stable per-account identifier. PartitionKey for all user data. Never displayed. |
| `email` | Allowlist lookup key (lowercased; `email_verified` must be true). Shown in the signed-in UI. |

`sub` is authoritative for data ownership; `email` is authoritative for authorization. An email change at Google keeps the user's data (same `sub`) but requires the developer to update the allowlist row.

## Table: `AllowedUsers`

Developer-managed allowlist. Read (point read) by the auth middleware on every request; written only by the CLI.

| Property | Type | Notes |
|---|---|---|
| `PartitionKey` | string | Constant `"AllowedUser"` — single partition; scale is invited-users-sized (ytsummary convention) |
| `RowKey` | string | Email, lowercased and trimmed |
| `sub` | string, optional | Empty until the account's first successful sign-in, then populated by the middleware (Merge update; ytsummary `recordSignIn`) |
| `addedAt` | string (ISO 8601) | Set by CLI on add |
| `note` | string, optional | Free text for the developer (e.g., who this is) |

- **Presence = authorized.** Removal of the row revokes access on the user's next request (middleware does an uncached point read).
- Removing a row never touches `Profiles`/`SavedJobs` rows (spec FR-013).

## Table: `Profiles`

One row per user.

| Property | Type | Notes |
|---|---|---|
| `PartitionKey` | string | Google `sub` |
| `RowKey` | string | Constant `"profile"` |
| `text` | string | ≤ 4,000 chars (existing `PROFILE_TEXT_MAX`, now enforced server-side too) |
| `dealbreakers` | string | JSON-encoded `string[]` |
| `updatedAt` | string (ISO 8601) | Set server-side on PUT |
| `schemaVersion` | number | `1` |

Maps 1:1 to `CandidateProfile { text, dealbreakers, updatedAt }`.

## Table: `SavedJobs`

One row per saved posting per user. Soft cap: 1,000 rows per partition (`SAVED_JOBS_SOFT_CAP`, now enforced server-side).

| Property | Type | Notes |
|---|---|---|
| `PartitionKey` | string | Google `sub` |
| `RowKey` | string | SHA-256 hex of `canonicalUrl`, computed server-side; identical to the client's existing `canonicalKey()` digest |
| `canonicalUrl` | string | The canonical URL itself (RowKey preimage) |
| `sourceUrl` | string | Original page URL |
| `title` | string | Denormalized from analysis for cheap listing |
| `company` | string | Denormalized, nullable → empty string |
| `arrangement` | string | `remote \| hybrid \| onsite \| unspecified` — filterable |
| `status` | string | `interested \| applied \| interviewing \| rejected \| ghosted \| archived` — filterable |
| `notes` | string | Free text, ≤ 10,000 chars (new explicit cap; Table property limit is 64 KB) |
| `analysisJson` | string | JSON-encoded `JobAnalysis` snapshot (≪ 64 KB) |
| `savedAt` | string (ISO 8601) | Immutable after create |
| `updatedAt` | string (ISO 8601) | Set server-side on every write |
| `schemaVersion` | number | `1` (carried over from the local records) |

- **Listing**: `list(filter)` queries `PartitionKey eq sub` (+ optional `arrangement`/`status` clauses), sorts by `savedAt` descending in the handler. At ≤ 1,000 rows per user a partition scan is a single-page-few-pages query — no secondary index needed (the local `job:index` key has no server equivalent).
- **Concurrency**: upserts use last-write-wins (`Replace` mode). Two devices editing the same record converge to the newer write; per-record LWW is the accepted semantics (spec edge case).
- **Isolation invariant**: every read/write the endpoints issue is scoped to `PartitionKey = sub` taken from the verified token — never from request input. Cross-user access is structurally impossible (FR-006 / SC-003).

## Client-side residue (chrome.storage)

| Key | Store | Status after this feature |
|---|---|---|
| `profile`, `job:*`, `job:index` | `storage.local` | Legacy. Read only by the migration flow; deleted after a completed migration; untouched on decline. Never written by new code. |
| `migration:v2` | `storage.local` | NEW — `{ status: "completed" \| "declined", at: string }`. Per-device one-time-offer marker (spec Migration Record entity). |
| `auth:*` | `storage.local` | NEW — cached ID token + decoded expiry, signed-in identity (`sub`, `email`) for UI display, and `signedInAt` (timestamp of the last interactive sign-in). Survives browser restarts; silent renewal keeps the session alive only while `signedInAt` is within ~30 days, after which interactive re-sign-in is required (FR-014a, mimicking ytsummary); sign-out removes it explicitly. |
| analysis cache | `storage.session` | Unchanged (device-local performance cache, out of persistence scope). |

## Entity relationships

```
AllowedUsers (email) ──authorizes──► ID token (email claim)
                                          │ sub claim
                                          ▼
                            Profiles [PartitionKey = sub]  (0..1 row)
                            SavedJobs [PartitionKey = sub] (0..1000 rows)
```

## Validation rules (server-side, mirrored from existing client rules)

- `profile.text`: string, length ≤ 4,000 (truncate like `setProfile` does today); `dealbreakers`: array of non-empty trimmed strings.
- `job.canonicalUrl`: non-empty string, must parse as `http(s)` URL.
- `job.status` / `arrangement`: must be members of the existing enums.
- `job.notes`: ≤ 10,000 chars → `400 INVALID_REQUEST` beyond.
- New-row save when partition already has ≥ 1,000 rows → `409 LIBRARY_FULL` (existing-row replace always allowed).
