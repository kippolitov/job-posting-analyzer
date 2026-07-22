# Contract: Existing Endpoints Consumed by the Web App (no backend change)

The library, profile, and account views are **pure consumers** of endpoints that already exist for the extension. The web client calls them with the same `Authorization: Bearer <Google ID token>` and same request/response shapes. Listed here so the web implementation and its MSW contract tests target the real contract; **none of these endpoints change**.

## GET /api/profile · PUT /api/profile

- **GET** → `{ text: string, dealbreakers: string[], updatedAt, schemaVersion }` (the single shared profile).
- **PUT** body `{ text: string, dealbreakers: string[] }` → persists; enforces the **20,000-character** limit server-side (FR-015). Web mirrors the limit client-side for immediate feedback and shows the plain-language message on the server `400`.
- Same profile the extension reads/writes — an edit on either surface is the profile everywhere (FR-005).

## GET /api/jobs

- → `{ jobs: SavedJobPayload[] }`. Optional query filters `arrangement`, `status` exist server-side, but the web app **fetches the full list once and does search / filter (status, arrangement, seniority, fit-score range) / sort / side-by-side compare entirely client-side** (≤ 1,000 rows, research/scale). This keeps rich multi-criteria filtering and comparison off the server (no backend change) and instant on the client.
- `SavedJobPayload` now includes `source` and `filename` (see [data-model.md](../data-model.md)); the web renders a URL link for `source="url"` and the filename for `source="document"`.

## GET/PUT/PATCH/DELETE /api/jobs/{key}

- **PUT `/api/jobs/{key}`** — save/replace a posting. For document-sourced saves, `key = saveKey` and `canonicalUrl` are both taken verbatim from `analyze-document`'s response (the client cannot derive `doc:<hash>` itself), body carries `source:"document"`, `filename`, and that `canonicalUrl`. Server key-verification (`sha256Hex(canonicalUrl) === key`) is unchanged. At-cap → `409 LibraryCapError` with the existing message (FR-024, US5 scenario 2).
- **PATCH `/api/jobs/{key}`** — update `status` / `notes` / `analysis`; `canonicalUrl` & `savedAt` immutable (unchanged).
- **DELETE `/api/jobs/{key}`** — remove; brings an over-cap library back under cap (US5, downgrade rule).
- Web reuses all of these for editing status/notes and deleting from the larger screen.

## GET /api/jobs/export

- → `{ schemaVersion: 1, exportedAt, jobs: SavedJobPayload[] }`. Available to the web for parity; document-sourced rows export with their `source`/`filename`.

## GET /api/account

- → `{ email, tier, usage: { count, limit, resetsAt }, subscription: { status, renewsAt, endsAt } | null }`.
- Drives the web's plan / monthly-usage / renewal-state view (FR-016) — same values the extension shows. Never metered.

## Billing (present, not required by this feature's stories)

`POST /api/billing/checkout` and `POST /api/billing/portal` exist for upgrade/manage flows. The web's "upgrade path" affordance on the quota-exhaustion and library-cap states can link to checkout, reusing the existing contract; no change here.

## MSW contract-test surface (`web/tests/contract`)

Web contract tests stub these exact shapes and assert the UI states:
- auth `401`/`403` → sign-in / verify-email messaging;
- `analyze-document` `429 USAGE_LIMIT_REACHED` → the "allowance used, resets on <date>" state **with the reset date rendered** and an upgrade path;
- `PUT /api/jobs/{key}` `409` → the at-cap refusal message;
- `analyze-document` `413/415/422` → each plain-language upload-error state with accepted formats/size;
- `GET /api/jobs` list → search/filter/sort/compare behavior over the fetched set.
