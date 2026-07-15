# Prominent Disclosure — Self-Serve Signup & Payments (003-freemium-premium-tier)

Source of truth for the copy shown in the extension's sign-in consent surface
(`extension/components/AuthGate.tsx`) and the reference point for review
against the Chrome Web Store [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
policy (research.md R9 / docs/research/freemium-monetization.md §1).

## Why this exists

Prior to this feature, the extension was invite-only and collected no
payment information. Opening self-serve signup and adding a paid tier is
exactly the "change in data practices" the Disclosure Requirements policy
requires prominent, affirmative disclosure for — not a quiet update.

## Required elements (per the policy)

1. What user data is collected and how it's used.
2. That the data collection/use is happening (not buried in a privacy
   policy nobody reads).
3. Affirmative, informed consent — a real action, not an implied one.

## Disclosure copy (shown before first sign-in)

> **Signing in creates a free account.**
>
> Job Posting Analyzer will store your email address, an entitlement tier
> (free or Premium), and your monthly analysis usage count on our servers,
> tied to your Google account. If you choose to subscribe to Premium
> ($5/month), payment is handled entirely by Paddle, our payment processor
> and merchant of record — we never see your card details, only your
> subscription status.
>
> By continuing, you agree to our [Privacy Policy](../legal/privacy-policy.html)
> and [Terms of Service](../legal/terms.html), including the
> [terms of sale](../legal/terms.html#terms-of-sale) for the optional
> Premium subscription.
>
> [Sign in with Google] — the button itself is the affirmative consent
> action; no separate checkbox is required for a single, clearly-labeled
> primary action per Google's own accepted pattern for this kind of gate.

## Placement

Rendered inline in `AuthGate.tsx`'s signed-out state, immediately above the
"Sign in with Google" button — not a separate screen requiring extra clicks
to reach, and not collapsed behind a "Learn more" link. See
`extension/tests/unit/AuthGate.test.tsx` for the test asserting this text
renders and that sign-in is blocked until it has been shown.

## Re-disclosure for existing (migrated) users

Users migrated from the old invitation allowlist (spec US5) never explicitly
saw this disclosure, since their account was created before this feature.
The same `AuthGate` consent surface renders for every signed-out session
regardless of account history, so a migrated user sees and re-affirms it
the next time they sign in after a session expires or they explicitly sign
out — no separate migration-specific consent flow is needed.
