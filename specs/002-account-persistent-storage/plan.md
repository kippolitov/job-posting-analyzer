# Implementation Plan: Account-Backed Persistent Storage

**Branch**: `002-account-persistent-storage` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-account-persistent-storage/spec.md`

## Summary

Replace `chrome.storage.local` as the system of record for the candidate profile and saved job postings with per-user server-side storage in the Function App's existing Azure Table Storage account, gated by Google sign-in plus a developer-managed allowlist. The extension acquires a Google **ID token** via `chrome.identity` (OIDC flow through `launchWebAuthFlow` — see the deviation note below), sends it as a Bearer token on every backend request, and a shared `withAuth` middleware on all HTTP functions verifies the token against Google's JWKS (`aud`/`iss`/`exp`), then point-reads an `AllowedUsers` table; non-allowlisted requests get 403 before any OpenAI call. New `Profiles` and `SavedJobs` tables are partitioned by Google `sub` for structural per-user isolation. New profile get/put and jobs list/get/save/update/delete/export/prune endpoints mirror the existing `JobRepository`/`profileStorage` interfaces exactly, so the swap is confined to those modules' implementations. A local CLI manages the allowlist (no deploy needed); a one-time client-side migration offers to upload legacy local data on first sign-in.

**⚠ Deviation from the technical direction (research.md R1)**: `chrome.identity.getAuthToken()` returns an OAuth *access token*, not an ID token, and access tokens cannot be verified against JWKS. To keep the specified middleware (JWKS + `aud`/`iss`/`exp` — the security core of the direction) intact, the client uses `chrome.identity.launchWebAuthFlow()` with an OIDC `id_token` flow instead. Same `chrome.identity` API surface, one service module affected; the middleware is implemented verbatim as directed.

## Technical Context

**Language/Version**: TypeScript 5 (extension + backend), Node 20 (Azure Functions v4)

**Primary Dependencies**: Existing: WXT (MV3), React 18, Tailwind (extension); Azure Functions v4, `openai` (backend). New runtime deps (backend only): `@azure/data-tables` (Table Storage SDK), `google-auth-library` (Google ID-token verification — mimics ytsummary; clarification 2026-07-07). New extension permission: `identity`. No new extension runtime dependencies.

**Storage**: Azure Table Storage in the Function App's existing storage account (`AzureWebJobsStorage` connection string — no new Azure resources): `AllowedUsers` (PK `"AllowedUser"`, RK email, `sub` recorded on first sign-in), `Profiles` (PK `sub`, RK `"profile"`), `SavedJobs` (PK `sub`, RK sha256(canonicalUrl)). `chrome.storage.local` demoted to: legacy migration source + `migration:v2` marker + cached ID token/expiry (`auth:*` — survives restarts for the ~30-day session, FR-014a). `chrome.storage.session`: analysis cache (unchanged).

**Testing**: Vitest (both packages); Azurite emulator for Table Storage integration tests (real wire protocol, no hollow mocks); really-signed JWT fixtures verified via the `GOOGLE_OAUTH_CERTS_URL` stub-certs override for middleware tests (ytsummary's seam); msw contract tests for the extension repositories; Playwright E2E for the sign-in gate P1 journey (seeded `storage.local` auth stub, as in ytsummary's `signIn.test.ts`).

**Target Platform**: Chrome MV3 extension + existing Azure Functions deployment.

**Project Type**: Web extension + serverless backend (existing two-package repo: `extension/`, `functions/`).

**Performance Goals**: Auth middleware overhead ≤ 100 ms p95 warm (JWKS cached in-process by `google-auth-library`; allowlist point read is single-digit ms); saved-list open ≤ 1.5 s p95 on a 1,000-record library; analyze path stays within the existing ≤ 8 s p50 / 30 s ceiling.

**Constraints**: No new Azure resources (same storage account, same Function App); no public admin endpoint (allowlist CLI is local-only); allowlist changes effective without build or deploy (uncached per-request read); client repository interfaces (`JobRepository`, `profileStorage` functions) keep their exact shapes; no user identifier ever accepted as request input (partition key always derived from the verified token); revocation effective on the next request (SC-006).

**Scale/Scope**: Invited-users scale (single-digit-to-tens of accounts); ≤ 1,000 saved jobs per user (soft cap carried over); ~8 new backend modules (middleware, tables service, 9 endpoint handlers, CLI), ~5 new/reworked extension modules (auth service, API client, two repository swaps, gate + migration UI); 5-PR rollout.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Assessment |
|------|-----------|------------|
| ✅ PASS | I. Code Quality | Auth is one shared middleware (`withAuth`) — the cross-cutting concern is extracted, not repeated per endpoint; table access goes through one `tablesService`; endpoint handlers stay thin; client repositories keep single responsibility with swapped internals. 5-PR rollout keeps reviews small. |
| ✅ PASS | II. Testing Standards | Test-first per module; middleware tests use really-signed JWTs verified against a locally served stub JWKS via the `GOOGLE_OAUTH_CERTS_URL` override (crypto actually runs); Table Storage integration tests run against Azurite (official emulator, not hand-rolled mocks); extension contract tests via msw fixtures; Playwright E2E covers the P1 sign-in-gate journey. ≥ 80% coverage on changed modules via existing CI/codecov. One documented exception: real Google OAuth is not driven in CI — see Complexity Tracking. |
| ✅ PASS | III. UX Consistency | New user-facing states all follow the feedback contract: sign-in progress, "access by invitation" message with a request-access action, offline/server-error banners with Retry, migration prompt with explicit Accept/Decline and a completion summary. Stable vocabulary: "sign in", "invitation", "migrate". Gate and prompts get accessible labels; error copy is plain-language + next action (401 → re-sign-in; 403 → how to request access; 409 → export/prune). |
| ✅ PASS | IV. Performance | Middleware verification is offline after JWKS warm-up (~sub-ms) + one point read; well under the 30 s ceiling and budgeted at ≤ 100 ms p95. List/get calls are single-partition Table queries. All new I/O is async; the panel stays interactive (loading states for >300 ms operations). No change to the analyze latency benchmark path beyond the middleware budget. |

**Post-Phase-1 re-check**: PASS — design artifacts (research, data model, contracts, quickstart) introduce no new violations; the single documented exception (no live Google OAuth in CI) stands in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-account-persistent-storage/
├── plan.md              # This file
├── research.md          # Phase 0 — R1..R10 decisions
├── data-model.md        # Phase 1 — tables, keys, validation, client residue
├── quickstart.md        # Phase 1 — dev setup, verification walkthrough
├── contracts/
│   ├── auth.md          # Bearer-token requirements, middleware behavior, 401/403 contract
│   └── storage-api.md   # profile + jobs endpoints mirrored onto the client interfaces
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
functions/src/
├── services/
│   ├── auth.ts                      # NEW — withAuth(handler): google-auth-library verify + allowlist point read + sub recording (ytsummary layout)
│   ├── tablesService.ts             # NEW — TableClient factory, lazy create, entity codecs
│   ├── profileRepository.ts         # NEW — Profiles table CRUD
│   ├── savedJobsRepository.ts       # NEW — SavedJobs table CRUD, cap check, prune
│   └── jobExtractionOrchestrator.ts # unchanged
├── profile/
│   └── index.ts                     # NEW — GET/PUT/DELETE /api/profile (+ OPTIONS twin)
├── jobs/
│   └── index.ts                     # NEW — /api/jobs list/get/save/update/delete/export/prune
├── analyze-job/
│   └── index.ts                     # MODIFIED — wrapped in withAuth (403 before OpenAI)
├── models/
│   ├── job.ts                       # unchanged
│   └── user.ts                      # NEW — AuthedUser, entity types, request guards
└── index.ts                         # MODIFIED — registers new functions

functions/scripts/
└── manage-allowed-users.ts          # NEW — add/remove/list CLI (tsx; npm alias "allowed-users"; not deployed)

functions/tests/
├── unit/                            # NEW — middleware (signed-JWT fixtures), repositories
└── integration/                     # NEW — endpoints against Azurite

extension/
├── services/
│   ├── auth/
│   │   ├── authService.ts           # NEW — launchWebAuthFlow OIDC, silent renewal, storage.local token cache
│   │   └── authState.ts             # NEW — signed-in identity for UI (sub/email), events
│   ├── api/
│   │   └── apiClient.ts             # NEW — authenticated fetch: base URL, key, Bearer, error mapping
│   ├── jobStorage.ts                # MODIFIED — same JobRepository interface, fetch-backed
│   ├── profileStorage.ts            # MODIFIED — same functions, fetch-backed
│   ├── migrationService.ts          # NEW — legacy-data detection, upload, migration:v2 marker
│   ├── jobAnalysisClient.ts         # MODIFIED — attaches Authorization header
│   └── jobAnalysisCache.ts          # unchanged (device-local cache)
├── components/
│   ├── AuthGate.tsx                 # NEW — sign-in / invitation-message / children switch
│   ├── MigrationPrompt.tsx          # NEW — one-time offer, progress, summary
│   └── JobPanel/                    # MODIFIED — signed-in header (email, sign out), 401/403/409 states
├── entrypoints/
│   ├── sidepanel/App.tsx            # MODIFIED — wrapped in AuthGate
│   ├── options/OptionsApp.tsx       # MODIFIED — wrapped in AuthGate
│   └── background.ts                # MODIFIED — token attach for analyze flow
├── types/
│   └── auth.ts                      # NEW — AuthSession, AuthError
└── wxt.config.ts                    # MODIFIED — identity permission, WXT_API_BASE_URL, client ID define
```

**Structure Decision**: Keep the existing two-package layout. Backend additions follow the established folder-per-function pattern (`profile/`, `jobs/` beside `analyze-job/`); shared concerns land in `middleware/` and `services/`. Extension changes are dominated by two in-place implementation swaps (the point of mirroring the interfaces) plus additive auth/migration modules.

## Architecture

```
Extension                                   Azure Function App
─────────                                   ──────────────────
AuthGate (panel + options)
  │ signed out → Sign in with Google
  ▼
authService.launchWebAuthFlow (OIDC)
  ← Google ID token (JWT, 1 h)
  │ cached in storage.local (~30-day session); silent renew (interactive:false)
  ▼
apiClient: fetch + x-functions-key + Authorization: Bearer <idToken>
  │                                          every HTTP function:
  ├── POST /api/analyze-job ────────────►  withAuth ──► orchestrator (unchanged)
  ├── GET/PUT/DELETE /api/profile ──────►  withAuth ──► profileRepository ─► Profiles table
  └── /api/jobs (7 routes) ─────────────►  withAuth ──► savedJobsRepository ─► SavedJobs table
                                             │
                                   1. google-auth-library verifyIdToken
                                      (signature via JWKS, aud, iss, exp in one call)
                                   2. email_verified? → else 403
                                   3. AllowedUsers point read (RK = email) — uncached
                                      + record sub on first sign-in (Merge)
                                   4. fail → 401/403 BEFORE handler/OpenAI
                                   5. pass → handler(user: {sub, email})
                                              partition = sub, always from the token

Developer laptop:  npm run allowed-users -- add|remove|list <email>
                   └── writes AllowedUsers directly; effective next request, no deploy
```

Key properties: per-user isolation is structural (every table operation is scoped to `PartitionKey = sub` from the verified token; no endpoint accepts a user identifier); revocation is immediate (uncached allowlist read per request, research.md R4); 403 precedes all OpenAI spend.

### Migration flow (client-side, research.md R7)

First authorized sign-in on a device → `migrationService` checks for legacy `profile`/`job:*` keys and no `migration:v2` marker → `MigrationPrompt` (Accept/Decline). Accept: idempotent `PUT`s per job (server-existing entries win, duplicates counted), profile conflict resolved by explicit user choice, cap overflow surfaces the standard prune/export prompt; on success write marker + delete legacy keys. Decline: write marker, local data untouched, never re-offered. Failure: no marker, nothing deleted, retry converges.

## Error Handling

| Failure | Behavior |
| --- | --- |
| No/expired token on any request | One silent renewal attempt; then sign-in gate ("Your session ended. Sign in to continue."), in-progress form input preserved in component state (FR-014) |
| 403 `NOT_AUTHORIZED` | Invitation screen: access is by invitation + request-access action (mailto); session cleared |
| Sign-in canceled / `launchWebAuthFlow` error | Gate stays, "Sign-in was canceled." + Try again |
| Server unreachable / 5xx on data ops | Error banner + Retry; never rendered as an empty library (FR-015) |
| 409 `LIBRARY_FULL` on save | Existing export/prune prompt, now server-backed |
| Migration partial failure | Summary of uploaded/remaining, Retry; local data intact (FR-011) |
| Token valid but `email_verified` false | 403 path; invitation screen (ytsummary convention) |

## Testing Strategy

- **Backend unit (Vitest)**: `withAuth` — signed test JWTs (real RSA keypair, stub certs endpoint via `GOOGLE_OAUTH_CERTS_URL`): valid, expired, wrong `aud`, wrong `iss`, bad signature, unverified email, not-allowlisted (403 ordering: no handler invocation — assert via spy); repositories — entity codec round-trips, cap logic, prune ordering.
- **Backend integration (Vitest + Azurite)**: every endpoint end-to-end against emulated tables — CRUD round-trips, filter queries, 409 at cap, export shape byte-compares with the existing local export, cross-user isolation (two `sub`s, zero leakage).
- **Extension unit/contract (Vitest + msw)**: `apiClient` error mapping (401 renew-then-gate, 403, 409); repository implementations against msw fixtures matching contracts/storage-api.md; `migrationService` accept/decline/failure/marker paths (chrome.storage mocked as today).
- **E2E (Playwright)**: P1 journey — signed-out gate on both surfaces, stub sign-in, analyze + save, sign-out returns to gate (auth stub via WXT env; see Complexity Tracking).
- **Regression**: existing analyze-job orchestrator/eval suites unchanged; analyze-job handler tests gain an auth-wrapper case.

## Rollout

1. **PR 1 (backend foundation)** — `services/auth.ts`, `tablesService.ts`, `models/user.ts`, `manage-allowed-users.ts` CLI, Azurite test scaffolding; `analyze-job` wrapped in `withAuth` **behind an env flag** (`REQUIRE_AUTH=false` default) so the deployed extension keeps working until PR 4 ships.
2. **PR 2 (backend endpoints)** — `profile/`, `jobs/` functions + repositories + integration tests.
3. **PR 3 (extension auth)** — `authService`, `AuthGate` on both surfaces, `apiClient`, token on analyze; manifest gains `identity`.
4. **PR 4 (storage swap)** — `jobStorage`/`profileStorage` reimplementations, JobPanel error/header states; flip `REQUIRE_AUTH=true` in the Function App after this extension version is released.
5. **PR 5 (migration)** — `migrationService` + `MigrationPrompt` + E2E.
6. Release notes: new `identity` permission, sign-in requirement, migration prompt.

## Risks & Mitigations

- **`launchWebAuthFlow` silent renewal fails when the Google session cookie is absent** → UX degrades to a re-sign-in prompt, never a broken state; renewal failure is an explicitly designed path (gate + preserved input).
- **Ordering during rollout** (old extension versions can't send tokens) → `REQUIRE_AUTH` flag sequencing in PR 1/PR 4; flag removed in a cleanup PR once the gated version is the floor.
- **Table Storage has no server-side sort** → per-user partitions are ≤ 1,000 rows; in-handler sort is trivial; measured in the integration perf check against the 1.5 s list budget.
- **Allowlist email vs. Google email change** → data is keyed by `sub` so nothing is lost; documented in data-model.md; developer updates the allowlist row.
- **Function key remains embedded in the extension** → unchanged from today and now defense-in-depth only; the Bearer token is the real gate (research.md R5).

## Explicitly Not Changing

- `jobExtractionOrchestrator`, prompt strategy, analyze-job request/response contract (beyond the auth header), analysis cache semantics, canonical-URL logic, JobPanel information architecture, CI/CD workflows (beyond new test scripts), release/versioning process.

## Complexity Tracking

> Constitution Check passed with one documented exception, justified per the Quality Gates exception process.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| E2E does not drive real Google OAuth; Playwright uses a dev-build auth stub (QG-2 adjacent) | Google blocks automated OAuth logins in CI (bot detection, 2FA); a real-account flow would be flaky and leak credentials into CI | Token *verification* is still tested with real cryptography (signed JWTs against a served JWKS) in integration tests — the stub only bypasses the browser-interactive hop; a manual OAuth smoke test is required before release tagging |
