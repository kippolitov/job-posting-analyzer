# Quickstart: Freemium Product with Self-Serve Signup and Premium Tier

Validation guide — proves the feature end-to-end in a dev environment. Shapes and semantics
live in [data-model.md](./data-model.md) and [contracts/](./contracts/); this file doesn't
duplicate them.

## Prerequisites

- 002's dev setup working (Node 20, `func` CLI, Azurite, Google OAuth client for dev).
- **Paddle sandbox account** (sandbox.paddle.com): one product + one $5/month recurring price;
  a webhook endpoint secret. Free; no real money moves.
- New Function App settings (local: `functions/local.settings.json`):

| Setting | Dev value |
|---|---|
| `PADDLE_API_BASE_URL` | `https://sandbox-api.paddle.com` |
| `PADDLE_API_KEY` | sandbox API key |
| `PADDLE_WEBHOOK_SECRET` | sandbox endpoint secret |
| `PADDLE_PREMIUM_PRICE_ID` | sandbox price id (`pri_…`) |
| `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` | premium deployment name (omit ⇒ falls back to free deployment) |
| `METERING_ENFORCED` | `true` locally (prod flips true in PR 2 — plan.md Rollout) |
| `REQUIRE_AUTH` | `true` to exercise the real gate (002 semantics unchanged) |

## Automated validation

```bash
# Backend — unit (metering algorithm, signature verifier, tier selection, withAuth auto-create)
cd functions && npm test

# Backend — integration (Azurite must be running: npm run azurite &)
npm run test:integration
#   key suites: usage counter RACE (20 parallel, exactly 1 success at limit−1 — SC-002),
#   month rollover, mid-month upgrade, webhook fixture replay (dup/out-of-order/orphan),
#   billing endpoints (stubbed Paddle), tier-aware caps (409 at 100 free / 1,000 premium)

# Extension — contract tests (msw: 429-with-resetsAt, account states, checkout flow, 409 copy)
cd ../extension && npm test

# E2E (P1 journey: fresh identity → sign-in with no allowlist → analyze → usage ticks)
npm run build:e2e && npm run test:e2e

# Premium-quality eval (SC-008) — run against both deployments, compare reports
cd ../functions && npm run eval:postings   # once per deployment; see script flags
```

All suites green + eval shows no extraction regression and improved fit scoring ⇒ automated
acceptance met.

## Manual walkthrough (maps to spec user stories)

**US1 — self-serve signup** (SC-001): load the dev extension with a Google account that has
never been used → sign in → no invitation screen → analyze a job page → AccountBar shows
"Free plan · 1 of 50 analyses". Time it: install → first result < 2 min. Verify a `Users` row
appeared (Azurite: PK `User`, RK = email, `tier: free`).

**US2 — exhaustion**: seed the month's `Usage` entity to `count: 49` (Azurite storage
explorer or a one-line script) → analyze (succeeds, 50/50) → analyze again → the exhausted
card: "used all 50", concrete reset date, Upgrade button — not a generic error. Saved jobs /
profile / history still load (FR-010).

**US3 — upgrade** (SC-004): click Upgrade → checkout tab opens (sandbox) → pay with Paddle's
test card → within 1 min the AccountBar flips to "Premium · … of 300" without reinstalling;
the previously exhausted account analyzes again immediately (FR-019). Verify the analysis
`model` field names the premium deployment.

**US4 — cancel & downgrade**: portal link → cancel in Paddle's portal → AccountBar shows
"Premium until <date>". Then simulate period end: fire the `subscription.canceled` fixture at
the local webhook (or Paddle simulator) → account is Free; with > 100 saved jobs the library
shows the read-only banner, saves 409, deletes still work; delete to ≤ 100 ⇒ saves work
(FR-021..023).

**US5 — migration**: with legacy `AllowedUsers` rows present, run
`npm run migrate-allowlist` (dry-run flag first) → rows folded into `Users`
(`migratedFromAllowlist: true`), re-run is a no-op (idempotent), migrated user signs in and
sees all prior data (their `sub`-keyed Profiles/SavedJobs were never touched).

**Webhook security spot-checks**: POST a fixture with a tampered byte → 400, no state change;
replay the same fixture twice → single `PaddleEvents` row, single state write.

## Release gates (before flipping Paddle live — plan.md PR 6)

- Sandbox end-to-end smoke: real checkout → webhook → premium ≤ 1 min; cancel → period-end
  downgrade (the two Complexity Tracking exceptions require this manual pass).
- Real Google OAuth smoke (002's standing gate).
- Compliance set live: privacy policy URL updated in the CWS dashboard, prominent-disclosure
  consent in the extension, terms of sale naming the developer as seller, listing copy states
  free vs paid, Limited Use certification re-submitted (research.md R9).
- Azure OpenAI deployments: premium deployment TPM sized, **dynamic quota off** on both;
  budget alerts configured (alerts only — they never stop spend).
