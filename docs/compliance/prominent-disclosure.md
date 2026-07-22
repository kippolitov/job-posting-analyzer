# Prominent Disclosure — Self-Serve Signup & Payments (003-freemium-premium-tier)

Source of truth for the copy shown in the extension's sign-in consent surface
(`extension/components/AuthGate.tsx`) and the reference point for review
against the Chrome Web Store [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
policy (research.md R9 / docs/research/freemium-monetization.md §1).

**Extended for [`004-web-companion-app`](../../specs/004-web-companion-app/):**
see "The web app surface" below. The Chrome Web Store policy this document was
originally written against applies only to the extension, but the same
account and the same data practices are now reachable from a second surface
(the web app), so the disclosure has been mirrored there on the same
principle even though no CWS review covers it.

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

## The web app surface (004-web-companion-app)

The web app (`web/`) is a second, independent sign-in surface for the same
account — Google Identity Services instead of `chrome.identity`, but the
same backend, the same account record, and the same data practices this
document discloses. It also introduces one new data practice of its own:
**document upload** (a user-selected `.docx`/`.pdf` file's text is extracted
server-side, analyzed, and then discarded — see the Privacy Policy's
"Document upload" section). Because that is a new category of user-submitted
content (a file, not a page the user is already viewing), it gets its own
disclosure line rather than being silently folded into the existing copy.

**Disclosure copy** (shown on the web app's public landing page, `web/src/pages/Landing.tsx`,
above the "Sign in with Google" action — the same placement rule as the
extension: not collapsed behind a "Learn more" link):

> **Signing in creates a free account** — the same one your browser extension
> uses, if you have it installed. We store your email address, entitlement
> tier (free or Premium), and monthly analysis usage count. If you subscribe
> to Premium ($5/month), Paddle — our payment processor and merchant of
> record — handles payment; we never see your card details, only your
> subscription status. If you upload a document to analyze, its text is
> extracted and analyzed but the file itself is not kept. By continuing, you
> agree to our [Privacy Policy](https://kippolitov.github.io/job-posting-analyzer/legal/privacy-policy.html)
> and [Terms of Service](https://kippolitov.github.io/job-posting-analyzer/legal/terms.html),
> including the terms of sale for Premium.

**Placement**: rendered on `Landing.tsx` immediately above the Google
sign-in button, and the same links appear in a persistent footer on every
authenticated page (`AppShell.tsx`) so a returning user isn't only shown
this once. See `web/tests/unit/` for the corresponding coverage (add a test
asserting the disclosure renders and links resolve, mirroring
`extension/tests/unit/AuthGate.test.tsx`).
