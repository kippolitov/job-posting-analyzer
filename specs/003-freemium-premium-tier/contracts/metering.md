# Contract: Usage Metering

**Scope**: the analyze path's quota behavior — what the extension can rely on. Entity shapes:
[data-model.md](../data-model.md) (`Usage`). Decisions: research.md R2.

## Where metering applies

Only `POST /api/analyze-job`. Profile, jobs, account, and billing endpoints are never metered.
Composition: `withAuth(withUsageMetering(handler))` — 401/403 fire before any counter touch;
429 fires before any OpenAI call.

## Check-and-increment algorithm (normative)

For verified user `{sub, tier}` and UTC month key `usage-YYYY-MM`:

1. `limit ← MONTHLY_ANALYSES[tier]` — always recomputed from the current tier (mid-month
   upgrades unblock immediately, FR-019); the stored `limit` property is refreshed when it
   differs but is never the enforcement input.
2. Read entity `(sub, usage-YYYY-MM)`.
   - **404** → `createEntity({count: 1, limit})`. Success ⇒ **proceed**. `409
     EntityAlreadyExists` (create race) ⇒ re-read, continue at step 3.
3. If `count >= limit` → **429** (below). No write, no OpenAI call.
4. Else `updateEntity({count: count + 1, limit}, { etag: <read etag> })` — `Replace` mode,
   real ETag. **Never `If-Match: *`; never omit `ifMatch`** (an unconditional/upsert write
   loses concurrent updates and breaks SC-002).
   - Success ⇒ **proceed** to the handler (OpenAI call).
   - **412 Precondition Failed** ⇒ re-read → back to step 3. Bounded: at most **4** retries.
5. Retries exhausted, or any storage error → **503 fail closed** (no unmetered spend).

**Refund on system failure (FR-007)**: if the wrapped handler fails with a system-caused error
(orchestrator throw, OpenAI 5xx/timeout, schema-repair exhaustion), best-effort conditional
decrement (same ETag loop, floor at 0, max 2 attempts). User-caused 4xx outcomes and delivered
analyses are never refunded. A crash between increment and refund over-counts by 1 — accepted,
logged as `metering.refund_lost`.

**Race guarantee (SC-002)**: two writes off the same ETag cannot both succeed; with N parallel
requests and one slot left, exactly one increment lands — the rest observe 412 → re-read →
`count >= limit` → 429.

## Responses

### 429 — allowance exhausted (the FR-009 state; never a silent failure)

```json
{
  "error": {
    "code": "USAGE_LIMIT_REACHED",
    "message": "You've used all 50 free analyses this month. Your allowance resets on August 1."
  },
  "usage": { "count": 50, "limit": 50, "resetsAt": "2026-08-01T00:00:00Z", "tier": "free" }
}
```

- `resetsAt` = first instant of the next UTC month (FR-008); the message names the same date.
- `message` uses the actual `limit`/tier ("all 300 premium analyses…" for premium).
- Client contract: render the exhausted card — message, reset date, **Upgrade** action (free
  tier only) — never the generic error banner. Saved jobs / profile / history requests are
  unaffected (FR-010).
- Distinct from `RATE_LIMITED` (per-IP limiter, also 429): clients branch on `error.code`,
  never on status alone. Limiter defaults: 30 analyze req/min/IP, 10 billing req/min/IP
  (env-tunable `RATE_LIMIT_ANALYZE_PER_MIN` / `RATE_LIMIT_BILLING_PER_MIN`); per-instance
  friction, not a guarantee (research R8).

### Success — usage echo

Analyze-job 200 responses gain a `usage` object (same shape as above, post-increment), so the
AccountBar updates without an extra round-trip. Additive; existing response fields unchanged.

### 503 — metering unavailable

Standard `SERVICE_ERROR` shape (002 convention): "Couldn't verify your usage allowance. Please
try again." Standard retry banner client-side.

## Test hooks (Testing Strategy in plan.md)

- Azurite race test: seed `(sub, month)` at `limit − 1`, fire 20 parallel requests through the
  real wrapper: exactly 1 × 200, 19 × 429 `USAGE_LIMIT_REACHED`, final stored `count == limit`.
- Month rollover: new RK; no reset write exists to test.
- Upgrade mid-month: flip tier on the Users row; next request passes with `count` preserved.
- msw fixtures for the extension mirror the 429 and usage-echo shapes verbatim.
