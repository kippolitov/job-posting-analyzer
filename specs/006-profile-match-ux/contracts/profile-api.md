# Contract: Profile endpoints — deltas for 006

**Endpoints**: `GET`, `PUT` and `DELETE /api/profile`, and the new
`POST /api/profile/import`. All are behind `withAuth` with `authLevel:
"anonymous"`, like the existing route.
**Requirements**: FR-002, FR-014, FR-015, FR-018, FR-019 | **Research**: R5,
R11, R12

## 1. GET /api/profile

```jsonc
200 {
  "text": "…", "dealbreakers": ["…"], "updatedAt": "…",          // existing
  "fingerprint": "64-hex",                                         // NEW (PR2), derived on every read
  "preferences": { /* PR4 */ },                                    // NEW, absent when unset
  "confirmedSkills": ["…"]                                         // NEW (PR5), absent when empty
}
404 PROFILE_NOT_FOUND   // unchanged; clients treat this as current fingerprint = null
```

`fingerprintHistory` is never returned.

## 2. PUT /api/profile — merge semantics (PR2)

Body: `{ text: string, dealbreakers: string[], preferences?: Preferences | null,
confirmedSkills?: string[] }`. The response has the same shape as GET, including
the new `fingerprint`.

- **Merge**: fields omitted from the body keep their stored values. An old
  client's `{text, dealbreakers}` save therefore cannot erase preferences or
  confirmed skills it doesn't know about. `preferences: null` clears them, and
  `confirmedSkills: []` clears those.
- **Normalization**: dealbreakers are trimmed and empty ones dropped, as today.
  Confirmed skills are trimmed and deduplicated case-insensitively, keeping the
  first spelling. Preferences are validated against
  [data-model.md §3](../data-model.md) and rejected with `400 INVALID_REQUEST`.
- **Cap**: the serialized `text` plus the Confirmed skills section must be at
  most 20,000 characters.
  - A PUT that **includes** `confirmedSkills`, and the add-skill route in §4a,
    is refused with `400 PROFILE_TOO_LONG` and the existing over-limit wording
    when it would exceed the cap. Silent truncation would drop a just-added
    skill without telling the user.
  - A PUT **without** `confirmedSkills`, as a published extension sends,
    keeps today's behaviour: `text` is truncated at 20,000. Both clients
    already stop text at 20,000 themselves, so this can't start failing saves
    that work today. The combined length may then exceed 20,000 by the skills
    section, which is accepted.
- **History**: if the new fingerprint differs from the stored profile's, the
  previous fingerprint is prepended to `fingerprintHistory`, which is capped at
  20.
- **Concurrency**: the read-merge-write is conditional on the row's ETag and
  retried on 412, up to 4 times, as metering does. "I have this" never uses PUT.
  It uses §4a, so two quick clicks on different skills can't overwrite each
  other.

## 3. DELETE /api/profile

Unchanged. Clients then hold current fingerprint = `null`, so existing fits show
"scored against a deleted profile".

## 4. POST /api/profile/import (PR4, new)

```text
multipart/form-data; one part "file" (.pdf or .docx, ≤ 10 MB)
200 { "text": "…extracted…", "charCount": 18234 }
413 FILE_TOO_LARGE · 415 UNSUPPORTED_FILE_TYPE · 422 FILE_PASSWORD_PROTECTED | FILE_UNREADABLE | FILE_NO_TEXT
    (same codes and messages as analyze-document)
429 RATE_LIMITED   (withRateLimit("analyze"))
```

- It makes **no model call, no metering and no storage**. The file is read into
  memory, `extractDocument` runs, and the bytes go out of scope. Extracted text
  is not logged.
- The text is returned whole, even above 20,000 characters. The editor shows the
  over-limit message, and nothing is saved until the user saves.
- CORS and the preflight route mirror `/api/profile`.

## 4a. POST /api/profile/confirmed-skills (PR5, new)

```text
body { "label": "Terraform" }            // 1..100 chars after trim
200  same shape as GET /api/profile      // includes the new fingerprint
400  INVALID_REQUEST | PROFILE_TOO_LONG
404  PROFILE_NOT_FOUND                   // no profile to add to
```

- The server appends the label to `confirmedSkills` atomically: it reads the
  row, deduplicates case-insensitively, and writes conditionally on the ETag,
  retrying on 412.
- A label that is already present returns 200 with no change, so the call is
  idempotent.
- Fingerprint history is updated exactly as for PUT.

## 5. Contract tests (test-first)

- `fingerprint` is unchanged after a whitespace-only edit, and changed after a
  dealbreaker edit.
- An old-shape PUT keeps stored preferences and confirmed skills.
- `fingerprintHistory` grows only when the fingerprint changes, and is capped
  at 20.
- Two concurrent add-skill calls with different labels both persist.
- A legacy PUT with no `confirmedSkills` truncates text and never returns
  `PROFILE_TOO_LONG`.
- The import never calls `ensureTable` (spy) and never logs the text.
- The import's rejection codes match analyze-document's for every fixture in
  `functions/tests/fixtures/documents/`.
