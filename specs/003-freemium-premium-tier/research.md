# Research: Freemium Product with Self-Serve Signup and Premium Tier

**Date**: 2026-07-15 · **Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Product-level groundwork (policy, payment-rail comparison, cost arithmetic, hard-stop
mechanics) was done in [docs/research/freemium-monetization.md](../../docs/research/freemium-monetization.md)
(2026-07-13, primary sources only). This file records the *feature-level decisions* built on it,
plus the technical direction given with `/speckit-plan`. No NEEDS CLARIFICATION markers remain.

---

## R1 — Accounts: `Users` row auto-created on first sign-in, replacing the allowlist gate

**Decision**: Replace the `AllowedUsers` boolean gate inside `withAuth` with a point-read of a
new `Users` table (PK `"User"`, RK lowercased email). Row absent → `createEntity`
`{ sub, tier: "free", createdAt }` and continue (signup **is** the first sign-in — zero approval
steps, FR-001/003). Row present with `blocked: true` → 403. The verified token remains the only
identity source; `AuthenticatedUser` gains `tier` so downstream code never re-reads the table.
The 002 CLI is reworked (`manage-users.ts`) into an admin override: `list`, `set-tier`, `block`,
`unblock` — local-only, no deploy, effective next request (same operational property as the
allowlist CLI).

**Rationale**: Keeps 002's entire verified-token pipeline (JWKS, `aud`/`iss`/`exp`,
`email_verified`) untouched — the only change is what the post-verification point-read means.
The uncached per-request read is what made 002 revocation immediate; reusing it makes tier
changes (upgrade *and* block) effective on the next request for free, which is exactly SC-004's
activation property. Email stays the RK because that's the lookup key available pre-read
(sub is also in the token, but 002 already normalized on email rows and the CLI operates on
emails); `sub` is stored on the row and remains the partition key for all user data —
Google documents `sub` as the stable never-reused identifier.

**Alternatives considered**: (a) Keep `AllowedUsers` and auto-add rows to it — rejected: the
table's name and shape encode "invitation", and tier/subscription state doesn't belong on an
allowlist row; a clean `Users` table with a migration script is one honest rename. (b) RK = sub
instead of email — rejected: first-contact lookup key in `withAuth` before any row exists is the
token's email/sub pair either way, but the admin CLI and support workflows operate on emails;
002 precedent wins. Email-change caveat carried over from 002's data-model (data is keyed by
`sub`, so nothing is lost; a changed Google email creates a fresh Users row — the CLI can
reconcile; documented in data-model.md). (c) Signed "entitlement" claims cached in the client —
rejected: caching is precisely what breaks next-request revocation/activation.

## R2 — Metering: per-user-per-month entity with ETag optimistic concurrency, fail closed

**Decision**: New `Usage` table, one entity per user per month: `PartitionKey = sub`,
`RowKey = "usage-" + YYYY-MM` (UTC), properties `{ count, limit }`. On analyze (and only
analyze): read entity → absent ⇒ `createEntity({count: 1, limit: limit(tier)})`, 409
`EntityAlreadyExists` ⇒ re-read and fall through; present ⇒ if `count >= limit(tier)` return
**429 with `resetsAt`** (first of next month, UTC) **before the OpenAI call**; else
`updateEntity({count: count+1}, ifMatch: etag)`, on 412 re-read → re-check limit → retry,
bounded at 4 retries, **never `If-Match: *`**; retries exhausted or store unreachable ⇒ 503
(fail closed — no unmetered spend). `limit` is recomputed from the *current* tier on every
check and the stored value refreshed when it differs, so a mid-month upgrade raises the cap
instantly with prior usage counted (FR-019) and a downgrade lowers it without touching `count`.
Composed as `withUsageMetering` wrapping the analyze handler *after* `withAuth` — auth stays a
pure authn/authz boundary.

**Rationale**: Table Storage has no server-side atomic increment (REST entity operations are
Query/Insert/Update/Merge/Delete only); the documented optimistic-concurrency contract —
`If-Match` ETag, 412 on mismatch, "retrieve the entity again and reissue" — is the correct and
sufficient exactness mechanism: two concurrent increments off the same ETag cannot both
succeed, so the cap is race-proof (SC-002). `createEntity` for first-of-month (409 → re-read)
closes the create race the same way. Missing `If-Match` is an upsert and `If-Match: *` is an
unconditional write — both silently lose updates, hence the explicit prohibitions. All sourced
in the product research §5 (Update Entity / Merge Entity REST docs, table design guide).

**FR-007 reconciliation (fail-closed vs "system failures don't consume allowance")**:
increment-before-call is the abuse-safe direction (under-counting is the exploit; the research
doc calls this out). To honor FR-007, a **best-effort refund** (conditional decrement, same ETag
loop, floor at 0) runs when the orchestrator/OpenAI call fails with a system-caused error after
the increment. A crash between increment and refund over-counts by exactly 1 — logged, bounded,
and acceptable; the alternative (increment-after) is the abuse vector.

**Alternatives considered**: (a) Increment after successful analysis — rejected: fail-open;
parallel requests all pass the pre-check. (b) Merge with `If-Match` instead of Update —
equivalent concurrency contract; Update chosen for whole-entity clarity. (c) Storing the counter
in the `Profiles` table (PK sub already exists) — workable but rejected: retention and access
patterns differ (usage rows are append-per-month, candidates for cleanup; profiles are
long-lived singletons); a dedicated `Usage` table keeps both honest. (d) Azure APIM
`token-quota` — rejected: needs a paid APIM tier (not Consumption), and it meters tokens per
key, not analyses per user (product research §3).

## R3 — Payments: Paddle Billing as merchant of record; server-created checkout

**Decision**: Paddle Billing, Paddle as **merchant of record** (they register, collect, and
remit global VAT/sales tax, issue invoices, and absorb disputes). One product, one $5/month
recurring price (`PADDLE_PREMIUM_PRICE_ID`). Checkout: the extension calls
`POST /api/billing/checkout` (behind `withAuth`); the backend creates a Paddle **transaction**
via the REST API with `custom_data: { sub, email }` taken from the **verified token** and
returns the transaction's hosted-checkout URL; the extension opens it in a normal browser tab.
Cancel / payment-method changes / invoices: Paddle's **customer portal** — the backend creates
a portal session for the stored `paddleCustomerId` and returns the URL. No billing UI in the
extension beyond plan/usage display and these two links. No new npm dependency: signature
verification is HMAC-SHA256 over the raw body via Node `crypto`, and the two Paddle API calls
are plain `fetch` (revisit `@paddle/paddle-node-sdk` at implementation if the hand-rolled client
grows past ~100 lines).

**Rationale**: The product research §2 settles processor choice: Stripe leaves the developer as
merchant of record for global VAT/GST — the one genuinely hard compliance problem for a solo
dev selling $5/month B2C worldwide — while Paddle's 5% + 50¢ all-in (≈ $0.75 on $5) is barely
above Stripe's ~10% effective all-in once Billing + Tax fees stack. Server-created checkout
solves two problems at once: (1) MV3 extension pages can't run Paddle.js overlay (remote script,
CSP), and a plain URL opened in a tab needs no injected code; (2) `custom_data` is attached
server-side from the verified token, so the Google-sub↔purchase mapping can never be spoofed or
mistyped — consistent with 002's "no user identifier ever accepted as request input" invariant.

**Alternatives considered**: (a) Stripe Payment Link + `client_reference_id` (the research doc's
worked example) — rejected on MoR grounds above, kept as the documented fallback if Paddle
onboarding fails. (b) Lemon Squeezy — same MoR economics, thinner track record, site blocked
automated verification during research; Paddle chosen. (c) Static Paddle hosted-checkout link
with client-appended custom data — rejected: client-controlled identity mapping, and hosted
payment links don't carry arbitrary custom_data reliably; the transaction-first flow is the
documented way to attach it (**verify exact endpoint/field names against Paddle's current API
reference during PR 3** — flagged, low risk). (d) Chrome Web Store payments — dead since 2020
(research §1).

## R4 — Webhook: signature verification + idempotency ledger + stale guard

**Decision**: One new HTTP function `POST /api/paddle-webhook`, **not** behind `withAuth`
(Paddle is the caller; the signature is the authentication). Verify the `Paddle-Signature`
header — parse `ts` and `h1`, compute HMAC-SHA256 over `ts + ":" + rawBody` with
`PADDLE_WEBHOOK_SECRET`, constant-time compare, reject stale `ts` (> 5 min skew) — over the
**raw request bytes**, never a re-serialized body. Idempotency: `PaddleEvents` table
(PK `"PaddleEvent"`, RK = event id) written with `createEntity` — 409 ⇒ duplicate delivery ⇒
200 no-op. Ordering: each Users-row update carries the event's `occurred_at`; an event older
than the stored `paddleEventOccurredAt` is acknowledged but ignored (stale guard). Always
return 2xx fast on handled/duplicate/stale events so Paddle doesn't retry storms; 400 only for
bad signatures; 5xx only for our own storage failures (so Paddle retries).

**Rationale**: HMAC-over-raw-body with timestamp is Paddle Billing's documented verification
scheme; the raw-bytes rule prevents the classic JSON-reserialization mismatch. Paddle retries
undelivered webhooks automatically, which is exactly why handlers must be idempotent — the
ledger makes replay a no-op and doubles as an audit trail. The `occurred_at` guard covers
out-of-order delivery (e.g., `subscription.updated` arriving after `subscription.canceled`).
This mirrors Stripe's documented "idempotent fulfillment, safe to run concurrently" guidance
from the product research, translated to Paddle.

**Alternatives considered**: (a) Natural idempotency only (upsert same state, no ledger) —
insufficient against out-of-order delivery and gives no audit trail; ledger is one point-write.
(b) Storing processed-event state on the Users row only — loses dedup across event types and
makes the stale guard murkier. (c) Polling Paddle's API on each request instead of webhooks —
rejected: adds a third-party call to the hot path and violates the ≤ 1 min activation target's
independence from our request volume.

## R5 — Subscription lifecycle → tier + display state

**Decision**: Event mapping on the Users row: `transaction.completed` / `subscription.activated`
⇒ `tier: "premium"`, store `paddleCustomerId`, `paddleSubscriptionId`, `subscriptionStatus:
"active"`, `renewsAt` (next billed date). `subscription.updated` ⇒ refresh `renewsAt`, `status`
(`active`/`past_due`/`paused`), and `endsAt` when a `scheduled_change` of type `cancel` is
present (drives "ends on <date>" display, FR-020). `subscription.canceled` ⇒ `tier: "free"`,
`status: "canceled"`, clear `renewsAt`/`endsAt`. Cancel-at-period-end is Paddle's default
cancellation mode, and Paddle emits `subscription.canceled` **when the cancellation takes
effect** — so "premium lasts through the paid period" (FR-020/021) is enforced by event timing,
not by our own clock. Failed renewals ride Paddle dunning: `past_due` is a display state only;
tier flips solely on `subscription.canceled`.

**Rationale**: Tier must have exactly one writer path (the webhook, plus the CLI override) and
one reader path (`withAuth`'s uncached point-read) — that pairing is what delivers both ≤ 1 min
activation (SC-004) and graceful paid-through downgrade (FR-021) with no scheduled jobs, no
timers, and no clock logic of our own. Renewal-state display (FR-013, spec US3.4) needs only
the four fields above; everything richer (invoices, payment method) lives in Paddle's portal by
design (no billing UI in-extension).

**Alternatives considered**: (a) Computing paid-through ourselves and downgrading via a timer
function — rejected: duplicates Paddle's billing clock, adds the repo's first timer trigger,
and drifts from refunds/disputes that Paddle already resolves. (b) Immediate downgrade on
cancel request — violates FR-020. (c) Trusting `transaction.completed` alone —
`subscription.activated` is the authoritative "subscription is live" signal; handling both
idempotently makes activation robust to either arriving first (fixture test pins this).

## R6 — Premium model: `gpt-4.1-mini` via env-var pair

**Decision**: Orchestrator selects the deployment by tier: free ⇒
`AZURE_OPENAI_JOB_DEPLOYMENT` (existing, `gpt-4o-mini`); premium ⇒
`AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` (new deployment, `gpt-4.1-mini`), falling back to the
free deployment when unset (safe default in every environment). The existing `model` field on
saved analyses already records which deployment produced a result — no schema change for
SC-008 evidence. Premium-quality validation: run `functions/scripts/evalPostings.ts` against
both deployments on the fixed posting set before PR 4 merges; premium must not regress
extraction and should improve fit scoring (spec SC-008's eval-harness bar).

**Rationale**: Product research §4b prices the options: `gpt-4.1-mini` at $0.40/$1.60 per 1M is
2.7× mini — worst case $0.0072/analysis, so a maxed premium user costs ≈ $2.16/month against $5
revenue (≈ $0.75 Paddle fees) → ~$2 worst-case margin. `gpt-4.1` (13×) is underwater at $5/300
(≈ $10.80); reasoning models add hidden output tokens and latency risk against the 30 s
constitution ceiling. The deployment name was already env-driven
(`jobExtractionOrchestrator.ts:203-206`), making this a threading change, not a rework. Free
tier keeps `gpt-4o-mini`: 50 × $0.0027 = $0.135 worst case — under SC-005's 15¢.

**Alternatives considered**: `gpt-4.1-nano` for free (0.7× cost) — deferred: changing the free
model mid-launch confounds the premium comparison; revisit as a cost lever. `gpt-4.1`/`o4-mini`
for premium — margin/latency rejected above. Prompt-only differentiation (same model) —
rejected: "noticeably better" (SC-008) needs headroom, and the price gap funds it.

## R7 — Tier-aware saved-jobs cap; over-cap = read-only for additions

**Decision**: Replace the single `SAVED_JOBS_SOFT_CAP` with per-tier caps: free **100**, premium
**1,000** (existing value). The cap check in `savedJobsRepository.saveJob` already applies only
when the save would create a **new** row (`!existing && count >= cap`) — precisely the spec's
downgrade semantics (FR-022): a 400-job library on a free account keeps view/search/update/
delete/export working, blocks only new saves (409 `LIBRARY_FULL`), un-blocks when pruned to
≤ 100 or on re-upgrade. No data migration, no truncation, no new state field — downgrade is
data-touchless. Extension: 409 copy becomes tier-aware (free: upgrade or remove; premium:
existing prune/export flow), plus a passive read-only banner on the saved list when
`count > cap`.

**Rationale**: The research doc's premium-lever table called this "near-config", and reading
the actual repo confirmed it: the semantics the spec demands are the semantics already
implemented — only the constant becomes a function of tier. Choosing interpretation over
migration honors FR-021's "no data loss" by construction.

**Alternatives considered**: (a) Hard-block over-cap libraries entirely — violates FR-010/022.
(b) An explicit `readOnly` flag set on downgrade — rejected: derived state that can drift from
the truth (`count > cap` is the truth). (c) Auto-archiving over-cap jobs — violates "never
truncated".

## R8 — Spend guardrails: TPM backstop + per-IP friction; budgets are alerts only

**Decision**: Three layers, mirroring the product research §3/§6: (1) **per-user monthly caps**
(R2) — the fairness layer; (2) **per-IP fixed-window rate limiter**, in-process at the Functions
layer keyed on `x-forwarded-for`, applied to analyze and billing routes, returning 429
`RATE_LIMITED` (distinct from usage exhaustion) — explicitly documented as *friction, not a
guarantee* (per-instance memory; Functions can scale out); (3) the **deployment TPM quota**
(~30K TPM, dynamic quota **off**) as the hard backstop — even a metering bug or account-farming
attack cannot push spend past ≈ $311/month (24×7 saturation arithmetic, research §4). Azure
budgets remain configured as **alerts only** — Microsoft Learn states verbatim that budget
thresholds never stop consumption, and cost data lags 8–24 h.

**Rationale**: Each layer covers a different axis (per-account, per-source, global) and each is
already priced: layers 1–2 are code in this feature, layer 3 is existing configuration. The
"budgets never stop spend" note is load-bearing: it prevents anyone from ever mistaking an alert
for a control.

**Alternatives considered**: APIM `llm-token-limit`/`token-quota` — the only Azure-native
fixed-window quota, but requires a paid non-Consumption APIM tier in front of one Function App;
overkill now, noted as the upgrade path if the per-IP axis ever needs to be a real guarantee.
Distributed rate limiting via a Table/blob counter — adds hot-path I/O for an axis the TPM
backstop already bounds; rejected.

## R9 — Chrome Web Store compliance ships with the release

**Decision**: PR 6 (release-blocking, not post-launch): (1) **privacy policy** updated for
account data (Google identity claims), usage counters, and payment status, linked in the
Developer Dashboard; (2) **prominent disclosure** + affirmative consent covering the new
account/payment data practices — required because adding payments post-launch is exactly the
"change in data practices" the Disclosure Requirements policy names; (3) **terms of sale**
identifying the developer (not Google) as the seller — with Paddle as MoR, the checkout and
invoices also name Paddle as reseller; refund policy defers to Paddle's; (4) listing copy states
plainly what's free vs paid (deceptive-installation policy); (5) dashboard data-usage
certification (Limited Use) re-submitted. Card data never touches our servers (Paddle-hosted
checkout satisfies the secure-handling clause).

**Rationale**: All five items trace to specific policies quoted with URLs in the product
research §1 — external-payment monetization is explicitly permitted *given* these disclosures,
and the same research flags that review friction lands on whoever ships payments without them.
Bundling compliance into the launch PR makes it a gate, not a follow-up.

**Alternatives considered**: none material — these are obligations, not choices. The only
freedom exercised: MoR (R3) moves tax/invoice/dispute text into Paddle's standard terms,
shrinking what we must author.

## R10 — Migration of existing allowlisted users: fold, don't move

**Decision**: One-time idempotent script (`migrate-allowlist.ts`, local like the CLI): for each
`AllowedUsers` row, `createEntity` a `Users` row (RK = same lowercased email,
`tier: "free"`, carrying over recorded `sub` and `addedAt`; 409 ⇒ already migrated, skip).
User data needs **no** migration: `Profiles`/`SavedJobs` are keyed by `sub`, which is unchanged.
Allowlisted users who never had a recorded `sub` (added but never signed in) migrate without
one; `withAuth`'s existing first-sign-in merge records it later — same lazy behavior as 002,
satisfying FR-027 (migration applies whenever they eventually sign in; auto-create covers even
a missed row). After verification, `AllowedUsers` is retired (table deleted in a cleanup pass;
`allowedUsersStore.ts` removed per the no-dead-code principle).

**Rationale**: Because 002 deliberately keyed all user data by `sub` and treated the allowlist
as a pure gate, "migration" is only re-homing gate rows — zero interruption (FR-025) by
construction: at every instant a request either finds a Users row (migrated) or triggers
auto-create (the new normal). Existing over-cap libraries (>100 jobs) need no handling beyond
R7's read-only semantics (FR-026 = FR-022).

**Alternatives considered**: (a) Lazy-only migration (skip the script, rely on auto-create) —
loses `addedAt` provenance and any never-signed-in invitee's standing; script is ~40 lines.
(b) Granting migrated users premium as a courtesy — product decision explicitly defaulted to
free in the spec's Assumptions; the CLI `set-tier` override exists for case-by-case grace.

---

## Resolved-unknowns summary

| Unknown | Resolution |
|---|---|
| Where the usage entity lives | New `Usage` table, PK `sub`, RK `usage-YYYY-MM` (R2) |
| Exactness under parallel requests | ETag `ifMatch` conditional writes + bounded 412 retries; create-race via 409 (R2) |
| FR-007 vs fail-closed increment | Increment before call + best-effort refund on system failure (R2) |
| Checkout from an MV3 extension | Server-created Paddle transaction, URL opened in a tab; `custom_data` from verified token (R3) |
| Webhook trust + replay + ordering | Raw-body HMAC (`ts`+`h1`), `PaddleEvents` ledger, `occurred_at` stale guard (R4) |
| Paid-through on cancel | Paddle emits `subscription.canceled` at period end; `scheduled_change` drives "ends on" display (R5) |
| Premium model | `gpt-4.1-mini` via `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM`, eval-gated (R6) |
| Over-cap downgrade semantics | Existing new-row-only cap check = read-only-for-additions; caps become per-tier (R7) |
| Hard spend stop | Deployment TPM ~30K, dynamic quota off (≈$311/mo ceiling); budgets are alerts only (R8) |
| Store-policy exposure | Five-item compliance set in the launch PR (R9) |
| Allowlist migration | Idempotent fold script + lazy auto-create; data already `sub`-keyed (R10) |

**Verify-at-implementation flags** (low risk, non-blocking): exact Paddle REST field names for
transaction-create with `custom_data` and portal-session-create (R3); current
`Paddle-Signature` header format details (R4); both confirmed against Paddle's API reference
during PR 3, with fixture shapes taken from Paddle's webhook simulator.
