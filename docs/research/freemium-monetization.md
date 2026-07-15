# Freemium monetization for the Job Posting Analyzer extension

**Date:** 2026-07-13
**Location note:** the repo keeps *feature* research inside `specs/NNN/research.md`; this is *product-level* research (spans policy, payments, cost, and architecture rather than one feature), so it lives in `docs/research/` instead.
**Scope:** primary sources only — Chrome Web Store program policies (developer.chrome.com), Microsoft Learn, the Azure Retail Prices API, Stripe/Paddle/Lemon Squeezy official docs, Google Identity docs. Every claim carries the URL that owns it. Repo facts (input cap, model config, saved-jobs cap) were read from this repo's source.

---

## TL;DR

1. **Selling a premium tier via Stripe (or any external processor) is allowed.** Chrome Web Store Payments is dead (new paid items disabled Sep 21, 2020); the current program policy explicitly regulates — not forbids — developers "accepting payment from users", requiring transparent terms, clear "you, not Google, are the seller", and secure card handling. Adding sign-in + payments makes the privacy-policy, Limited Use, and prominent-disclosure policies binding.
2. **Payment rails:** Stripe Payment Link (supports subscriptions, `client_reference_id` in the URL) → `checkout.session.completed` webhook to an Azure Function → mark the Google `sub` premium in Table Storage → no-code Stripe customer portal for cancel/update. Stripe: 2.9% + 30¢ (US cards) + 0.7% Billing (pay-as-you-go) + Stripe Tax 0.5%/txn — but Stripe leaves *you* as merchant of record for global VAT/sales-tax. Paddle and Lemon Squeezy are MoR at 5% + 50¢ all-in; for a tiny global B2C SaaS the MoR route removes the tax-registration problem entirely.
3. **Azure budgets never stop spend** — Microsoft Learn says so verbatim. Real hard stops: (a) the Azure OpenAI deployment TPM/RPM quota (set TPM low; excess requests get 429), (b) APIM `llm-token-limit` policy (TPM → 429, and a fixed-window `token-quota` per hour/day/month → 403), (c) app-level metering (question 5). A 30K-TPM `gpt-4o-mini` deployment mathematically caps worst-case spend at ≈ **$311/month** even under 24×7 saturation.
4. **Cost per analysis is tiny.** Azure Retail Prices API (queried 2026-07-13): gpt-4o-mini Global = $0.15/1M input, $0.60/1M output. Worst case (40,000-char capped input ≈ 10K tokens + overhead, 1,500 output tokens) ≈ **$0.0027/analysis**; 20 analyses/user/month ≈ **5.4¢/user/month**. 5,000 free users ≈ $270/month worst case, ~$150 typical.
5. **Metering:** an entity per user per month (`PartitionKey = sub`, `RowKey = usage-YYYY-MM`), read → check < limit → `updateEntity` with `If-Match: <etag>` → on 412 re-read and retry. Table Storage documents exactly this optimistic-concurrency contract; there is no server-side atomic increment, so the ETag retry loop is the correct pattern.
6. **Abuse surface:** Google ID tokens give a stable, never-reused `sub` and an `email_verified` claim; require `email_verified === true`, key everything on `sub`, keep the no-anonymous-access rule, and add a per-IP rate limit as a second axis.
7. **Premium levers already in the architecture:** higher analysis cap (config once metering exists), bigger saved-jobs library (`SAVED_JOBS_SOFT_CAP` is one constant), better model for premium (deployment name is already env-driven — near-config), resume-tailoring output (new engineering).

---

## 1. Chrome Web Store policy constraints

**Chrome Web Store Payments no longer exists.** Google's deprecation notice (posted to the official chromium-extensions group by the Chrome Web Store team): publishing paid items was disabled March 27, 2020; "you can no longer create new paid extensions or in-app items" from September 21, 2020; free trials disabled December 1, 2020; the licensing API sunset afterward. Google's stated position: "There are many other ways to monetize your extensions, and if you currently use Chrome Web Store payments, you'll need to migrate to one of them."
Source: [Chrome Web Store Payments — Deprecation Notice (chromium-extensions, official)](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/XLeZ6iKiuVI). The former docs page `https://developer.chrome.com/docs/webstore/cws-payments-deprecation/` now returns 404 (verified 2026-07-13), consistent with the feature being fully removed.

**External payments are explicitly contemplated by current policy.** The program policies' "Ensuring Responsible Marketing and Monetization" section contains an [Accepting Payment From Users policy](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment) which regulates how you charge, not whether you may:

- "You must securely collect, store, and transmit all credit card and other sensitive personal information in accordance with privacy and data security laws and payment card industry rules." (Stripe-hosted checkout satisfies this — card data never touches your servers.)
- You must be transparent about what you sell, prominently display terms of sale (refunds/returns), and clearly indicate when payment is required for functionality.
- "You must clearly identify that you, not Google, are the seller of the products or services."

Policy index: [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies).

**Policies that become binding when you add accounts + payments:**

| Policy | Requirement | Source |
|---|---|---|
| Privacy policy | "If your Product handles any user data, then you must post an accurate and up to date privacy policy" covering how data is collected/used/shared and all parties it's shared with; linked in the Developer Dashboard. Google sign-in + job-page text sent to your backend unambiguously counts. | [Privacy Policy](https://developer.chrome.com/docs/webstore/program-policies/privacy) |
| Limited Use | User data may only be used for the disclosed single purpose and operational needs; bans transfer/sale for ads, data brokers, creditworthiness; human access to user data prohibited except narrow cases; you must publicly disclose Limited Use compliance. | [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) |
| Disclosure Requirements | Prominent pre-install disclosure of what user data is collected and how it's used, plus "affirmative and informed consent"; prominently disclose any later change in data practices. Adding a payments/account flow after launch is exactly such a change. | [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements) |
| Deceptive installation / misleading behavior | Freemium gating must be honest in the listing — say what's free vs. paid. | [Deceptive Installation Tactics](https://developer.chrome.com/docs/webstore/program-policies/deceptive-installation-tactics), [Misleading or Unexpected Behavior](https://developer.chrome.com/docs/webstore/program-policies/unexpected-behavior) |

**Bottom line:** Stripe/Paddle checkout for a premium tier is policy-compliant if the listing and UI are transparent about (a) what's paid, (b) who the seller is, (c) what data is collected, and the privacy policy + data-usage certification in the dashboard are accurate.

## 2. Payment rails for a solo-dev premium tier

### Stripe pattern (minimum moving parts)

1. **Sell:** one Product + recurring Price; a **Payment Link** (no-code, supports subscriptions) — [docs.stripe.com/payment-links](https://docs.stripe.com/payment-links). Append `client_reference_id` to the link URL: "attach a unique string of your choice" (alphanumeric/dash/underscore, ≤ 200 chars), which "is sent in the `checkout.session.completed` webhook" — [Payment Link URL parameters](https://docs.stripe.com/payment-links/url-parameters). The extension opens `https://buy.stripe.com/...?client_reference_id=<google-sub>` (Google `sub` is numeric — fits the charset).
2. **Fulfill:** one new Azure Function as webhook endpoint. Stripe's fulfillment doc says: handle **`checkout.session.completed`** and **`checkout.session.async_payment_succeeded`**, verify the `Stripe-Signature` header with the webhook secret, check `payment_status !== 'unpaid'`, and make fulfillment **idempotent** ("safe to run multiple times, even concurrently, with the same session ID") — [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment). Fulfillment here = upsert `{ sub, tier: "premium", stripeCustomerId, subscriptionId }` in Table Storage (the same store `withAuth` already reads).
3. **Lifecycle:** listen for `customer.subscription.updated` / `customer.subscription.deleted` to downgrade on cancellation/failed payment (same fulfillment doc family; subscription events are part of Stripe Billing's webhook surface).
4. **Self-service:** the **no-code customer portal** — activate in the Dashboard; customers update payment methods, view invoices, cancel immediately or at period end. No session code needed for the basic login-link flow. — [Customer management](https://docs.stripe.com/customer-management).

So the increment over today's backend is: **1 webhook Function + 1 Table Storage tier attribute + 1 tier check in `withAuth`**.

**Stripe fees** ([stripe.com/pricing](https://stripe.com/pricing)): 2.9% + 30¢ per successful domestic card charge; +1.5% international cards; +1% currency conversion; Stripe Billing pay-as-you-go **0.7% of billing volume** for subscriptions; **Stripe Tax** 0.5% per transaction (no-code) or $0.50 per transaction (API). On a $5/month subscription: $0.145 + $0.30 + $0.035 + ~$0.025 ≈ **$0.51 (~10%)** before any international uplift.

### Tax reality and Merchant-of-Record alternatives

Stripe Tax *calculates and collects* tax but you remain the merchant of record — registering and remitting VAT/GST in each jurisdiction is your problem. For a solo dev selling a low-priced B2C subscription globally (EU VAT applies from the first B2C sale of a digital service), an MoR shifts that liability entirely:

- **Paddle** — MoR; "5% + 50¢ per Checkout transaction", explicitly including "Full tax registration, filing and remittance" — [paddle.com/pricing](https://www.paddle.com/pricing).
- **Lemon Squeezy** — MoR; 5% + 50¢ per transaction, +1.5% international, +1.5% PayPal, +0.5% subscription payments; no monthly fee — [lemonsqueezy.com/pricing](https://www.lemonsqueezy.com/pricing), [fees doc](https://docs.lemonsqueezy.com/help/getting-started/fees), [MoR doc](https://docs.lemonsqueezy.com/help/payments/merchant-of-record). (Their site blocks automated fetches — 403 — so figures were confirmed from their official pages via search index; re-verify at purchase time.)

**Assessment:** on a $5/mo price point the MoR premium over full Stripe (~10% effective, see above) is small, and it eliminates the only genuinely hard compliance problem. For US-only sales below state nexus thresholds Stripe alone is cheapest; for global B2C, MoR is the sane solo-dev default.

## 3. Hard-capping Azure spend

**Budgets/alerts do not stop anything.** Microsoft Learn, verbatim: "Notifications are triggered when the budget thresholds are exceeded. **Resources aren't affected, and your consumption isn't stopped.**" Cost data lags 8–24 h and budgets are evaluated every 24 h — useless as a real-time brake. — [Create and manage budgets](https://learn.microsoft.com/azure/cost-management-billing/costs/tutorial-acm-create-budgets). Budgets *can* trigger an action group (Function/Logic App/runbook) to take your own shutdown action, but that's your automation, still on lagged data — [same doc, "Trigger an action group"](https://learn.microsoft.com/azure/cost-management-billing/costs/tutorial-acm-create-budgets#costs-in-budget-evaluations). Microsoft Q&A (Microsoft-provided answer) confirms: "Azure AI Foundry / Azure OpenAI does not currently provide a native real-time dollar-based hard stop mechanism" — [Q&A answer](https://learn.microsoft.com/answers/a/12853124).

**Actual hard-stop mechanisms, cheapest first:**

1. **Deployment TPM/RPM quota (free, already have it).** On Standard/pay-as-you-go, you assign Tokens-Per-Minute to each deployment "in increments of 1,000"; the TPM assignment "directly maps to the tokens-per-minute rate limit enforced on its inferencing requests", with a proportional RPM limit; when exceeded, "further requests will receive a 429 response code until the counter resets". Editable post-deployment in the Foundry portal (Deployments → edit, or Management → Model quota). — [Manage Azure OpenAI quota](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/quota). Keep **dynamic quota off**: when off, "your deployment will be able to process a maximum throughput established by your TPM setting" (dynamic quota lets it burst above, billed at regular rates) — [Dynamic quota](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/dynamic-quota). This is a *rate* cap, not a monthly cap, but it bounds the bill: see the $311/month ceiling arithmetic in §4.
2. **APIM `llm-token-limit` policy** — the only Azure-native *fixed-window token quota*: `tokens-per-minute` (429 on excess) and/or `token-quota` with `token-quota-period` of Hourly/Daily/Weekly/Monthly/Yearly (**403** on excess), keyed by subscription key, IP, or any policy expression; can pre-estimate prompt tokens to reject before the backend is called. — [llm-token-limit policy](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy), [AI gateway capabilities](https://learn.microsoft.com/azure/api-management/genai-gateway-capabilities). Caveat: the policy is supported on Classic and v2 tiers but **not the APIM Consumption tier** — [policy reference table](https://learn.microsoft.com/azure/api-management/api-management-policies#rate-limiting-and-quotas) — so this means paying for an APIM instance; overkill for one Function App today.
3. **App-level metering** (per-user monthly counter in Table Storage, §5) — the only mechanism that maps to *per-user* free-tier quotas, which is what freemium actually needs. Combine 1 + 3: metering enforces fairness per user; deployment TPM is the blast-radius backstop if metering has a bug.

## 4. Cost per analysis (gpt-4o-mini, Global Standard)

**Prices** — pulled 2026-07-13 from the [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices) (`prices.azure.com/api/retail/prices`, the machine-readable source behind the [Azure OpenAI pricing page](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/), which timed out during research):

| Meter (Global) | $/1K tokens | $/1M tokens |
|---|---|---|
| `gpt-4o-mini-0718-Inp-glbl` | 0.00015 | **$0.15** |
| `gpt-4o-mini-0718-Outp-glbl` | 0.0006 | **$0.60** |
| `gpt-4o-mini-0718-cached-Inp-glbl` | 0.000075 | $0.075 |

**Input size from the repo:** `MAIN_TEXT_CAP = 40_000` characters (`functions/src/models/job.ts:75`). At the standard ≈ 4 chars/token heuristic for English, capped job text ≈ 40,000 / 4 = **10,000 tokens**. Add system prompt, JSON-LD, title, and an optional user profile: budget **~2,000 tokens** overhead → **12,000 input tokens worst case**. Output is schema-constrained with `max_tokens: 3000` (`functions/src/services/jobExtractionOrchestrator.ts:237`); assume **800–1,500 actual output tokens**.

**Per-analysis arithmetic:**

- Worst case: input 12,000 × $0.15/1M = $0.00180; output 1,500 × $0.60/1M = $0.00090 → **$0.00270**
- Typical (6,000-token posting, 1,000 output): 6,000 × 0.15/1M = $0.00090; 1,000 × 0.60/1M = $0.00060 → **$0.00150**

**Monthly cost at 20 analyses/user/month** (worst case $0.0027 × 20 = $0.054/user; typical $0.0015 × 20 = $0.030/user):

| Free users | Analyses/mo | Typical $/mo | Worst-case $/mo |
|---|---|---|---|
| 100 | 2,000 | 2,000 × $0.0015 = **$3.00** | 2,000 × $0.0027 = **$5.40** |
| 1,000 | 20,000 | 20,000 × $0.0015 = **$30.00** | 20,000 × $0.0027 = **$54.00** |
| 5,000 | 100,000 | 100,000 × $0.0015 = **$150.00** | 100,000 × $0.0027 = **$270.00** |

**Absolute ceiling from the TPM quota (§3):** a 30,000-TPM deployment saturated 24×7 for 30 days passes at most 30,000 × 60 × 24 × 30 = 1.296B tokens. At the worst-case blend (12K in / 3K out per request → 80% input, 20% output): blended rate = 0.8 × $0.15 + 0.2 × $0.60 = $0.24/1M → 1,296 × $0.24 ≈ **$311/month**, no matter what goes wrong upstream. (Each request's rate-limit estimate ≈ 12K prompt + 3,000 `max_tokens` = 15K tokens, so 30K TPM also ≈ 2 analyses/minute sustained — fine for thousands of light users, and adjustable in 1K increments.)

Free tier at 20 analyses/month costs ≈ **3–5.4¢ per free user** — the freemium bill is dominated by fixed risk (abuse), not by honest usage.

### 4b. Cost per analysis on alternative models

Prices pulled 2026-07-13 from the same Retail Prices API (note: the `serviceName` for these meters is now **`Foundry Models`**, product `Azure OpenAI` — the old `Cognitive Services` filter returns nothing). Global Standard, per 1M tokens. Per-analysis uses §4's assumptions: worst case 12,000 in / 1,500 out, typical 6,000 in / 1,000 out; monthly column is 1,000 free users × 20 analyses (20,000 calls), worst case.

| Model (meter) | $/1M in | $/1M out | Typical /analysis | Worst /analysis | × mini | 20K calls/mo (worst) |
|---|---|---|---|---|---|---|
| gpt-4.1-nano | $0.10 | $0.40 | $0.0010 | $0.0018 | 0.7× | $36 |
| **gpt-4o-mini (current)** | $0.15 | $0.60 | $0.0015 | $0.0027 | 1× | $54 |
| gpt-oss-120B | $0.15 | $0.60 | $0.0015 | $0.0027 | 1× | $54 |
| gpt-4.1-mini | $0.40 | $1.60 | $0.0040 | $0.0072 | 2.7× | $144 |
| o4-mini (reasoning)¹ | $1.10 | $4.40 | $0.0110¹ | $0.0198¹ | 7.3׹ | $396¹ |
| gpt-4.1 | $2.00 | $8.00 | $0.0200 | $0.0360 | 13× | $720 |
| o3 (0416, reasoning)¹ | $2.00 | $8.00 | $0.0200¹ | $0.0360¹ | 13׹ | $720¹ |
| gpt-4o (0806/1120) | $2.50 | $10.00 | $0.0250 | $0.0450 | 17× | $900 |
| gpt-5 pro | $15.00 | $120.00 | $0.2100 | $0.3600 | 133× | $7,200 |

Arithmetic per row: worst = 12,000 × in/1M + 1,500 × out/1M; typical = 6,000 × in/1M + 1,000 × out/1M.

¹ Reasoning models bill hidden reasoning tokens as output ([how reasoning models work](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/reasoning)), so real output-token counts run several × the visible answer — treat these figures as floors, and note reasoning adds latency against the 8 s p50 budget.

Notes:

- **Mainline gpt-5 chat meters (gpt-5 / gpt-5-mini / gpt-5-nano) did not appear** in the Retail Prices API's global token meters at query time — only `gpt 5 pro` and `gpt-5-codex` are listed. Re-check the API (or the pricing page) before planning around them; no prices are asserted here.
- The `Foundry Models` service also carries non-OpenAI global meters usable from the same subscription (e.g. Grok4 Fast $0.20/$0.50, Llama 4 Maverick $0.25/$1.00 per 1M), but they use the Foundry inference surface rather than the `AzureOpenAI` client — a code change, not a deployment swap.
- **Premium-tier margin check** (300 analyses/mo premium cap, worst case): gpt-4.1-mini → 300 × $0.0072 ≈ **$2.16** (fine under a $5/mo sub); gpt-4.1 → 300 × $0.036 ≈ **$10.80** (underwater at $5/mo — pair gpt-4.1 with a ~100/mo cap ≈ $3.60, or a higher price).

## 5. App-level metering in Azure Table Storage

**Design:** one entity per user per month in the existing per-user table — `PartitionKey = <google sub>`, `RowKey = "usage-" + YYYY-MM`, properties `{ count, limit }`. `withAuth` path before the OpenAI call: read entity → if `count >= limit` return 429/402 → else write `count + 1` conditionally.

**The concurrency guarantee is documented.** For both Update Entity and Merge Entity: "An entity's `ETag` provides default optimistic concurrency… Before an update operation occurs, Table Storage verifies that the entity's current `ETag` value is identical to the `ETag` value included with the update request in the `If-Match` header… If the entity's `ETag` differs… the operation fails with status code **412 (Precondition Failed)**… To resolve this error, retrieve the entity again and reissue the request." — [Update Entity (REST)](https://learn.microsoft.com/rest/api/storageservices/update-entity2), [Merge Entity (REST)](https://learn.microsoft.com/rest/api/storageservices/merge-entity). The table design guide confirms the service "implements optimistic concurrency checks at the level of individual entities" — [Table design patterns](https://learn.microsoft.com/azure/storage/tables/table-storage-design-patterns#modifying-entities). SDK surface: `updateEntity(entity, ifMatch)` "will fail with a status of 412 (Precondition Failed) if the ETag value of the entity in the table does not match" — [TableClient.UpdateEntity](https://learn.microsoft.com/dotnet/api/azure.data.tables.tableclient.updateentity) (the Node `@azure/data-tables` client exposes the same `etag`/`ifMatch` option).

**Limits to respect:**

- **No server-side atomic increment.** The Table service entity operations are Query/Insert/Update/Merge/Delete (+ upsert variants) — [Operations on entities](https://learn.microsoft.com/rest/api/storageservices/operations-on-entities); nothing increments server-side, so read-modify-write with `If-Match` + a bounded retry loop (re-read on 412, re-check the limit, retry ~3–5×, fail closed) is the correct and sufficient pattern. Two concurrent increments cannot both succeed off the same ETag — one gets 412.
- **Never use `If-Match: *`** — the wildcard "overrides the default optimistic concurrency" (unconditional write, lost updates) — [Update Entity remarks](https://learn.microsoft.com/rest/api/storageservices/update-entity2).
- **Missing `If-Match` = upsert**, not a conditional update — same source. Use `createEntity` for the first analysis of the month (fails 409 EntityAlreadyExists if raced → re-read).
- Under-counting is impossible with this scheme; the failure mode is a user seeing a transient error under pathological contention — acceptable for a per-user counter where contention is one human's own parallel tabs.
- Increment *before* the OpenAI call (fail closed). A crashed call slightly over-counts; the alternative under-counts and is the abuse vector.

## 6. Abuse surface of free Google-account signup

**What the ID token gives you** ([Google OpenID Connect docs](https://developers.google.com/identity/openid-connect/openid-connect)):

- `sub` — "An identifier for the user, unique among all Google Accounts and **never reused**". Google explicitly instructs: don't use `email` as the key; "Always use the `sub` field as it is unique to a Google Account even if the user changes their email address." (The feature-002 design of partitioning by `sub` is exactly right.)
- `email_verified` — boolean; require `true` at signup so throwaway unverified addresses can't register.
- `aud`/`iss`/`exp` — verified server-side by google-auth-library (already in the 002 design).

**What it does not give you:** any cost to creating another Google account. `sub`-keyed caps bound *per-account* spend (≤ ~5.4¢/month, §4); they don't stop someone farming accounts.

**Cheap mitigations, all supported by what's already documented above:**

1. **No anonymous access** — keep `withAuth` in front of every OpenAI call (existing design).
2. **Per-user monthly cap** — §5; bounds each account at pennies.
3. **Per-IP rate limit as the second axis** — at the Functions layer keyed on client IP, or if APIM is ever introduced, natively via [rate-limit-by-key](https://learn.microsoft.com/azure/api-management/rate-limit-by-key-policy) / [llm-token-limit keyed on `context.Request.IpAddress`](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy) (the policy's counter-key explicitly supports originating IP).
4. **Deployment TPM as global backstop** — §3; even a successful account-farming attack cannot push the bill past the TPM-derived ceiling.

## 7. Premium feature ideas grounded in the existing architecture

| Feature | Grounding in repo | Engineering cost |
|---|---|---|
| Higher / unlimited monthly analyses | Metering entity from §5 carries a per-user `limit`; premium = bigger number | **Config-only** once metering (new, but required for freemium anyway) exists |
| Bigger saved-jobs library | `SAVED_JOBS_SOFT_CAP = 1_000` (`functions/src/models/user.ts:12`), enforced in `functions/src/jobs/index.ts` | **Near-config**: make the cap tier-dependent in the existing check |
| Better model for premium (gpt-4o / gpt-4.1) | Deployment is already env-selected: `AZURE_OPENAI_JOB_DEPLOYMENT ?? AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o-mini"` (`functions/src/services/jobExtractionOrchestrator.ts:203-206`) | **Small code change**: pick deployment by tier + create the second deployment. Cost basis (Retail Prices API, Global): gpt-4o `0806` $2.50/$10 per 1M in/out (~17× mini); gpt-4.1 $2/$8 (~13×); gpt-4.1-mini $0.40/$1.60 (~2.7×) — worst-case gpt-4.1 analysis ≈ 12K × $2/1M + 1.5K × $8/1M ≈ $0.036, still only ~$0.72/user/month at 20 analyses. gpt-4.1-mini is the value pick for a premium default. |
| Fit scoring as a premium perk | Fit is computed only when a profile is present (`enforceConsistency`: `if (!req.profile) result.fit = null` — orchestrator lines 191-193); the gate point already exists server-side | **Near-config** (drop `profile` for free tier); product call whether to gate the flagship feature |
| Resume-tailoring / cover-letter output | New prompt + new JSON schema + new endpoint; reuses the existing `AzureOpenAI` + `json_schema` + `withAuth` plumbing | **New engineering** (the natural "premium-only expensive feature": longer outputs justify the paid tier and the per-call metering) |
| Bulk export / larger export | Jobs list + export already exist client-side | **Small**: tier check on export size |
| Cached re-analysis freshness | Analysis caching exists in the extension; premium could force fresh re-analysis or auto-refresh saved jobs | **Moderate**: server-side scheduled re-analysis would be a new timer Function |

**Suggested v1 premium bundle** (lowest engineering, clear value): unlimited/high-cap analyses + 4.1-mini model + fit scoring free-for-all (it's the hook) + bigger library. Everything except resume tailoring ships with the metering feature plus configuration.

---

## Source index

- CWS program policies: https://developer.chrome.com/docs/webstore/program-policies · [accepting-payment](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment) · [privacy](https://developer.chrome.com/docs/webstore/program-policies/privacy) · [limited-use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) · [disclosure-requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- CWS Payments deprecation (official team post): https://groups.google.com/a/chromium.org/g/chromium-extensions/c/XLeZ6iKiuVI
- Stripe: [checkout/fulfillment](https://docs.stripe.com/checkout/fulfillment) · [payment-links](https://docs.stripe.com/payment-links) · [payment-links/url-parameters](https://docs.stripe.com/payment-links/url-parameters) · [customer-management](https://docs.stripe.com/customer-management) · [pricing](https://stripe.com/pricing)
- Paddle: https://www.paddle.com/pricing — Lemon Squeezy: https://www.lemonsqueezy.com/pricing · https://docs.lemonsqueezy.com/help/getting-started/fees
- Azure budgets: https://learn.microsoft.com/azure/cost-management-billing/costs/tutorial-acm-create-budgets · [cost alerts](https://learn.microsoft.com/azure/cost-management-billing/costs/cost-mgt-alerts-monitor-usage-spending) · [MS Q&A: no native hard stop](https://learn.microsoft.com/answers/a/12853124)
- Azure OpenAI quota: https://learn.microsoft.com/azure/ai-foundry/openai/how-to/quota · [dynamic quota](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/dynamic-quota)
- APIM: https://learn.microsoft.com/azure/api-management/llm-token-limit-policy · [AI gateway](https://learn.microsoft.com/azure/api-management/genai-gateway-capabilities) · [policy tier matrix](https://learn.microsoft.com/azure/api-management/api-management-policies#rate-limiting-and-quotas)
- Pricing: https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices (queried 2026-07-13) · https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/
- Table Storage: https://learn.microsoft.com/rest/api/storageservices/update-entity2 · [merge-entity](https://learn.microsoft.com/rest/api/storageservices/merge-entity) · [operations-on-entities](https://learn.microsoft.com/rest/api/storageservices/operations-on-entities) · [design patterns](https://learn.microsoft.com/azure/storage/tables/table-storage-design-patterns)
- Google Identity: https://developers.google.com/identity/openid-connect/openid-connect
- Repo: `functions/src/models/job.ts` (MAIN_TEXT_CAP), `functions/src/models/user.ts` (SAVED_JOBS_SOFT_CAP), `functions/src/services/jobExtractionOrchestrator.ts` (deployment selection, max_tokens, fit gating), `functions/src/jobs/index.ts` (cap enforcement)
