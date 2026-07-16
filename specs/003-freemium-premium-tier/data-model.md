# Data Model: Freemium Product with Self-Serve Signup and Premium Tier

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Decisions**: [research.md](./research.md)

All storage is Azure Table Storage in the existing storage account (002 convention). Tables
`Profiles` and `SavedJobs` are **unchanged**; `AllowedUsers` is **retired** (R10). Partition
keys for user data always derive from the verified token's `sub` — never from request input.

## Tables

### `Users` — NEW (replaces `AllowedUsers` as the withAuth point-read; R1)

One row per account. Read (uncached) on every authenticated request; auto-created on first
sign-in.

| Property | Type | Notes |
|---|---|---|
| `partitionKey` | `"User"` | fixed |
| `rowKey` | string | lowercased email (`normalizeEmail`, 002 convention) |
| `sub` | string | Google stable id; partition key of all user data; recorded at creation (auto-create path) or first sign-in (migrated never-signed-in rows) |
| `tier` | `"free"` \| `"premium"` | entitlement source of truth; written only by the Paddle webhook and the admin CLI |
| `blocked` | boolean? | admin override (CLI); `true` ⇒ 403 in withAuth |
| `createdAt` | string (ISO) | auto-create or migration time |
| `migratedFromAllowlist` | boolean? | provenance; carries the old row's `addedAt` semantics |
| `paddleCustomerId` | string? | set by first webhook event carrying it; key for portal sessions |
| `paddleSubscriptionId` | string? | current subscription |
| `subscriptionStatus` | `"active"` \| `"past_due"` \| `"paused"` \| `"canceled"`? | display state only — never gates anything; `tier` gates |
| `renewsAt` | string (ISO)? | next billed date (display: "renews on …") |
| `endsAt` | string (ISO)? | set when a scheduled cancel exists (display: "ends on …") |
| `paddleEventOccurredAt` | string (ISO)? | stale guard: events with older `occurred_at` are ignored (R4) |

**Validation**: `tier` defaults `"free"`; unknown tier values are rejected at the codec.
**Email-change caveat** (carried from 002): a changed Google email produces a fresh Users row
(new signup, free tier) while the user's data stays under their unchanged `sub`; the old row's
subscription state is reattached by the admin CLI if it ever happens. Documented, not automated.

**State transitions (`tier` — the only entitlement state machine)**

```
            transaction.completed / subscription.activated (webhook)
            or CLI set-tier premium
  free ────────────────────────────────────────────────────────► premium
   ▲                                                                │
   └──────────────── subscription.canceled (webhook, fires at ──────┘
                     period end) or CLI set-tier free
```

Effective on the user's **next request** — the withAuth read is uncached (SC-004; 002's
revocation property). `blocked: true` is orthogonal and reversible (CLI only).

### `Usage` — NEW (per-user monthly meter; R2)

One entity per user per month, created lazily on the first analysis of the month.

| Property | Type | Notes |
|---|---|---|
| `partitionKey` | string | `sub` (verified token) |
| `rowKey` | string | `"usage-" + YYYY-MM` (UTC month) |
| `count` | number (Int32) | successful-analysis count; increments **before** the OpenAI call |
| `limit` | number (Int32) | snapshot of the tier limit at last check; **display only** — enforcement always recomputes `limit(tier)` from the Users row already read by withAuth |

**Concurrency contract** (the SC-002 mechanism — see [contracts/metering.md](./contracts/metering.md)):
first-of-month `createEntity` (409 `EntityAlreadyExists` ⇒ re-read); increments via
`updateEntity(..., { etag })` (never `If-Match: *`, never a missing `If-Match` — that's an
upsert); 412 ⇒ re-read, re-check `count >= limit(tier)`, retry, bounded at 4; exhausted ⇒ 503
fail closed. Refund path: conditional decrement, floor 0, best-effort (FR-007).

**Reset semantics**: no reset write ever happens — a new month is simply a new RowKey
(FR-008); `resetsAt` in responses = first instant of the next UTC month. Old months remain as
a usage audit trail (retention: keep; single-digit rows/user/year).

**Tier interplay**: upgrade mid-month ⇒ next check recomputes `limit = 300`, prior `count`
stands (FR-019); downgrade ⇒ `limit = 50`, `count` untouched (may exceed it — user is simply
capped until rollover).

### `PaddleEvents` — NEW (webhook idempotency ledger; R4)

| Property | Type | Notes |
|---|---|---|
| `partitionKey` | `"PaddleEvent"` | fixed |
| `rowKey` | string | Paddle event id (`evt_…`) |
| `eventType` | string | e.g. `subscription.activated` |
| `occurredAt` | string (ISO) | from the payload |
| `processedAt` | string (ISO) | server time |
| `sub` | string? | resolved user, for audit |

Written with `createEntity`; 409 ⇒ duplicate delivery ⇒ acknowledge (200) without side
effects. Append-only audit trail; no updates ever.

### `AllowedUsers` — RETIRED (R10)

`migrate-allowlist.ts` folds each row into `Users` (idempotent: `createEntity`, 409 ⇒ skip),
preserving recorded `sub` and marking `migratedFromAllowlist`. `Profiles`/`SavedJobs` need no
migration — they are keyed by `sub`, which does not change (FR-025 zero-interruption by
construction). Table + `allowedUsersStore.ts` deleted in the cleanup pass after verification.

## Derived / in-memory model

**`AuthenticatedUser`** (extends 002): `{ sub, email, tier }` — tier attached by withAuth from
the Users row so handlers never re-read it.

**Per-tier entitlements** (constants in `models/user.ts`; the *only* place limits live):

| | `free` | `premium` |
|---|---|---|
| Monthly analyses (`MONTHLY_ANALYSES`) | 50 | 300 |
| Saved-jobs cap (`SAVED_JOBS_CAP`) | 100 | 1,000 (existing `SAVED_JOBS_SOFT_CAP` value) |
| Analysis deployment | `AZURE_OPENAI_JOB_DEPLOYMENT` | `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` (falls back to free deployment when unset) |

**Saved-jobs over-cap rule** (R7, FR-022): the cap check fires only when a save would create a
**new** row; `count > cap` therefore means read-only-for-additions — update/delete/view/export
unaffected. No stored flag; derived from `count` vs `cap` at check time.

**Rate-limiter state** (R8): in-process `Map<ip, {windowStart, count}>` — per-instance,
best-effort, no persistence; deliberately not a table.

## Cross-artifact references

- Wire contracts for `Usage`-derived responses (429 shape, `usage` echo, account view):
  [contracts/metering.md](./contracts/metering.md), [contracts/billing-api.md](./contracts/billing-api.md)
- Webhook payload handling and Users-row writes: [contracts/paddle-webhook.md](./contracts/paddle-webhook.md)
- 002 base model (Profiles, SavedJobs, auth entities):
  [../002-account-persistent-storage/data-model.md](../002-account-persistent-storage/data-model.md)
