# Contract: Paddle Webhook Handler

**Endpoint**: `POST /api/paddle-webhook` — called by Paddle only. **Not** behind `withAuth`
(no Bearer token; the HMAC signature is the authentication) and **not** behind the function
key (configured with anonymous auth level; the URL is not a secret boundary, the signature
is). Decisions: research.md R4/R5.

## Signature verification (before any parsing)

1. Read the **raw request bytes** (never re-serialize JSON to verify).
2. Parse `Paddle-Signature` header: `ts=<unix>;h1=<hex>`.
3. Reject if `|now − ts| > 300 s` → 400 (replay window).
4. `expected = HMAC-SHA256(PADDLE_WEBHOOK_SECRET, ts + ":" + rawBody)`; constant-time compare
   with `h1`; mismatch/absent header → **400**, no state change, warn-logged.

(Exact header format re-verified against Paddle's current docs in PR 3 — research flag.)

## Processing pipeline

1. Parse body: `{ event_id, event_type, occurred_at, data }`.
2. **Idempotency**: `createEntity` into `PaddleEvents` (RK = `event_id`); 409 ⇒ duplicate
   delivery ⇒ **200** `{"received": true}`, no side effects.
3. **Resolve the user**: `data.custom_data.sub` / `.email` (attached server-side at checkout,
   billing-api.md) → Users row by email; fallback: match `data.customer_id` against stored
   `paddleCustomerId`. Unresolvable ⇒ **200** + error-logged (`paddle.orphan_event`) — never
   5xx (Paddle would retry forever); the admin CLI reconciles.
4. **Stale guard**: if the row's `paddleEventOccurredAt` ≥ this `occurred_at` ⇒ **200** no-op.
5. Apply the event (below) via a single Merge update that also sets `paddleEventOccurredAt`.
6. Storage failure anywhere after signature check ⇒ **500** (Paddle retries; step 2's ledger
   write happens in the same attempt, so a failed attempt leaves no ledger row — retry
   reprocesses cleanly).

## Event handling (the only writers of `tier` besides the admin CLI)

| Event | Users-row effect |
|---|---|
| `transaction.completed` | `tier: "premium"`; store `paddleCustomerId`; (subscription fields when present on the transaction) |
| `subscription.activated` | `tier: "premium"`; store `paddleCustomerId`, `paddleSubscriptionId`, `subscriptionStatus: "active"`, `renewsAt = next_billed_at`, clear `endsAt` |
| `subscription.updated` | refresh `subscriptionStatus` (`active`/`past_due`/`paused`), `renewsAt`; `scheduled_change.action == "cancel"` ⇒ `endsAt = scheduled_change.effective_at` (drives "Premium until …"); scheduled change removed ⇒ clear `endsAt`. **Never flips tier.** |
| `subscription.canceled` | `tier: "free"`, `subscriptionStatus: "canceled"`, clear `renewsAt`/`endsAt`. Paddle emits this **when the cancellation takes effect** (default: period end) — paid-through is honored by event timing (FR-020/021); no clock logic of ours. |

Either of the two activation events may arrive first; both set the same premium state
(idempotent by construction). Effects are visible on the user's **next request** — the
withAuth Users read is uncached (SC-004 ≤ 1 min, dominated by Paddle delivery latency).

Downgrade is data-touchless: flipping `tier` alone yields the read-only over-cap library and
the 50-cap via the tier-derived checks (FR-021/022; research R7). Refund/chargeback resolves
through the same `subscription.canceled` path.

## Response summary

| Case | Status |
|---|---|
| Handled / duplicate / stale / orphan | 200 (stop Paddle retries) |
| Bad or missing signature, stale `ts`, unparseable body | 400 |
| Our storage failure | 500 (invite retry) |

## Fixtures & tests (Testing Strategy in plan.md)

Fixture set (shapes captured from **Paddle's webhook simulator**, sandbox): all four events +
one unknown event type (acknowledged 200, ignored). Each stored as raw body + a signature
computed with the test secret — verification in tests runs the production code path over real
bytes. Scenarios: happy path per event; duplicate `event_id` (single ledger row, single state
write); out-of-order (`canceled` then late `updated` — tier stays `free`); orphan custom_data;
bad signature; tier visible to a subsequent simulated authed request (Azurite).
