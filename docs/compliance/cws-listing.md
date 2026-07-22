# Chrome Web Store Listing Copy — Free vs. Paid (003-freemium-premium-tier)

Draft copy for the Chrome Web Store listing (Developer Dashboard → Store
listing) once the freemium release ships. Updated for
[`004-web-companion-app`](../../specs/004-web-companion-app/) to add a short
mention of the companion web app — see that section below; the pricing and
disclosure copy below is otherwise unchanged by 004, since the web app reuses
the same account, tiers, and limits and is not itself distributed through the
Chrome Web Store. Satisfies the
[Deceptive Installation Tactics](https://developer.chrome.com/docs/webstore/program-policies/deceptive-installation-tactics)
and [Misleading or Unexpected Behavior](https://developer.chrome.com/docs/webstore/program-policies/unexpected-behavior)
policies' requirement to state plainly what's free vs. paid — and the
[Accepting Payment From Users](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment)
policy's requirement to identify the developer, not Google, as the seller.

## "Pricing" line (shown near the top of the listing, per CWS convention)

> **Free**, with an optional Premium upgrade ($5/month)

## Short description (≤ 132 chars, CWS limit)

> AI job posting analyzer: arrangement, salary, fit score. Free: 50
> analyses/mo. Premium ($5/mo): 300/mo + better model.

## Detailed description — pricing section

> ## Free to start, no invitation needed
>
> Sign in with any Google account to create a free account instantly — no
> waiting for approval. The free tier includes:
>
> - **50 job analyses per month**
> - **A 100-posting saved library**
> - Full access to fit scoring against your candidate profile
>
> ## Premium — $5/month
>
> Upgrade any time for:
>
> - **300 analyses per month**
> - **A 1,000-posting saved library**
> - Analyses produced with a higher-quality model — noticeably better
>   extraction accuracy and fit scoring
>
> Premium is billed monthly and can be canceled any time; you keep Premium
> through the period you've already paid for. Payment is processed by
> Paddle.com Market Limited, our payment processor and merchant of record —
> **Job Posting Analyzer's developer, not Google, is the seller** of the
> Premium subscription. See the [Terms of Service](../legal/terms.html) for
> full terms of sale and the [Privacy Policy](../legal/privacy-policy.html)
> for what account and payment-adjacent data we store.
>
> Exceeding your monthly free-tier limit never charges you automatically —
> you'll see a clear notice with your reset date and an option to upgrade.

## Detailed description — companion web app mention (004-web-companion-app)

Add one short paragraph after the pricing section, since the free companion web
app is a real feature of the same account and is worth surfacing in the listing
even though it isn't itself distributed through the Chrome Web Store:

> ## Also included: a web companion app
>
> Sign in at the companion web app with the same Google account to browse,
> search, filter, sort, and compare your saved library on a bigger screen, edit
> your candidate profile, and analyze a job posting from an uploaded Word
> (.docx) or PDF document instead of a browser tab. It's the same account, same
> free/Premium limits, and same data — nothing to set up separately. Find the
> link in the extension's side panel.

No screenshot requirement changes: the web app is a bonus surface, not a
prerequisite for any core feature, so the CWS screenshot set can stay
extension-only. Do not imply document-upload analysis is available *in* the
extension — that capability is web-only (spec 004 FR — extension has no file
picker), so this paragraph must stay scoped to "the web companion app."

## Screenshots / promotional copy checklist

- [ ] At least one listing screenshot shows the AccountBar (plan badge +
      usage count), so the free/paid distinction is visible before install,
      not just in text.
- [ ] No screenshot implies Premium features are available on the free tier
      or vice versa.
- [ ] The "Sign in with Google to get started" self-serve framing replaces
      any remaining "request access" / "invitation" language from the
      pre-freemium listing copy.

## Data-usage certification (Developer Dashboard → Privacy tab)

Re-submit the Limited Use certification (research.md R9) — the disclosed
purpose now explicitly covers account/tier/usage data and payment-status
data (never payment card data, which the developer never receives; see
Privacy Policy). Link the same `docs/legal/privacy-policy.html` URL already
configured; no URL change needed, only re-certifying that the content still
accurately describes practices after this feature ships.
