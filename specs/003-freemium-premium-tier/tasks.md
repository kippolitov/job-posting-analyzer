# Tasks: Freemium Product with Self-Serve Signup and Premium Tier

**Input**: Design documents from `/specs/003-freemium-premium-tier/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: INCLUDED — the constitution (Principle II) mandates test-first: write each test task, confirm it fails, then implement. Integration tests run against Azurite; webhook tests replay really-signed fixtures; extension contract tests use msw.

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md) so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 — user story phases only
- Paths follow the two-package layout: `functions/`, `extension/` (plan.md Project Structure)

> **Operational note (plan.md Rollout)**: US1 (open signup) and US2 (metering) ship to production **together** — `METERING_ENFORCED=true` flips in the same deploy that replaces the allowlist gate, so the free tier is never publicly uncapped. They remain independently *testable*; only the prod flag flip is coupled.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration surface for everything that follows

- [X] T001 Add new settings to `functions/local.settings.json` (dev values) and document them in `specs/003-freemium-premium-tier/quickstart.md` table: `PADDLE_API_BASE_URL`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_PREMIUM_PRICE_ID`, `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM`, `METERING_ENFORCED`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tier vocabulary and the `Users` store — every story reads these

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Write failing unit tests in `functions/tests/unit/userModels.test.ts` for new model surface: `Tier` guard, per-tier constants (`MONTHLY_ANALYSES` 50/300, `SAVED_JOBS_CAP` 100/1000), `UserEntity`/`UsageEntity`/`PaddleEventEntity` codecs (data-model.md tables)
- [X] T003 Extend `functions/src/models/user.ts`: `Tier`, per-tier entitlement constants, `UserEntity`, `UsageEntity`, `PaddleEventEntity`, `AuthenticatedUser` gains `tier` **with default `"free"`** (populated at the middleware boundary — until T008 lands, `withAuth` supplies the default, so US2's metering compiles and fail-safes to free-tier limits); make T002 pass
- [X] T004 Write failing integration tests in `functions/tests/integration/usersStore.test.ts` (Azurite): `getOrCreate` creates `{sub, tier:"free", createdAt}` on miss and returns existing row on hit; `blocked` read; subscription-state Merge upsert; `paddleEventOccurredAt` round-trip; lookup by `paddleCustomerId`
- [X] T005 Implement `functions/src/services/usersStore.ts` (Users table: getOrCreate, getByEmail, findByPaddleCustomerId, setTier, applySubscriptionState — data-model.md `Users`); make T004 pass

**Checkpoint**: Foundation ready — user story phases can start

---

## Phase 3: User Story 1 - Self-Serve Signup to First Analysis (Priority: P1) 🎯 MVP

**Goal**: Anyone with a verified-email Google account signs in (= signup, no approval) and analyzes immediately on the free tier; allowlist gate gone; CLI becomes the admin override.

**Independent Test**: Fresh Google identity → sign in → no invitation screen → analysis succeeds; a `Users` row with `tier:"free"` exists; install-to-first-analysis < 2 min (SC-001).

### Tests for User Story 1 (write first, confirm failing)

- [X] T006 [P] [US1] Extend the signed-JWT middleware suite in `functions/tests/unit/auth.test.ts`: first sign-in auto-creates a Users row and proceeds; existing user gets `tier` attached; `blocked:true` → 403 `NOT_AUTHORIZED` with contact-developer copy; unverified email → 403 with **new** plain-language copy stating a verified Google email is required and how to verify it (FR-002 — no longer the invitation message); allowlist is never consulted; 401 paths unchanged
- [X] T007 [P] [US1] Extend `functions/tests/integration/auth.test.ts` (Azurite): end-to-end signup — request with a really-signed JWT for an unknown email creates the Users row and reaches the handler; second request reuses it (no duplicate)

### Implementation for User Story 1

- [X] T008 [US1] Modify `functions/src/services/auth.ts`: replace `isAllowed`/`recordSignIn` with `usersStore.getOrCreate`; add `blocked` → 403; **split the 403 messages** — unverified email gets verify-your-email guidance (FR-002), blocked gets contact-developer copy; pass `{sub, email, tier}` to handlers; make T006–T007 pass
- [X] T009 [P] [US1] Write failing unit tests in `functions/tests/unit/manageUsers.test.ts` for the reworked CLI: `list`, `set-tier <email> free|premium`, `block`/`unblock`; then implement `functions/scripts/manage-users.ts` (replaces `manage-allowed-users.ts`) and rename the npm alias to `users` in `functions/package.json`
- [X] T010 [P] [US1] Update `extension/components/AuthGate.tsx` + `extension/tests/unit/AuthGate.test.tsx`: invitation copy → self-serve "Sign in with Google to get started"; 403 copy now covers only blocked/unverified accounts (plain language + contact action, Principle III)
- [X] T011 [US1] Update the Playwright P1 journey in `extension/tests/e2e/`: fresh stubbed identity signs in with **no allowlist step**, analyzes a job, result renders (SC-001 journey)

**Checkpoint**: MVP — self-serve signup works end-to-end (deploy to prod only together with US2's flag flip, per the operational note)

---

## Phase 4: User Story 2 - Free-Tier Limits with Clear Exhaustion State (Priority: P2)

**Goal**: Exact 50/month metering (race-proof, fail closed, 429-with-reset-date before any OpenAI spend), 100-job free library cap, and a designed exhaustion experience — never a silent failure.

**Independent Test**: Seed a counter to 49 → 50th analysis succeeds, 51st shows the exhausted card (message + reset date + Upgrade CTA); 20 parallel requests at limit−1 yield exactly 1 success (SC-002); saved jobs/profile/history stay accessible (FR-010).

### Tests for User Story 2 (write first, confirm failing)

- [X] T012 [P] [US2] Write failing unit tests in `functions/tests/unit/meteringService.test.ts` per contracts/metering.md: first-of-month `createEntity`, 409 → re-read, `count >= limit(tier)` → limit-reached result with `resetsAt` (first of next UTC month), 412 → re-read → re-check → retry bounded at 4, **assert no call ever uses `If-Match: *` or omits `ifMatch`**, storage failure → fail-closed error, refund decrements conditionally with floor 0, `limit` recomputed from tier (stored value refreshed)
- [X] T013 [P] [US2] Write failing integration tests in `functions/tests/integration/metering.test.ts` (Azurite): **race — seed `limit−1`, fire 20 parallel check-and-increments: exactly 1 success, 19 limit-reached, final `count == limit`** (SC-002); month rollover creates a new RowKey; mid-month tier flip to premium unblocks with `count` preserved (FR-019)
- [X] T014 [P] [US2] Extend `functions/tests/unit/savedJobsRepository.test.ts` (failing): cap is tier-dependent (free 100, premium 1,000); check fires only on **new** rows — updates/deletes over cap still succeed

### Implementation for User Story 2

- [X] T015 [US2] Implement `functions/src/services/meteringService.ts` (checkAndIncrement, refundOnSystemFailure, resetsAt; algorithm normative in contracts/metering.md); make T012–T013 pass
- [X] T016 [US2] Wire metering into `functions/src/analyze-job/index.ts`: `withAuth(withUsageMetering(handler))`, 429 `USAGE_LIMIT_REACHED` `{count, limit, resetsAt, tier}` before the orchestrator, `usage` echo on 200, best-effort refund on system failure, `METERING_ENFORCED=false` shadow mode (count, never block); extend `functions/tests/unit/analyze-job.handler.test.ts` for all four behaviors
- [X] T017 [US2] Make the saved-jobs cap tier-aware in `functions/src/services/savedJobsRepository.ts` (per-tier `SAVED_JOBS_CAP`) and give `functions/src/jobs/index.ts` tier-aware 409 `LIBRARY_FULL` copy (free: upgrade or remove; premium: prune/export); make T014 pass
- [X] T018 [P] [US2] Map 429 in `extension/services/api/apiClient.ts` (`USAGE_LIMIT_REACHED` with `resetsAt` → typed error distinct from `RATE_LIMITED` and generic failures) + failing-first tests in `extension/tests/unit/apiClient.test.ts` with msw fixtures matching contracts/metering.md verbatim
- [X] T019 [US2] Create `extension/components/UsageExhausted.tsx` + `extension/tests/unit/UsageExhausted.test.tsx`: "You've used all N free analyses this month", concrete reset date, Upgrade action; accessible labels; renders as a designed state, never the generic error banner (FR-009/SC-003)
- [X] T020 [US2] Wire the exhausted state and tier-aware 409 prompt into `extension/components/JobPanel/` (ThisPageTab analyze path, SavedTab save path) + update `extension/tests/unit/JobPanel.test.tsx` / `ThisPageTab.test.tsx`; verify saved jobs/profile/history rendering is untouched by 429 (FR-010)

**Checkpoint**: Free tier fully enforced and humane; US1+US2 together are the shippable freemium core

---

## Phase 5: User Story 3 - Subscribe to Premium and See Plan Status (Priority: P3)

**Goal**: $5/month Paddle checkout from inside the extension; premium active ≤ 1 min via webhook; plan/usage/renewal always visible; premium analyses use the better deployment.

**Independent Test**: Sandbox checkout → webhook fixture → account is premium within a minute without reinstalling (SC-004); exhausted free user upgrades and analyzes immediately (FR-019); AccountBar shows plan, N of M, renewal date; premium analysis records the premium deployment in `model`.

### Tests for User Story 3 (write first, confirm failing)

- [X] T021 [P] [US3] Write failing unit tests in `functions/tests/unit/paddleClient.test.ts`: signature verifier — valid `ts;h1` over **raw bytes**, tampered byte fails, stale `ts` (>300 s) fails, constant-time compare, missing header fails; API wrappers (create transaction with `custom_data`, portal session) against stubbed `fetch` incl. 5xx mapping
- [X] T022 [P] [US3] Build the signed webhook fixture set (shapes from Paddle's sandbox simulator, raw body + test-secret signature) and write failing integration tests in `functions/tests/integration/paddleWebhook.test.ts` for activation: `transaction.completed` and `subscription.activated` (either order) → `tier:"premium"` + customer/subscription fields; duplicate `event_id` → single `PaddleEvents` row, single write, 200; orphan `custom_data` → 200 + logged, no write; bad signature → 400, no state change; flipped tier visible to a subsequent simulated authed request
- [X] T023 [P] [US3] Write failing integration tests in `functions/tests/integration/billing.test.ts` (Azurite + stubbed Paddle API) per contracts/billing-api.md: `GET /api/account` shapes (free no-usage, free with usage, premium renewing); `POST /api/billing/checkout` 200 `{checkoutUrl}` with `custom_data` from the **token** (never body), 409 `ALREADY_PREMIUM`, 502 `BILLING_UNAVAILABLE`; `POST /api/billing/portal` 200, 404 `NO_SUBSCRIPTION`, 502

### Implementation for User Story 3

- [X] T024 [US3] Implement `functions/src/services/paddleClient.ts` (fetch wrapper + `verifyPaddleSignature`); make T021 pass
- [X] T025 [US3] Implement `functions/src/paddle-webhook/index.ts` (anonymous auth level; raw-body verify → `PaddleEvents` ledger `createEntity` → resolve user via `custom_data` then `paddleCustomerId` → activation events per contracts/paddle-webhook.md) and register it in `functions/src/index.ts`; make T022 pass
- [X] T026 [US3] Implement `functions/src/billing/index.ts` (`GET /api/account`, `POST /api/billing/checkout`, `POST /api/billing/portal`, all `withAuth` + OPTIONS twins) and register in `functions/src/index.ts`; make T023 pass
- [X] T027 [P] [US3] Tier-aware deployment selection: failing test in `functions/tests/unit/jobExtractionOrchestrator.test.ts` (premium → `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM`, unset → falls back to free deployment), then thread `tier` through `functions/src/services/jobExtractionOrchestrator.ts` and its caller in `functions/src/analyze-job/index.ts`
- [X] T028 [US3] Run the SC-008 eval gate: `npm run eval:postings` against both deployments on the fixed posting set; record comparison (no extraction regression, improved fit scoring) **and the premium deployment's latency benchmark — assert p95 ≤ 30 s per Constitution IV/QG-4, same budget as the free deployment** — in `specs/003-freemium-premium-tier/eval-premium.md`
- [X] T029 [P] [US3] Create `extension/services/accountService.ts` + failing-first `extension/tests/unit/accountService.test.ts` (msw): fetch `/api/account`, refresh on panel focus and from analyze-response `usage` echo, pending-upgrade polling ≤ 60 s intervals after checkout opens (contracts/billing-api.md client obligations)
- [X] T030 [US3] Create `extension/components/AccountBar.tsx` + `extension/tests/unit/AccountBar.test.tsx`: plan badge, "N of M analyses this month", "Renews on …", Upgrade → checkout URL opens in new tab, Manage subscription → portal URL, loading states >300 ms, accessible labels
- [X] T031 [US3] Mount AccountBar in `extension/entrypoints/sidepanel/App.tsx` and `extension/entrypoints/options/OptionsApp.tsx`; wire the UsageExhausted Upgrade CTA to the checkout flow; update `extension/tests/unit/App.test.tsx` / `OptionsApp.test.tsx`

**Checkpoint**: Revenue path live end-to-end in sandbox; free→premium upgrade unblocks an exhausted account immediately

---

## Phase 6: User Story 4 - Cancel Anytime with Graceful Downgrade (Priority: P4)

**Goal**: Cancel via Paddle portal; premium lasts through the paid period ("Premium until …"); period-end downgrade is data-touchless — over-cap library becomes read-only for additions, nothing deleted.

**Independent Test**: Replay `subscription.updated` (scheduled cancel) → "Premium until <date>"; replay `subscription.canceled` → free tier; a 400-job library lists/updates/deletes/exports but refuses new saves with the read-only explanation; deleting to ≤ 100 restores saves; re-upgrade restores 1,000 (FR-020..023).

### Tests for User Story 4 (write first, confirm failing)

- [X] T032 [P] [US4] Extend `functions/tests/integration/paddleWebhook.test.ts` with lifecycle fixtures: `subscription.updated` with `scheduled_change: cancel` → `endsAt` set, tier untouched; `past_due` status refresh; `subscription.canceled` → `tier:"free"`, status `canceled`, `renewsAt`/`endsAt` cleared; **out-of-order guard** — late `updated` (older `occurred_at`) after `canceled` leaves tier `free`
- [X] T033 [P] [US4] Write failing integration test `functions/tests/integration/downgrade.test.ts` (Azurite): premium user with 400 saved jobs flips to free → list/get/update/delete/export all succeed, new save → 409 `LIBRARY_FULL`; delete to 100 → save succeeds; tier back to premium → saves up to 1,000 (FR-021..023)

### Implementation for User Story 4

- [X] T034 [US4] Extend `functions/src/paddle-webhook/index.ts` with `subscription.updated` / `subscription.canceled` handling and the `paddleEventOccurredAt` stale guard (single Merge write per event, contracts/paddle-webhook.md event table); make T032–T033 pass (T033 needs no new code if R7 holds — the test proves it)
- [X] T035 [US4] Extension downgrade states: read-only banner on the saved list when `count > cap` (explanation + re-upgrade path) in `extension/components/JobPanel/SavedTab.tsx`; AccountBar "Premium until <date>" (`endsAt`) and "Payment problem — update your payment method" (`past_due`, portal link) states in `extension/components/AccountBar.tsx`; msw-backed tests in `extension/tests/unit/SavedTab.test.tsx` / `AccountBar.test.tsx`

**Checkpoint**: Full subscription lifecycle — subscribe, see state, cancel, downgrade gracefully

---

## Phase 7: User Story 5 - Migrate Existing Allowlisted Users Without Interruption (Priority: P5)

**Goal**: One-time idempotent fold of `AllowedUsers` into `Users`; user data untouched (already `sub`-keyed); allowlist code retired.

**Independent Test**: Seed legacy `AllowedUsers` rows (with and without recorded `sub`) → run script → `Users` rows exist with provenance; re-run is a no-op; migrated user signs in and finds all prior data (FR-025..027).

### Tests for User Story 5 (write first, confirm failing)

- [X] T036 [P] [US5] Write failing integration tests in `functions/tests/integration/migrateAllowlist.test.ts` (Azurite): folds each row (`tier:"free"`, `migratedFromAllowlist:true`, `sub`/`addedAt` carried; missing `sub` tolerated — recorded later by getOrCreate); existing `Users` row → skip (409 path); re-run idempotent; `--dry-run` writes nothing and prints the plan

### Implementation for User Story 5

- [X] T037 [US5] Implement `functions/scripts/migrate-allowlist.ts` (local-only, `--dry-run` flag, per-row summary output) + npm alias `migrate-allowlist` in `functions/package.json`; make T036 pass
- [ ] T038 [US5] Retirement cleanup (**gated on prod migration verified** — plan.md R10): delete `functions/src/services/allowedUsersStore.ts`, `functions/scripts/manage-allowed-users.ts`, `functions/tests/unit/allowedUsersStore.test.ts`, `functions/tests/unit/manageAllowedUsers.test.ts`; remove remaining `AllowedUsers` references (`AllowedUserEntity` in `functions/src/models/user.ts`, old npm alias); no-dead-code gate (QG-1)

**Checkpoint**: All five stories independently functional; invite-only era fully retired

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Guardrails, compliance, performance evidence, release readiness

- [X] T039 [P] Write failing unit tests `functions/tests/unit/rateLimiter.test.ts` (fixed window per IP from `x-forwarded-for`, 429 `RATE_LIMITED` distinct from `USAGE_LIMIT_REACHED`, window reset), then implement `functions/src/services/rateLimiter.ts` with defaults **30 analyze req/min/IP and 10 billing req/min/IP**, env-tunable via `RATE_LIMIT_ANALYZE_PER_MIN` / `RATE_LIMIT_BILLING_PER_MIN`, and wire it into `functions/src/analyze-job/index.ts` and `functions/src/billing/index.ts` (documented as friction, not a guarantee — research R8; defaults recorded in contracts/metering.md)
- [X] T040 [P] Author compliance set in `docs/compliance/`: privacy-policy update (account data, usage counters, payment status), terms of sale (developer — not Google — as seller; Paddle as MoR/reseller; refunds per Paddle), CWS prominent-disclosure text, listing copy stating free vs paid (research R9)
- [X] T041 Add the prominent-disclosure/consent surface to the extension sign-in flow (`extension/components/AuthGate.tsx` + test): affirmative consent to the updated data practices before first sign-in (CWS Disclosure Requirements)
- [X] T042 [P] Extend `functions/tests/integration/perf.test.ts`: metering adds ≤ 2 point ops — assert analyze-path auth+metering overhead stays within the existing p95 budgets (QG-4 evidence)
- [ ] T043 [P] Ops configuration pass (document in `specs/003-freemium-premium-tier/quickstart.md` Release gates + apply in Azure): premium deployment created, TPM sized (~30K total), **dynamic quota off** on both deployments, budget alerts configured as alerts-only
- [ ] T044 Run the full quickstart.md validation: all automated suites, manual US1–US5 walkthrough, webhook security spot-checks, Paddle **sandbox** end-to-end smoke (checkout → premium ≤ 1 min; cancel → period-end downgrade), real Google OAuth smoke — the two Complexity Tracking exceptions' mandatory manual pass
- [ ] T045 Release: extension version bump + release notes (self-serve signup, free/premium tiers, disclosure), switch Paddle sandbox → live config in the Function App, CWS listing + dashboard data-usage certification submitted (ships with the release, not after — plan.md PR 6)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: after Setup — **blocks all stories** (T002→T003; T004→T005; T004 [P] with T002)
- **US1 (Phase 3)**: after Foundational
- **US2 (Phase 4)**: after Foundational; independent of US1 code — T003's default `tier: "free"` at the middleware boundary means metering works (fail-safe at free limits) before T008 populates real tiers; **prod flag flip couples to US1's deploy** (operational note)
- **US3 (Phase 5)**: after US2 (upgrade CTA, usage echo, limit recompute) — the tier flip it tests is read by US2's metering
- **US4 (Phase 6)**: after US3 (extends the webhook handler and AccountBar)
- **US5 (Phase 7)**: after US1 (Users table live); T038 additionally gated on prod migration verification
- **Polish (Phase 8)**: T039–T043 anytime after the code they touch exists; T044–T045 last

### Within stories

Tests before implementation (fail first); models → services → endpoints → extension UI; e.g. T012/T013/T014 [P] → T015 → T016/T017; T021/T022/T023 [P] → T024 → T025/T026.

### Parallel Opportunities

- Phase 2: T002+T004 in parallel (different test files)
- US1: T006, T007, T009, T010 all [P] (different files); T008 after T006/T007
- US2: T012, T013, T014 in parallel; then T015; T018 in parallel with backend impl; T019→T020
- US3: T021, T022, T023 in parallel; T027 and T029 parallel to T024–T026; T028 after T027
- US4: T032, T033 in parallel; T035 parallel to T034 once fixtures exist
- Phase 8: T039, T040, T042, T043 all [P]
- Cross-story (if staffed): US2 backend (T012–T017) can proceed in parallel with US1's extension tasks (T010–T011)

## Parallel Example: User Story 2

```bash
# Write all failing tests first, in parallel (different files):
Task: "Unit tests for meteringService in functions/tests/unit/meteringService.test.ts"
Task: "Azurite race test in functions/tests/integration/metering.test.ts"
Task: "Tier-aware cap tests in functions/tests/unit/savedJobsRepository.test.ts"

# Then implement sequentially where files depend: T015 → T016, T017
# Extension track in parallel with backend:
Task: "429 mapping in extension/services/api/apiClient.ts"
```

## Implementation Strategy

### MVP First (US1 + US2 = the shippable freemium core)

1. Phases 1–2 (Setup + Foundational)
2. Phase 3 (US1): self-serve signup — validate independently (fresh identity → analysis)
3. Phase 4 (US2): metering + exhaustion UX — validate the race test and exhausted card
4. **Deploy together** (`METERING_ENFORCED=true` + allowlist gate replaced in one deploy) — this is a viable free-only product

### Incremental Delivery

- + US3 → sandbox revenue path (checkout → webhook → premium ≤ 1 min) → release premium
- + US4 → full lifecycle (cancel, paid-through, graceful downgrade)
- + US5 → migrate the invited cohort, retire the allowlist code
- Phase 8 gates the public launch (compliance + smoke + Paddle live)

### Mapping to plan.md's 6-PR rollout

PR 1 ≈ T012–T016 (metering, shadow) · PR 2 ≈ Phase 2 + US1 backend + T036–T037 + flag flip · PR 3 ≈ T021–T026 · PR 4 ≈ T014/T017 + T027–T028 · PR 5 ≈ extension tasks (T010–T011, T018–T020, T029–T031, T035) · PR 6 ≈ T038, T040–T045

---

## Notes

- [P] = different files, no incomplete-task dependencies
- Every test task must FAIL before its implementation task starts (constitution Principle II)
- Coverage floor ≥ 80% on changed modules (QG-2); never `If-Match: *` (contracts/metering.md); tier is written only by the webhook + CLI
- Commit after each task or logical group; stop at any checkpoint to validate the story independently
