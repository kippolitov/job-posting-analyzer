# Chrome Web Store Listing Copy — Free vs. Paid (003-freemium-premium-tier)

Draft copy for the Chrome Web Store listing (Developer Dashboard → Store
listing) once the freemium release ships. Satisfies the
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
