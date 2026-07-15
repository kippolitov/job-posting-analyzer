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
- Azure OpenAI deployments (done 2026-07-15, `job-posting-analyzer-openai`/eastus2): free
  `gpt-4o-mini` resized from 250K→20K TPM; premium deployment created at 10K TPM using
  **`gpt-5.4-nano`**, not the spec's original `gpt-4.1-mini` pick — Azure now refuses new
  deployments of the entire gpt-4.1/gpt-4o/o4-mini family (`ServiceModelDeprecating`; inference
  cutoff ~Oct 2026 across that whole generation, `gpt-4o-mini` included). gpt-5.4-nano:
  $0.20/$1.25 per 1M in/out, worst-case 300 analyses/mo ≈ $1.28, margin ≈ $2.97/mo after Paddle's
  cut (healthier than the original gpt-4.1-mini plan). **Re-run T028's SC-008 eval against
  gpt-5.4-nano before shipping premium** — the existing eval only validated gpt-4.1-mini, which
  can no longer be deployed. Dynamic quota confirmed off (default; never opted in) on both.
  Combined worst-case ceiling ≈ $483/mo (20K× gpt-4o-mini blend + 10K× gpt-5.4-nano blend).
  Budget alert `job-posting-analyzer-monthly`: $50/mo, 80%/100% email thresholds to
  kippolitov@gmail.com (alerts only — they never stop spend, confirmed via Microsoft Learn).
  **Follow-up needed ~Sept 2026**: `gpt-4o-mini` (free) hits its inference cutoff 2026-10-01 —
  plan a model migration for the free deployment well before then.
