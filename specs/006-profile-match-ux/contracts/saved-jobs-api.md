# Contract: Saved jobs — deltas for 006

**Endpoints**: `GET /api/jobs`, `GET`, `PUT` and `PATCH /api/jobs/{key}`.
**Requirements**: FR-003, FR-003a, FR-004 | **Research**: R4, R7

## 1. Payload

`SavedJobPayload` gains `unavailableAt?: string | null`, an ISO timestamp.

- **GET** returns it when it is set, and omits it otherwise.
- **PATCH** accepts `unavailableAt: string | null`. A string must parse as an
  ISO date, or the request gets `400 INVALID_REQUEST`.
- **PUT** or **PATCH** that includes `analysis` always clears it, even if the
  same body also sends `unavailableAt`. A new analysis proves the posting is
  reachable.
- `analysis` may carry the extended Fit ([data-model.md §1](../data-model.md)).
  `isSavedJobAnalysis` is unchanged, so old and new analyses both validate.

## 2. Client usage

| Event | Client call |
|---|---|
| Rescore succeeds | `PATCH { analysis }`. This is the existing call, which clears `unavailableAt`. |
| Rescore finds no posting (thin content, or `postingUnavailable`) | `PATCH { unavailableAt: now }`. The analysis is left untouched. |
| Old extension re-analyzes | Existing `PATCH { analysis }`. This clears the flag, which is correct. |

## 3. Compatibility

- Old clients never send `unavailableAt`. `isSavedJobPatchBody` already accepts
  unknown fields, and `patchJob` copies only known ones, so the field is
  preserved.
- No `schemaVersion` bump is needed, because the change is additive.

## 4. Contract tests (test-first)

- A PATCH with `unavailableAt` round-trips through GET and list.
- A PATCH with `analysis` clears it, and so does a PUT.
- A PATCH with an invalid date is a 400.
- An old-shape PATCH such as `{status}` preserves it.
