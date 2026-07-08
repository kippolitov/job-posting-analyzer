# Contract: Profile & Saved-Jobs Storage API

New HTTP endpoints on the existing Function App. All require the auth contract in [auth.md](./auth.md); all responses use `Content-Type: application/json` and the existing error envelope `{ "error": { "code", "message" } }`. The `{key}` path parameter is the SHA-256 hex digest of the canonical URL — the same value the client's `canonicalKey()` computes; the server recomputes it from `canonicalUrl` on writes and rejects mismatches.

Endpoints mirror the existing client interfaces (`JobRepository`, `profileStorage`) one-to-one so only the backing implementation of those modules changes.

## Profile

### `GET /api/profile` ← `getProfile()`

- **200**: `{ "text": string, "dealbreakers": string[], "updatedAt": string }`
- **404** `PROFILE_NOT_FOUND`: no profile stored (client returns `null`)

### `PUT /api/profile` ← `setProfile(input)`

Request: `{ "text": string, "dealbreakers": string[] }` — `text` truncated server-side to 4,000 chars; dealbreakers trimmed, empties dropped (same normalization as today's `setProfile`).

- **200**: the stored profile (as GET), `updatedAt` set server-side
- **400** `INVALID_REQUEST`: body malformed

### `DELETE /api/profile` ← `clearProfile()`

- **204**; idempotent (204 even if absent)

## Saved jobs

### `GET /api/jobs?arrangement=&status=` ← `list(filter)`

Optional filters, values from the existing enums. Sorted `savedAt` descending.

- **200**: `{ "jobs": SavedJob[] }` (full records, same JSON shape as the current `SavedJob` type)
- **400** `INVALID_REQUEST`: unknown filter value

### `GET /api/jobs/{key}` ← `get(canonicalUrl)`

- **200**: `SavedJob`
- **404** `JOB_NOT_FOUND` (client returns `null`)

### `PUT /api/jobs/{key}` ← `save(job)`

Request: full `SavedJob` JSON (`canonicalUrl`, `sourceUrl`, `analysis`, `status`, `notes`, `savedAt`, `updatedAt`, `schemaVersion`). Create or full replace (last write wins). Server validates `sha256(canonicalUrl) == {key}`, enums, notes ≤ 10,000 chars; sets `updatedAt`; preserves stored `savedAt` on replace.

- **200**: the stored `SavedJob`
- **400** `INVALID_REQUEST`: validation failure (incl. key/URL mismatch)
- **409** `LIBRARY_FULL`: would create a new row beyond the 1,000-per-user soft cap (client throws `LibraryFullError`; replaces of existing rows never 409)

### `PATCH /api/jobs/{key}` ← `update(canonicalUrl, patch)`

Request: partial `SavedJob` (`status`, `notes`, and/or `analysis`). `canonicalUrl` and `savedAt` are immutable — present-but-different values are rejected.

- **200**: the updated `SavedJob` (`updatedAt` refreshed server-side)
- **404** `JOB_NOT_FOUND` (client treats as the current no-op semantics)
- **400** `INVALID_REQUEST`

### `DELETE /api/jobs/{key}` ← `remove(canonicalUrl)`

- **204**; idempotent

### `GET /api/jobs/export` ← `exportAll()`

- **200**: `{ "schemaVersion": 1, "exportedAt": string, "jobs": SavedJob[] }` — byte-compatible with the current local export format (FR-009). `Content-Disposition: attachment; filename="saved-jobs.json"`.

### `POST /api/jobs/prune` ← `pruneArchived(count)`

Request: `{ "count": number }` (1–1,000). Deletes the user's oldest-`savedAt` rows with `status = "archived"`, up to `count`.

- **200**: `{ "pruned": number }`
- **400** `INVALID_REQUEST`

## Shared error statuses (all endpoints)

| Status | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` | See auth contract |
| 403 | `NOT_AUTHORIZED` | See auth contract |
| 500 | `SERVICE_ERROR` | Table Storage/unexpected failure (client shows retryable error per Constitution III) |

## Isolation guarantee

Every table operation is scoped to `PartitionKey = sub` from the verified token. `{key}` collisions across users are distinct rows in distinct partitions. There is no endpoint that accepts a user identifier as input.
