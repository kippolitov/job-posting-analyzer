# Implementation Plan: Freemium Product with Self-Serve Signup and Premium Tier

**Branch**: `003-freemium-premium-tier` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-freemium-premium-tier/spec.md`

## Summary

Convert the invite-only extension into a freemium product on top of feature 002's auth stack. Google OIDC sign-in and the `withAuth` middleware stay exactly as shipped; the `AllowedUsers` boolean gate is replaced by a `Users` table row (PK `"User"`, RK lowercased email, carrying `sub`, `tier: "free" | "premium"`, `paddleCustomerId` and subscription display state) that is **auto-created on first sign-in** — no allowlist for regular users, with the CLI retained as an admin override (tier override, block, list). Per-user monthly metering lives in Azure Table Storage as one entity per user per month (`PartitionKey = sub`, `RowKey = "usage-" + YYYY-MM`, `{ count, limit }`), incremented **before** the OpenAI call (fail closed) using documented ETag optimistic concurrency — `createEntity` for the first call of the month (409 → re-read), `updateEntity` with `ifMatch` in a bounded retry loop on 412, never `If-Match: *` — returning **429 with the reset date** once `count >= limit` (free 50, premium 300). Payments use **Paddle Billing with Paddle as merchant of record** (global VAT/sales tax, invoicing, disputes handled by Paddle): a server-created checkout carrying the verified Google `sub` in `customData`, one new webhook Azure Function verifying the `Paddle-Signature` HMAC and handling `transaction.completed` / `subscription.activated` / `subscription.updated` / `subscription.canceled` idempotently, flipping `tier` on the Users row — effective on the user's next request because the read is uncached (the same property that made 002's revocation immediate). Paddle's customer portal handles cancel and payment-method changes, so the extension builds no billing UI beyond plan/usage display and links. Model selection becomes tier-aware in the orchestrator (free keeps `gpt-4o-mini`, premium uses a new `gpt-4.1-mini` deployment via an env-var pair), and the saved-jobs cap check reads the tier (100 free / 1,000 premium; over-cap libraries become read-only for additions on downgrade — the existing new-row-only cap check already has these semantics). Spend guardrails per [docs/research/freemium-monetization.md](../../docs/research/freemium-monetization.md): the Azure OpenAI deployment TPM quota (~30K TPM, dynamic quota off) stays as the hard backstop, a light per-IP rate limit is added at the Functions layer, and Azure budgets are treated as alerts only (they never stop spend). Chrome Web Store compliance (privacy policy update, prominent disclosure, transparent seller terms) ships with the release.

## Technical Context

**Language/Version**: TypeScript 5 (extension + backend), Node 20 (Azure Functions v4)

**Primary Dependencies**: Existing: WXT (MV3), React 18, Tailwind (extension); Azure Functions v4, `openai`, `@azure/data-tables`, `google-auth-library` (backend). New runtime deps: **none required** — Paddle webhook signature verification is HMAC-SHA256 over the raw body (Node `crypto`), and Paddle API calls (create transaction, portal session) are plain `fetch` against `api.paddle.com` / `sandbox-api.paddle.com`. (`@paddle/paddle-node-sdk` is an optional convenience — decision R3 in research.md keeps it out to preserve the zero-new-deps posture; revisit at implementation if hand-rolling proves noisy.)

**Storage**: Azure Table Storage, same storage account (no new Azure resources): **`Users`** (PK `"User"`, RK lowercased email — replaces `AllowedUsers` as the auth-adjacent read; carries `sub`, `tier`, `blocked`, Paddle subscription display state), **`Usage`** (PK `sub`, RK `"usage-" + YYYY-MM`, `{ count, limit }` — ETag optimistic concurrency, no server-side atomic increment exists), **`PaddleEvents`** (PK `"PaddleEvent"`, RK event id — webhook idempotency ledger). `Profiles` / `SavedJobs` unchanged. `AllowedUsers` retired after a one-time migration script folds rows into `Users`.

**Payments**: Paddle Billing (merchant of record). Sandbox environment for dev/test; env vars `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_API_BASE_URL` (sandbox vs live), `PADDLE_PREMIUM_PRICE_ID`. Checkout is created server-side (verified `sub`/email in `custom_data`), opened by the extension in a new tab; the customer portal link is fetched server-side per request.

**Testing**: Vitest (both packages), following 002's conventions exactly: Azurite for Table Storage integration tests — including **concurrency races on the usage counter** (N parallel increments near the cap; successes must never exceed the cap); **signed webhook fixtures** (raw-body HMAC with a test secret; shapes captured from Paddle's webhook simulator) replayed against the webhook handler, including duplicate and out-of-order delivery; msw contract tests in the extension for the new 429-with-reset-date, plan/usage display, and upgrade states; signed-JWT middleware tests extended for the Users auto-create path; existing eval harness (`functions/scripts/evalPostings.ts`) reused to compare free vs premium deployments (SC-008).

**Target Platform**: Chrome MV3 extension + existing Azure Functions deployment.

**Project Type**: Web extension + serverless backend (existing two-package repo: `extension/`, `functions/`).

**Performance Goals**: Metering adds at most 2 Table Storage point ops to the analyze path (read/insert + conditional update, single-digit ms each against 002's measured baseline of 2.4 ms auth overhead) — analyze stays within the existing ≤ 8 s p50 / 30 s ceiling. Checkout URL creation ≤ 2 s (one Paddle API call). Webhook processing ≤ 1 s typical; premium activation end-to-end ≤ 1 min (SC-004) is dominated by Paddle's delivery latency, not ours.

**Constraints**: No new Azure resources; the increment happens **before** the OpenAI call and fails closed (metering-store outage ⇒ 503, no unmetered spend); cap enforcement must be exact under parallel requests (SC-002) — ETag conditional writes, never `If-Match: *`, bounded retries; tier changes effective next request without caching (mirrors 002's revocation property, SC-004); no user identifier ever accepted as request input (usage partition and checkout `custom_data` both derive from the verified token); worst-case free-user cost < $0.15/month (SC-005: 50 × $0.0027 ≈ $0.135 OpenAI + storage noise — holds); deployment TPM quota ~30K with dynamic quota **off** caps blast radius at ≈ $311/month regardless of bugs; Chrome Web Store "Accepting Payment", privacy-policy, Limited Use, and prominent-disclosure policies are release gates.

**Scale/Scope**: Self-serve public scale (thousands of free users; research cost tables hold to 5,000+); ~7 new/modified backend modules (usersStore, meteringService, rateLimiter, billing endpoints, paddle webhook + verifier, orchestrator tier threading, CLI rework), ~6 extension modules touched (account/usage state + UI, 429 states, upgrade/portal links, gate copy swap), 2 new tables + 1 retired, 6-PR rollout, plus store-listing/compliance artifacts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Assessment |
|------|-----------|------------|
| ✅ PASS | I. Code Quality | Each new concern is one module: `usersStore` (tier/identity row), `meteringService` (counter + 429 contract), `paddle/webhook` (signature + event dispatch), `billing/` endpoints (checkout/portal), `rateLimiter` (per-IP). `withAuth` keeps single responsibility — it swaps its allowlist point-read for a Users point-read/auto-create; metering composes as a separate wrapper on analyze-job rather than bloating the auth middleware. CLI evolves in place. 6-PR rollout keeps reviews small. |
| ✅ PASS | II. Testing Standards | Test-first per module. Counter races run against Azurite (real wire protocol — the 409/412 paths actually fire); webhook tests replay **really-signed** fixtures (HMAC computed over raw bytes, same as production verification) including replays/out-of-order; middleware tests extend 002's signed-JWT suite; msw contract tests cover 429/upgrade/account states; eval harness compares deployments for SC-008. ≥ 80% coverage on changed modules via existing CI. Two documented exceptions (live Paddle checkout and live Google OAuth not driven in CI) — see Complexity Tracking. |
| ✅ PASS | III. UX Consistency | Exhaustion is a designed state, never a silent failure (FR-009/SC-003): 429 renders the "all 50 free analyses used" card with concrete reset date + Upgrade action; library-cap 409 gets tier-aware copy with upgrade/remove actions; downgraded over-cap library shows a read-only explanation + re-upgrade path; plan/usage/renewal are always visible in the account view. Stable vocabulary: "analysis", "plan", "Free"/"Premium", "upgrade", "renews/ends". All new interactive elements labeled; >300 ms operations (checkout-link fetch, account load) show progress. Errors keep plain language + next action. |
| ✅ PASS | IV. Performance | Metering adds ≤ 2 point ops (~ms) inside the analyze path — within the 30 s ceiling and the existing p95 budgets; the 429 path returns *before* any OpenAI call (faster than a served analysis). Webhook and billing endpoints are off the analyze hot path. Per-IP limiter is in-process (no I/O). The premium deployment (`gpt-4.1-mini`) must be validated against the ≤ 30 s benchmark in CI like the free one. |

**Post-Phase-1 re-check**: PASS — research decisions (R1–R10) and design artifacts introduce no new violations; the two CI exceptions stand in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/003-freemium-premium-tier/
├── plan.md              # This file
├── research.md          # Phase 0 — R1..R10 decisions
├── data-model.md        # Phase 1 — Users/Usage/PaddleEvents tables, transitions
├── quickstart.md        # Phase 1 — dev setup (Azurite + Paddle sandbox), verification walkthrough
├── contracts/
│   ├── metering.md      # usage semantics, 429 contract, refund-on-system-failure
│   ├── billing-api.md   # GET /api/account, POST /api/billing/checkout, POST /api/billing/portal
│   └── paddle-webhook.md# signature verification, event handling, idempotency ledger
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
functions/src/
├── services/
│   ├── auth.ts                      # MODIFIED — allowlist point-read → usersStore.getOrCreate; blocked check; passes tier on user
│   ├── usersStore.ts                # NEW — Users table: getOrCreate (first sign-in), tier read, subscription-state upserts (replaces allowedUsersStore)
│   ├── meteringService.ts           # NEW — checkAndIncrement (createEntity 409→re-read; updateEntity ifMatch, bounded 412 retries), refundOnSystemFailure, resetsAt
│   ├── rateLimiter.ts               # NEW — in-process fixed-window per-IP limiter (x-forwarded-for), analyze + billing routes
│   ├── tablesService.ts             # unchanged
│   ├── profileRepository.ts         # unchanged
│   ├── savedJobsRepository.ts       # MODIFIED — cap becomes tier-dependent (100 free / 1,000 premium); new-row-only check ⇒ over-cap read-only for additions
│   └── jobExtractionOrchestrator.ts # MODIFIED — deployment chosen by tier (env pair); `model` already flows into the saved analysis
├── billing/
│   └── index.ts                     # NEW — GET /api/account · POST /api/billing/checkout · POST /api/billing/portal (all withAuth)
├── paddle-webhook/
│   └── index.ts                     # NEW — POST /api/paddle-webhook: raw-body HMAC verify, event dispatch, idempotency ledger (NOT behind withAuth; Paddle is the caller)
├── services/paddleClient.ts         # NEW — fetch wrapper for Paddle API (create transaction, portal session), signature verifier
├── analyze-job/
│   └── index.ts                     # MODIFIED — withAuth(withUsageMetering(handler)); 429 before orchestrator; usage echoed in response
├── jobs/
│   └── index.ts                     # MODIFIED — tier-aware LIBRARY_FULL copy (upgrade vs prune)
├── models/
│   └── user.ts                      # MODIFIED — UserEntity, UsageEntity, Tier, per-tier limits; AuthenticatedUser gains tier
└── index.ts                         # MODIFIED — registers billing + paddle-webhook

functions/scripts/
├── manage-users.ts                  # REWORKED from manage-allowed-users.ts — list / set-tier / block / unblock (admin override; not deployed)
└── migrate-allowlist.ts             # NEW — one-time AllowedUsers → Users fold (idempotent), then AllowedUsers retirement

functions/tests/
├── unit/                            # + meteringService (ETag paths mocked at SDK seam), paddle signature verifier, tier selection
└── integration/                     # + Azurite counter races, webhook fixture replay, billing endpoints, tier-aware caps

extension/
├── services/
│   ├── api/apiClient.ts             # MODIFIED — maps 429 USAGE_LIMIT_REACHED {resetsAt}; account/billing calls
│   ├── accountService.ts            # NEW — GET /api/account state (plan, usage, renewal), refresh on panel focus / after analyze
│   └── auth/…                       # unchanged (sign-in *is* signup now)
├── components/
│   ├── AuthGate.tsx                 # MODIFIED — invitation copy → self-serve sign-in copy; 403 now only blocked/unverified
│   ├── AccountBar.tsx               # NEW — plan badge, "N of M analyses this month", renews/ends date, Upgrade / Manage subscription links
│   ├── UsageExhausted.tsx           # NEW — the FR-009 card: all-N-used message, reset date, Upgrade CTA
│   └── JobPanel/                    # MODIFIED — exhausted state on analyze, tier-aware LIBRARY_FULL prompt, read-only library banner
├── entrypoints/…                    # MODIFIED — AccountBar mounted in sidepanel + options
└── wxt.config.ts                    # unchanged (checkout/portal URLs come from the backend)

docs/
└── compliance/                      # NEW — privacy-policy update, terms of sale (developer as seller), CWS listing disclosure text
```

**Structure Decision**: Keep the two-package layout and 002's folder-per-function pattern (`billing/`, `paddle-webhook/` beside `analyze-job/`). `usersStore` replaces `allowedUsersStore` in place rather than adding a parallel store; metering is a composable wrapper so `withAuth` stays a pure authn/authz boundary (Principle I).

## Architecture

```
Extension                                      Azure Function App
─────────                                      ──────────────────
Sign in with Google (= signup, no approval)
  │  Bearer <idToken> on every request
  ▼
apiClient ── POST /api/analyze-job ──────►  withAuth
                                              1. verify JWT (unchanged from 002)
                                              2. email_verified? else 403
                                              3. Users point-read (RK=email, uncached)
                                                 ├─ absent → createEntity {sub, tier:"free"} ← SELF-SERVE SIGNUP
                                                 ├─ blocked → 403
                                                 └─ present → user {sub, email, tier}
                                            withUsageMetering            ← analyze-job only
                                              4. Usage upsert PK=sub RK=usage-YYYY-MM
                                                 first-of-month: createEntity (409 → re-read)
                                                 count >= limit(tier) → 429 {resetsAt, upgrade}  ← BEFORE OpenAI
                                                 else updateEntity ifMatch=etag (412 → re-read,
                                                 re-check, retry ≤4; exhausted → 503 fail closed)
                                              5. orchestrator(deployment by tier:
                                                   free    AZURE_OPENAI_JOB_DEPLOYMENT (gpt-4o-mini)
                                                   premium AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM (gpt-4.1-mini))
                                                 system-failure → best-effort usage refund (FR-007)

AccountBar ── GET /api/account ──────────►  withAuth → {tier, usage{count,limit,resetsAt},
                                                        subscription{status, renewsAt|endsAt}}
Upgrade ──── POST /api/billing/checkout ─►  withAuth → paddleClient.createTransaction(
  opens returned URL in new tab                custom_data: {sub, email} ← from the TOKEN, never the client)
Manage ───── POST /api/billing/portal ───►  withAuth → portal-session URL for paddleCustomerId

Paddle ───── POST /api/paddle-webhook ───►  verify Paddle-Signature (ts + h1 HMAC-SHA256, raw body)
                                            PaddleEvents ledger (RK=event_id; dup → 200 no-op)
                                            transaction.completed / subscription.activated → tier:"premium"
                                            subscription.updated → renewal/scheduled-cancel display state
                                            subscription.canceled → tier:"free" (paid-through honored by
                                              Paddle sending the event at period end)
                                            occurred_at guard: stale events never overwrite newer state
                                            → next request reads the new tier (uncached ⇒ ≤1 min, SC-004)

Guardrails: per-IP fixed-window limiter (in-process) on analyze/billing · deployment TPM ~30K,
dynamic quota OFF (≈$311/mo worst-case ceiling) · Azure budget = alert only, never a stop
```

Key properties carried forward from 002: partition keys always derive from the verified token; the per-request Users read is uncached, so tier flips (upgrade *and* revocation/block) are effective on the next request; 401/403/429 all return before OpenAI spend.

### Downgrade semantics (FR-021..023)

Downgrade is **data-touchless**: the webhook flips `tier` only. The saved-jobs cap check already only blocks *new* rows, so a 400-job library under a 100 cap is automatically read-only-for-additions (view/search/update/delete/export still work); deleting to ≤ 100 restores saves; re-upgrading restores the 1,000 cap. Usage `limit` is recomputed from tier at each check, so mid-month upgrades unblock immediately with prior usage counted (FR-019) and mid-month downgrades re-block at 50 without touching `count`.

## Error Handling

| Failure | Behavior |
| --- | --- |
| Monthly allowance exhausted | 429 `USAGE_LIMIT_REACHED` + `{count, limit, resetsAt}`; extension renders the exhausted card (message, reset date, Upgrade CTA). Saved jobs/profile/history untouched (FR-010) |
| Metering store unavailable / retries exhausted | 503 `SERVICE_ERROR` before OpenAI (fail closed); extension shows standard retry banner |
| Analysis fails after increment (orchestrator/OpenAI 5xx) | Best-effort usage refund (conditional decrement); failure to refund is logged, never surfaced (worst case: one over-count) |
| Save at tier cap | 409 `LIBRARY_FULL` with tier-aware copy — free: upgrade or remove; premium: prune/export (existing flow) |
| Downgraded over-cap library | Saves blocked (409), banner explains read-only-for-additions + re-upgrade path; nothing deleted |
| Webhook bad/missing signature | 400, no state change, logged |
| Webhook duplicate event id | 200 no-op (ledger hit) |
| Webhook out-of-order (older `occurred_at`) | 200 no-op (stale guard) |
| Checkout/portal creation fails (Paddle API down) | 502 `BILLING_UNAVAILABLE`; extension: "Couldn't open checkout. Try again." |
| Payment completes but webhook delayed | AccountBar refreshes on focus/interval; pending copy until tier flips (target ≤ 1 min) |
| Renewal payment fails | Paddle dunning (retries + emails); `subscription.updated` sets `past_due` display state; tier flips only on `subscription.canceled` |
| Per-IP rate limit hit | 429 `RATE_LIMITED` with generic retry-later copy (distinct code from usage exhaustion) |
| Blocked user (admin override) | 403 `NOT_AUTHORIZED`, same contact-developer copy as 002 |

## Testing Strategy

- **Backend unit (Vitest)**: metering — first-of-month create, 409-race re-read, 412 retry loop (bounded, re-checks limit after re-read), never-wildcard assertion, fail-closed exhaustion, refund path; paddle signature verifier — valid/invalid/expired-timestamp over raw bytes; tier→deployment selection; `withAuth` — auto-create on first sign-in, existing-user read, blocked 403 (extends 002's signed-JWT suite).
- **Backend integration (Vitest + Azurite)**: **counter race** — 20 parallel analyze-path increments against a counter at limit−1: exactly 1 success, 19 × 429, final `count == limit` (SC-002); month rollover (new RK); upgrade mid-month unblocks with count preserved; webhook fixture replay — signed fixtures for all four events, duplicate delivery idempotent, out-of-order stale-guarded, tier visible on next simulated request; billing endpoints against a stubbed Paddle API; tier-aware cap — free at 100 → 409, updates/deletes still work over-cap, premium to 1,000.
- **Extension contract (Vitest + msw)**: 429-with-resetsAt renders exhausted state (not a generic error); account endpoint → plan/usage/renewal display states (free, premium-renewing, premium-ending, past-due); checkout returns URL → tab open invoked; 409 tier-aware copy.
- **Eval (SC-008)**: `evalPostings.ts` run against both deployments on the fixed posting set; premium must not regress extraction metrics and should improve fit-scoring quality; results recorded in the PR that introduces the premium deployment.
- **E2E (Playwright)**: P1 journey updated — fresh stubbed identity signs in with **no allowlist step**, analyzes, sees usage tick in AccountBar.
- **Manual before release**: real Paddle **sandbox** checkout → webhook → premium within 1 min; sandbox cancel → period-end downgrade; real Google OAuth smoke (002's standing exception).

## Rollout

1. **PR 1 (metering, shadow mode)** — `Usage` table, `meteringService`, analyze-job wiring behind `METERING_ENFORCED=false` (counts, never blocks), Azurite race tests, 429 contract implemented but dormant. Deployed while allowlist still gates — zero user impact, real usage data accrues.
2. **PR 2 (accounts)** — `usersStore`, `withAuth` swap (auto-create replaces allowlist), `models/user.ts` tier types, `migrate-allowlist.ts` run against prod (existing users' `sub`-keyed data untouched — migration is FR-025-safe by construction), CLI rework. **Signup is now open**, so this PR flips `METERING_ENFORCED=true` in the same deploy (free tier must never be uncapped in public).
3. **PR 3 (billing backend)** — `paddleClient`, `billing/` endpoints, `paddle-webhook/` + `PaddleEvents` ledger, signed-fixture tests; Paddle sandbox config in the Function App.
4. **PR 4 (premium entitlements)** — tier-aware orchestrator deployment (env pair; `gpt-4.1-mini` deployment created, TPM sized), tier-aware saved-jobs cap, eval run recorded.
5. **PR 5 (extension)** — `accountService`, `AccountBar`, `UsageExhausted`, apiClient 429 mapping, gate copy swap, tier-aware 409 prompt, msw + Playwright updates; extension release.
6. **PR 6 (compliance + launch)** — privacy policy update, terms of sale (developer, not Google, as seller; refund policy per Paddle MoR), CWS listing prominent-disclosure text, dashboard data-usage certification; switch Paddle sandbox → live; release notes.

## Risks & Mitigations

- **Paddle checkout mechanics from an MV3 extension** (overlay JS can't run in extension pages) → server-created transaction, checkout opened as a normal browser tab; `custom_data` is attached server-side from the verified token, so the mapping can't be spoofed. Verified in research R3; sandbox smoke before live.
- **Webhook delivery is the only tier-flip path** — delay/miss leaves a paid user on free → idempotency ledger + Paddle's automatic retries; AccountBar refresh on focus; support fallback: CLI `set-tier` admin override. SC-004's 99% target tolerates rare retries.
- **`subscription.canceled` timing vs paid-through** — Paddle emits cancellation at period end when "cancel at end of billing period" is used (the default), so honoring paid-through is Paddle's job; `scheduled_change` from `subscription.updated` drives the "ends on <date>" display meanwhile. Fixture tests pin this.
- **Counter contention UX** — pathological parallelism can exhaust the 412 retry budget → 503 with retry copy; acceptable for one human's tabs (research doc §5), and never under-counts.
- **Refund-on-failure gap** (FR-007) — crash between increment and refund over-counts by 1 → logged metric; bounded impact (one analysis); deliberate bias per research doc §5 (under-counting is the abuse vector).
- **Per-IP limiter is per-instance** (in-process, Functions may scale out) → treated as friction, not a guarantee; the real backstops are per-user caps + deployment TPM. Documented so nobody mistakes it for a hard control.
- **`gpt-4.1-mini` premium margin** — worst case 300 × $0.0072 ≈ $2.16/mo against $5 revenue minus Paddle's 5% + 50¢ ≈ $0.75 → ~$2 margin worst case; acceptable, monitored via usage data from PR 1's shadow period.
- **CWS review friction on the payments change** → compliance PR ships *with* the release, not after; prominent-disclosure text follows the policy checklist in the research doc §1.

## Explicitly Not Changing

- Google OIDC flow, token verification, JWKS stub seam, 401 semantics (all 002); `Profiles`/`SavedJobs` schemas and endpoints; analyze request/response contract beyond the added usage echo; canonical-URL logic; analysis cache semantics; prompt strategy and JSON schema; migration prompt (002's legacy-data flow); CI/CD workflows beyond new test scripts; release/versioning process.

## Complexity Tracking

> Constitution Check passed with two documented exceptions, justified per the Quality Gates exception process.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Live Paddle checkout/webhook not driven in CI (QG-2 adjacent) | Paddle checkout requires a browser session and a sandbox account; live webhooks need a public endpoint — flaky and secret-leaking in CI | Signature verification and all four event handlers are tested with really-signed fixtures (same HMAC over raw bytes as production, shapes from Paddle's simulator); a scripted sandbox end-to-end smoke is mandatory before each release touching billing |
| E2E does not drive real Google OAuth (carried over from 002) | Unchanged: Google blocks automated OAuth in CI | Unchanged: real-crypto JWT verification in integration tests + manual OAuth smoke before release |
