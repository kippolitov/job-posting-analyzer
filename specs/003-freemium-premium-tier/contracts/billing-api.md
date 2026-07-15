# Contract: Account & Billing API

**Scope**: the three new authenticated endpoints the extension consumes. All behind `withAuth`
(Bearer Google ID token + `x-functions-key`, 002's auth contract unchanged) with the standard
CORS/OPTIONS twin. Per-IP rate limiter applies. Decisions: research.md R1/R3/R5.

## GET `/api/account`

The single source for the AccountBar (plan, usage, renewal — FR-013). Fetched on panel open /
focus and after checkout returns; also refreshed from the `usage` echo on analyze responses.

**200**

```json
{
  "email": "user@example.com",
  "tier": "premium",
  "usage": { "count": 137, "limit": 300, "resetsAt": "2026-08-01T00:00:00Z" },
  "subscription": {
    "status": "active",
    "renewsAt": "2026-08-03T00:00:00Z",
    "endsAt": null
  }
}
```

- `usage` reflects the current month's entity (`count: 0` with the tier limit when no entity
  exists yet); `limit` recomputed from tier, same rule as metering.
- `subscription` is `null` for free-tier users who never subscribed.
- Display mapping (stable vocabulary, Principle III): `active` + `renewsAt` → "Renews on …";
  `endsAt` set → "Premium until …"; `past_due` → "Payment problem — update your payment
  method" (+ portal link); free → "Free plan".

**Errors**: 401/403 per 002 auth contract; 500 `SERVICE_ERROR`.

## POST `/api/billing/checkout`

Creates a Paddle transaction for `PADDLE_PREMIUM_PRICE_ID` with
`custom_data: { sub, email }` **taken from the verified token** (never from the request body —
the client sends no body) and returns the hosted checkout URL. The extension opens it in a new
browser tab; activation then arrives via webhook (≤ 1 min, SC-004).

**200**

```json
{ "checkoutUrl": "https://…paddle…/…", "transactionId": "txn_01h…" }
```

**Errors**

| Status | Code | When |
|---|---|---|
| 409 | `ALREADY_PREMIUM` | Users row already `tier: "premium"` — client shows "You're already on Premium" |
| 502 | `BILLING_UNAVAILABLE` | Paddle API unreachable/5xx — "Couldn't open checkout. Try again." |

## POST `/api/billing/portal`

Creates a Paddle customer-portal session for the stored `paddleCustomerId` and returns its URL
(cancel, payment methods, invoices — FR-020; no in-extension billing UI by design).

**200**

```json
{ "portalUrl": "https://customer-portal.paddle.com/…" }
```

**Errors**

| Status | Code | When |
|---|---|---|
| 404 | `NO_SUBSCRIPTION` | No `paddleCustomerId` on the Users row — client hides/disables "Manage subscription" |
| 502 | `BILLING_UNAVAILABLE` | as above |

## Client obligations (msw contract tests mirror these)

- Loading states on both POST calls (>300 ms feedback contract).
- After the checkout tab is opened, poll `GET /api/account` on panel focus (and a short
  interval ≤ 60 s while a checkout is pending) until `tier` flips; show a "finishing your
  upgrade…" pending state, never an error, within the first minute.
- Free + exhausted usage → the Upgrade action routes through `/api/billing/checkout`.
- Never construct Paddle URLs client-side; the backend is the only URL source.
