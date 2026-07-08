# Tasks: Account-Backed Persistent Storage

**Input**: Design documents from `/specs/002-account-persistent-storage/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth.md, contracts/storage-api.md, quickstart.md

**Tests**: INCLUDED — the project constitution (Principle II) mandates test-first: write each test task, confirm it fails, then implement. Coverage floor is 80% on changed modules.

**Organization**: Tasks are grouped by user story so each story is an independently testable increment. Mimicry target: `kippolitov/ytsummary` feature 008 (per the 2026-07-07 clarification session) — when in doubt about a convention, match ytsummary's implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = sign-in gate, US2 = server-persisted storage, US3 = migration, US4 = allowlist CLI

## Path Conventions

Two-package repo: `functions/` (Azure Functions v4, TypeScript) and `extension/` (WXT MV3, React). Paths below are repo-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, build config, and shared types every story needs

- [X] T001 Add backend dependencies and scripts in functions/package.json: runtime deps `google-auth-library` + `@azure/data-tables`; devDep `azurite`; scripts `"azurite"` (start table emulator on :10002 with a workspace dir under .gitignore) and `"allowed-users"` (`tsx scripts/manage-allowed-users.ts`); run npm install
- [X] T002 [P] Extension build config in extension/wxt.config.ts: add `"identity"` to manifest permissions; add Vite defines `WXT_API_BASE_URL` and `WXT_GOOGLE_OAUTH_CLIENT_ID` (dotenv-loaded like the existing `WXT_AZURE_FUNCTION_*` pair)
- [X] T003 [P] Backend settings template in functions/local.settings.json.example: add `GOOGLE_OAUTH_CLIENT_ID`, optional `TABLES_CONNECTION_STRING` and `REQUIRE_AUTH` entries with comments matching quickstart.md
- [X] T004 [P] Auth types in extension/types/auth.ts: `StoredAuth { idToken, expiresAt, signedInAt, user }` (`signedInAt` = timestamp of the last *interactive* sign-in, anchoring the ~30-day session horizon of FR-014a), `AuthenticatedUser { sub, email }`, `AuthError` (mirror ytsummary's authClient shapes)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Table access layer and test scaffolding that every backend story builds on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Backend model types in functions/src/models/user.ts: `AuthenticatedUser`, `AllowedUserEntity`, `ProfileEntity`, `SavedJobEntity`, request-body type guards for profile and saved-job payloads (validation rules from data-model.md)
- [X] T006 Azurite integration-test scaffolding: functions/tests/integration/setup.ts (start/connect to Azurite via `TABLES_CONNECTION_STRING=UseDevelopmentStorage=true`, create/clean tables per suite) wired into functions/vitest.config.ts as integration setup; add `npm run test:integration` script
- [X] T007 [P] Signed-JWT test fixtures in functions/tests/helpers/testTokens.ts: generate an RSA keypair once, serve its certs from a local HTTP stub, export `signTestIdToken({ sub, email, aud, iss, exp, email_verified })` and the stub's URL for the `GOOGLE_OAUTH_CERTS_URL` override (ytsummary's test seam)
- [X] T008 Write failing tests for the tables service in functions/tests/unit/tablesService.test.ts: lazy client creation, table auto-create on first use, connection-string resolution order (`TABLES_CONNECTION_STRING` then `AzureWebJobsStorage`)
- [X] T009 Implement functions/src/services/tablesService.ts: `TableClient` factory with lazy `createTable` if-not-exists, `allowInsecureConnection` for local Azurite, shared entity codec helpers (JSON-string properties, ISO timestamps) — make T008 pass

**Checkpoint**: Table layer + test seams ready — user stories can begin

---

## Phase 3: User Story 1 — Invitation-Gated Google Sign-In (Priority: P1) 🎯 MVP

**Goal**: No feature is reachable without a signed-in, allowlisted Google account; non-authorized users see the invitation message; `analyze-job` rejects unauthorized requests before any OpenAI call.

**Independent Test**: With zero storage endpoints deployed — sign in with an allowlisted account and confirm features unlock; sign in with a non-allowlisted account and confirm the invitation message and no reachable features; signed out, confirm the gate on both surfaces (spec US1 acceptance scenarios 1–5).

### Tests for User Story 1 (write first, confirm they FAIL) ⚠️

- [X] T010 [P] [US1] Failing unit tests for the allowlist store in functions/tests/unit/allowedUsersStore.test.ts: `isAllowed` normalizes case/whitespace, 404 → false, other errors rethrow; `recordSignIn` populates `sub` once via Merge and no-ops when absent or already set (Azurite-backed)
- [X] T011 [P] [US1] Failing unit tests for the middleware in functions/tests/unit/auth.test.ts using testTokens.ts: missing/malformed header → 401; bad signature / wrong `aud` / wrong `iss` / expired → 401; `email_verified:false` → 403; valid-but-not-allowlisted → 403 with the wrapped handler NEVER invoked (spy assertion); allowlisted → handler receives `{ sub, email }`; `REQUIRE_AUTH=false` bypass passes through
- [X] T012 [P] [US1] Failing unit tests for the extension auth service in extension/tests/unit/authService.test.ts: auth URL contains `response_type=id_token`, fresh `nonce`, `chrome.identity.getRedirectURL()`; id_token parsed from redirect hash and nonce verified; token + decoded `exp` + `signedInAt` persisted to `chrome.storage.local` (interactive sign-in sets `signedInAt`, silent renewal preserves it); `signInSilently` returns null (never throws) on failure AND refuses without attempting renewal when `signedInAt` is older than 30 days (FR-014a horizon → interactive re-sign-in required); `signOut` clears the stored key
- [X] T013 [P] [US1] Failing Playwright E2E in extension/tests/e2e/signIn.test.ts: signed-out side panel and options page show only the sign-in gate; seeding `chrome.storage.local` with a stub `StoredAuth` (ytsummary's `signIn.test.ts` pattern) unlocks the UI; sign-out restores the gate; account switch (sign out as stub user A, seed stub user B) shows none of user A's data in the panel (spec edge case: second account on the same device)

### Implementation for User Story 1

- [X] T014 [US1] Implement functions/src/services/allowedUsersStore.ts: `isAllowed(email)` point read (PK `"AllowedUser"`, RK lowercased email) and `recordSignIn(email, sub)` Merge update — make T010 pass
- [X] T015 [US1] Implement `withAuth(handler)` in functions/src/services/auth.ts: Bearer extraction → `google-auth-library` `verifyIdToken` (audience `GOOGLE_OAUTH_CLIENT_ID`, certs override `GOOGLE_OAUTH_CERTS_URL`) → `email_verified` check → `isAllowed` → `recordSignIn` → handler with `AuthenticatedUser`; 401 `UNAUTHENTICATED` / 403 `NOT_AUTHORIZED` error envelopes per contracts/auth.md; `REQUIRE_AUTH` env flag (default false until PR 4 ships) — make T011 pass
- [X] T016 [US1] Wrap analyze-job in functions/src/analyze-job/index.ts: handler runs through `withAuth`, `Access-Control-Allow-Headers` gains `Authorization`; update existing handler tests for the authed signature
- [X] T017 [US1] Integration test in functions/tests/integration/auth.test.ts: full request → 401/403/200 paths against Azurite + certs stub, asserting 403 precedes orchestrator execution
- [X] T018 [US1] Implement extension/services/auth/authService.ts (`signIn`, `signInSilently`, `signOut`, `getStoredAuth`, `getIdToken`, `markNotAuthorized` — ytsummary authClient shape, storage.local persistence; FR-014a session horizon: interactive `signIn` records `signedInAt`, `signInSilently` renews only while `signedInAt` is within 30 days and otherwise returns null to force the interactive gate) and extension/services/auth/authState.ts (current-user snapshot + change events for React) — make T012 pass
- [X] T019 [US1] Implement extension/components/AuthGate.tsx with unit tests in extension/tests/unit/AuthGate.test.tsx: signed-out → "Sign in with Google" (progress state >300 ms); `not-authorized` → invitation message with request-access action (mailto) per FR-004; signed-in → children + header with account email and Sign out; session expiry mid-edit → re-sign-in prompt overlays without unmounting children, so in-progress form input survives re-authentication (FR-014); accessible labels throughout
- [X] T020 [US1] Gate both surfaces: wrap panel root in extension/entrypoints/sidepanel/App.tsx and options root in extension/entrypoints/options/OptionsApp.tsx with AuthGate
- [X] T021 [US1] Attach `Authorization: Bearer` in extension/services/jobAnalysisClient.ts; map 401 → one silent renewal then re-sign-in gate, 403 → invitation state (replaces the current "reinstall the extension" copy for those statuses) — E2E T013 now passes

**Checkpoint**: Sign-in gate fully functional and independently demoable (with `REQUIRE_AUTH=true` in local dev)

---

## Phase 4: User Story 2 — Server-Persisted, User-Scoped Profile and Saved Postings (Priority: P2)

**Goal**: Profile and saved postings live in `Profiles`/`SavedJobs` tables keyed by the verified `sub`, identical across devices, with cap/export/prune behavior unchanged; client repositories keep their exact interfaces.

**Independent Test**: Sign in on browser A, edit profile and save postings; sign in on browser B with the same account → identical data; a different allowlisted account sees none of it (spec US2 scenarios 1–6, SC-002/SC-003).

### Tests for User Story 2 (write first, confirm they FAIL) ⚠️

- [X] T022 [P] [US2] Failing unit tests in functions/tests/unit/profileRepository.test.ts: get/put/delete round-trip per `sub`; text truncated at 4,000 chars; dealbreakers trimmed and empties dropped; `updatedAt` set server-side (Azurite-backed)
- [X] T023 [P] [US2] Failing unit tests in functions/tests/unit/savedJobsRepository.test.ts: save recomputes RowKey = sha256(canonicalUrl) and rejects key mismatch; create at 1,000-row cap → cap error, replace at cap allowed; list filters by arrangement/status sorted savedAt desc; patch preserves `canonicalUrl`/`savedAt`; prune deletes oldest-archived first; export shape byte-compatible with the current local `exportAll`
- [X] T024 [P] [US2] Failing endpoint integration tests in functions/tests/integration/storageApi.test.ts covering every route in contracts/storage-api.md: status codes (200/204/400/404/409), error envelopes, `Content-Disposition` on export, cross-user isolation (two subs, zero leakage — SC-003), and allowlist-removal data retention (save data as user X → remove X from AllowedUsers → requests return 403 → re-add X → all data intact and accessible — FR-013)
- [X] T025 [P] [US2] Failing msw contract tests in extension/tests/unit/jobStorage.test.ts and extension/tests/unit/profileStorage.test.ts against storage-api.md fixtures: repository interfaces unchanged; 409 → `LibraryFullError`; 404 on get → null; update on missing → no-op; 401 → renew-then-gate; 403 → invitation state

### Implementation for User Story 2

- [X] T026 [US2] Implement functions/src/services/profileRepository.ts (Profiles table CRUD per data-model.md) — make T022 pass
- [X] T027 [US2] Implement functions/src/services/savedJobsRepository.ts (SavedJobs CRUD, server-side sha256 RowKey, cap check via RowKey-only partition count, prune, export assembly) — make T023 pass
- [X] T028 [US2] Implement profile endpoints in functions/src/profile/index.ts: GET/PUT/DELETE `/api/profile` + anonymous OPTIONS twin, all wrapped in `withAuth`, `authLevel: "function"`, manual CORS headers incl. `Authorization`
- [X] T029 [US2] Implement jobs endpoints in functions/src/jobs/index.ts: GET `/api/jobs`, GET/PUT/PATCH/DELETE `/api/jobs/{key}`, GET `/api/jobs/export`, POST `/api/jobs/prune` + OPTIONS twins, per contracts/storage-api.md
- [X] T030 [US2] Register new functions in functions/src/index.ts; run T024 integration suite to green
- [X] T031 [US2] Implement extension/services/api/apiClient.ts with unit tests in extension/tests/unit/apiClient.test.ts: base URL from `WXT_API_BASE_URL`, function key, Bearer attach, typed error mapping (401 renew-once/403/409/5xx-retryable per plan.md Error Handling)
- [X] T032 [US2] Reimplement extension/services/jobStorage.ts as fetch-backed `JobRepository` (same exported interface, `LibraryFullError` from 409) — make the jobStorage half of T025 pass
- [X] T033 [US2] Reimplement extension/services/profileStorage.ts as fetch-backed (same exported functions incl. `clearProfile`) — make the profileStorage half of T025 pass
- [X] T034 [US2] Panel/options resilience states per FR-015 and Constitution III in extension/components/JobPanel/ and extension/entrypoints/options/OptionsApp.tsx: loading indicators on server-backed reads >300 ms, server-error banner + Retry (never an empty-library rendering on failure), existing cap prompt wired to server 409
- [X] T035 [US2] Playwright E2E in extension/tests/e2e/savedJobs.test.ts: stub-authed save → appears in Saved tab; status/notes edit persists; export downloads JSON

**Checkpoint**: US1 + US2 together deliver the cross-device product; flip `REQUIRE_AUTH=true` in the deployed Function App only after this extension version ships (plan.md Rollout)

---

## Phase 5: User Story 3 — One-Time Migration of Existing Local Data (Priority: P3)

**Goal**: First authorized sign-in on a device with legacy `chrome.storage.local` data offers a one-time migration; accept uploads losslessly with dedupe/merge rules, decline never re-offers; nothing is silently lost.

**Independent Test**: Seed a browser profile with pre-002 `profile`/`job:*` keys, first sign-in → offer appears; accept → rows in `Profiles`/`SavedJobs` and visible from a second device; decline → local data untouched, `migration:v2` marker set, never re-offered (spec US3 scenarios 1–6).

### Tests for User Story 3 (write first, confirm they FAIL) ⚠️

- [X] T036 [P] [US3] Failing unit tests in extension/tests/unit/migrationService.test.ts: legacy detection (profile and/or job:* keys, no `migration:v2` marker); accept path uploads via PUT-per-job with server-existing entries winning and duplicates counted; profile conflict surfaces an explicit-choice callback; cap overflow surfaces prune/export; partial failure leaves local data intact and writes no marker; success writes `{status:"completed"}` and deletes legacy keys; decline writes `{status:"declined"}` and touches nothing; no legacy data → no offer

### Implementation for User Story 3

- [X] T037 [US3] Implement extension/services/migrationService.ts (detection, idempotent upload loop, merge/dedupe per FR-011, `migration:v2` marker in chrome.storage.local) — make T036 pass
- [X] T038 [US3] Implement extension/components/MigrationPrompt.tsx with unit tests in extension/tests/unit/MigrationPrompt.test.tsx: blocking card with Accept/Decline, upload progress (>300 ms feedback), completion summary (uploaded/skipped counts), profile-conflict choice dialog, failure state with Retry
- [X] T039 [US3] Hook the prompt into the post-sign-in flow in extension/components/AuthGate.tsx (offer fires once after first authorized sign-in when migrationService detects legacy data)
- [X] T040 [US3] Playwright E2E in extension/tests/e2e/migration.test.ts: seeded legacy data + stub auth → offer → accept path lands data server-side (msw or local Functions host); decline path never re-offers across panel reloads

**Checkpoint**: Existing installs transition losslessly

---

## Phase 6: User Story 4 — Developer Manages Authorized Users Without Redeploying (Priority: P4)

**Goal**: `npm run allowed-users -- add|remove|list <email>` edits the `AllowedUsers` table directly; changes take effect on the target account's next request with no build or deploy (SC-005/SC-006).

**Independent Test**: `add` a previously unauthorized email → that account's next sign-in works; `remove` it → next server-touching action returns 403 and the invitation message (quickstart.md verification step 2).

### Tests for User Story 4 (write first, confirm they FAIL) ⚠️

- [X] T041 [P] [US4] Failing unit tests in functions/tests/unit/manageAllowedUsers.test.ts: add normalizes email + sets `addedAt` (and optional `note`); add is idempotent; remove deletes the row (idempotent on missing); list prints rows incl. `sub` when recorded; connection string resolution `--connection-string` > `TABLES_CONNECTION_STRING` > `AzureWebJobsStorage`, clear error when none (Azurite-backed)

### Implementation for User Story 4

- [X] T042 [US4] Implement functions/scripts/manage-allowed-users.ts (add/remove/list subcommands, exits non-zero on bad usage; ships in scripts/, never in the deployed package) — make T041 pass

**Checkpoint**: All four user stories independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T043 [P] Verify constitution gates: `npm run lint` zero warnings and `npm run coverage` ≥ 80% on changed modules in both packages; fix shortfalls
- [X] T044 [P] Measure auth-middleware overhead (warm p95 ≤ 100 ms) and 1,000-record list latency (≤ 1.5 s p95) via the integration suite; record results in specs/002-account-persistent-storage/plan.md Performance Goals
- [X] T045 Run the full quickstart.md verification walkthrough (gate, 403 add/remove round-trip, cross-device, migration, isolation) against a local stack and check off each step
- [X] T046 [P] Release notes + docs: new `identity` permission, sign-in requirement, migration prompt, developer allowlist workflow (README or docs/, per the constitution's same-PR documentation rule)
- [ ] T047 (post-release operational step — deliberately open until the gated extension version ships) Rollout sequencing: after the gated extension version is released, set `REQUIRE_AUTH=true` in the Function App, then remove the flag and its bypass code path in a cleanup change (plan.md Rollout steps 4–6)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately; T002–T004 parallel after T001
- **Foundational (Phase 2)**: needs Setup; T007 parallel with T008–T009; T006 before any Azurite-backed test runs
- **US1 (Phase 3)**: needs Foundational. Backend chain: T010/T011 → T014 → T015 → T016 → T017. Extension chain: T012 → T018 → T019 → T020 → T021; T013 written any time after T004, passes after T021
- **US2 (Phase 4)**: needs Foundational + US1's T015 (`withAuth`) for endpoints and T018 (authService) for the client; otherwise independent of US1's UI tasks
- **US3 (Phase 5)**: needs US2 (uploads through the storage API) and US1 (fires post-sign-in)
- **US4 (Phase 6)**: needs only Foundational + T014 (table conventions) — can run in parallel with US2/US3
- **Polish (Phase 7)**: after desired stories complete

### Within Each User Story

Tests written and failing → stores/services → endpoints/components → wiring → integration/E2E green.

## Parallel Example: User Story 1

```bash
# All four failing-test tasks first, in parallel (different files):
Task: T010 allowedUsersStore tests   (functions/tests/unit/allowedUsersStore.test.ts)
Task: T011 withAuth tests            (functions/tests/unit/auth.test.ts)
Task: T012 authService tests         (extension/tests/unit/authService.test.ts)
Task: T013 sign-in gate E2E          (extension/tests/e2e/signIn.test.ts)

# Then backend (T014→T017) and extension (T018→T021) chains in parallel.
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phases 1–2 (Setup + Foundational)
2. Phase 3 (US1) with `REQUIRE_AUTH=true` locally
3. **STOP and VALIDATE**: quickstart steps 1–2 (gate + 403 round-trip using a hand-inserted AllowedUsers row)
4. US1 alone is demoable but not releasable to existing users — release to production only after US2 (data would otherwise be inaccessible behind the gate)

### Incremental Delivery

1. US1 → gate demo
2. US2 → the releasable core (cross-device persistence); ship extension, then flip `REQUIRE_AUTH=true` (T047 sequencing)
3. US3 → protects existing installs' data at upgrade time — ship in the same store release as US2 if any real users have legacy data
4. US4 → developer tooling, deliverable any time after Foundational

### Notes

- Every backend data path takes `sub` from the verified token only — never from request input (SC-003; enforce in code review)
- Commit after each task or logical pair (test + impl)
- ytsummary (`kippolitov/ytsummary`, feature 008) is the reference implementation for T007, T012, T013, T014, T015, T018 — match its conventions when a detail is unspecified
