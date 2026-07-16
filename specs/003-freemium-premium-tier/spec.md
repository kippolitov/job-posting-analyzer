# Feature Specification: Freemium Product with Self-Serve Signup and Premium Tier

**Feature Branch**: `003-freemium-premium-tier`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Turn the extension from invite-only into a freemium product with self-serve signup and a paid premium tier. Anyone with a Google account (verified email) can sign up and immediately use a free tier: 50 job analyses per calendar month and a personal saved-jobs library capped at 100 jobs; when the monthly allowance runs out, the user sees a clear 'you've used all 50 free analyses this month' state with the reset date and an upgrade path — never a silent failure, and saved jobs, profile, and past analyses stay fully accessible. A Premium subscription at $5/month lifts the cap to 300 analyses per month, unlocks the full 1,000-job library, and produces higher-quality analyses (noticeably better fit scoring and extraction). Users can subscribe, see their current plan, usage count, and renewal state inside the extension, and cancel any time with premium lasting through the paid period, after which the account downgrades gracefully to free-tier limits without data loss (a library over the free cap becomes read-only rather than truncated). Existing allowlisted users are migrated to accounts without interruption."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Self-Serve Signup to First Analysis (Priority: P1)

A job seeker discovers the extension, installs it, signs up with their Google account (verified email), and runs their first job analysis — all in one sitting, with no waiting for human approval. Their account starts on the free tier immediately: 50 analyses per calendar month and a saved-jobs library of up to 100 jobs.

**Why this priority**: This is the core conversion of the product from invite-only to freemium. Without frictionless self-serve signup, no other part of the feature (quotas, premium, billing) has anyone to serve. It is independently valuable: shipping only this story already removes the invite bottleneck.

**Independent Test**: Can be fully tested by installing the extension with a fresh Google account, completing signup, and running one analysis — measuring elapsed time and confirming no approval step occurred.

**Acceptance Scenarios**:

1. **Given** a new user with a Google account and a verified email who has never used the product, **When** they install the extension and sign up, **Then** an account is created immediately with free-tier entitlements (50 analyses/month, 100-job library) and no human approval is required.
2. **Given** a newly signed-up free-tier user, **When** they analyze a job posting, **Then** the analysis completes and their monthly usage count increases from 0 to 1.
3. **Given** a user attempting signup with a Google account whose email is not verified, **When** they try to sign up, **Then** signup is refused with a plain-language explanation that a verified email is required and how to verify it.
4. **Given** a signed-up user, **When** they sign in on a second device with the same Google account, **Then** they see the same account, plan, usage count, and saved jobs.

---

### User Story 2 - Free-Tier Limits with Clear Exhaustion State (Priority: P2)

A free-tier user works through their monthly allowance. As they approach and then hit the 50-analysis cap, the extension tells them clearly where they stand. When the allowance is exhausted, they see an explicit "you've used all 50 free analyses this month" state with the date the allowance resets and a path to upgrade — never a silent failure or a generic error. Everything they already have — saved jobs, profile, and past analyses — remains fully accessible.

**Why this priority**: Quota enforcement is what makes the free tier economically viable, and the exhaustion experience is what makes it fair. It requires Story 1 (accounts) to exist but nothing else.

**Independent Test**: Can be tested by driving a free account to 50 analyses within a month and verifying the 51st attempt is blocked with the correct message, reset date, and upgrade path, while saved jobs and past analyses remain readable.

**Acceptance Scenarios**:

1. **Given** a free-tier user who has used 49 analyses this calendar month, **When** they run one more analysis, **Then** it succeeds and the extension shows the allowance is now fully used.
2. **Given** a free-tier user who has used all 50 analyses this month, **When** they attempt another analysis, **Then** the attempt is blocked before any work is done and they see a message stating they have used all 50 free analyses this month, the date the allowance resets, and an option to upgrade to Premium.
3. **Given** a free-tier user with an exhausted allowance, **When** they browse their saved jobs, profile, or past analyses, **Then** all of it is fully accessible with no degradation.
4. **Given** a free-tier user with an exhausted allowance, **When** the next calendar month begins, **Then** their allowance resets to 50 and they can analyze again without any action on their part.
5. **Given** a free-tier user who fires several analysis requests simultaneously with only one analysis remaining in their allowance, **When** the requests are processed, **Then** exactly one succeeds and the rest are blocked with the exhaustion message — the cap can never be exceeded by racing parallel requests.
6. **Given** a free-tier user with 100 saved jobs, **When** they try to save another job, **Then** the save is refused with a clear message about the 100-job free-tier limit and an option to upgrade or remove existing jobs.

---

### User Story 3 - Subscribe to Premium and See Plan Status (Priority: P3)

A free-tier user who wants more decides to upgrade. From inside the extension they subscribe to Premium at $5/month. Within one minute of completing payment — and without reinstalling or signing out — their account reflects Premium: 300 analyses per month, a library of up to 1,000 jobs, and higher-quality analyses with noticeably better fit scoring and extraction. At any time, the user can see their current plan, how many analyses they have used this month, and their renewal state inside the extension.

**Why this priority**: This is the revenue side of freemium. It depends on Stories 1–2 (accounts and quotas) being in place, so it comes third, but it is independently testable once they exist.

**Independent Test**: Can be tested by upgrading a free account through the purchase flow and verifying premium entitlements are active within one minute without reinstalling, and that plan, usage, and renewal state display correctly.

**Acceptance Scenarios**:

1. **Given** a free-tier user, **When** they complete a Premium purchase, **Then** their account is on Premium within one minute, with the 300-analysis monthly cap and 1,000-job library in effect, without reinstalling the extension or re-authenticating.
2. **Given** a free-tier user who exhausted their 50 free analyses this month, **When** they upgrade to Premium mid-month, **Then** they can immediately continue analyzing under the 300-analysis monthly cap (analyses already used this month count against it).
3. **Given** a Premium user, **When** they run an analysis, **Then** the result uses the premium analysis quality (better fit scoring and extraction than the free tier).
4. **Given** any signed-in user, **When** they open their account view in the extension, **Then** they see their current plan, analyses used this month out of their cap, and — for Premium — the renewal date and whether the subscription will renew or end.
5. **Given** a user whose Premium payment fails at renewal, **When** the renewal cannot be collected, **Then** they are informed with a plain-language message and a way to fix payment, and the account only downgrades after the paid-through period (plus any grace handling) ends.

---

### User Story 4 - Cancel Anytime with Graceful Downgrade (Priority: P4)

A Premium user cancels their subscription from inside the extension. Premium features last through the end of the period they already paid for. When that period ends, the account downgrades to free-tier limits without losing any data: if their saved-jobs library holds more than the 100-job free cap, the library becomes read-only (they can view, search, and delete, but not add) rather than being truncated.

**Why this priority**: Cancellation and downgrade must exist before Premium can responsibly launch, but it is exercised by fewer users than the purchase path, so it follows Story 3.

**Independent Test**: Can be tested by cancelling a Premium subscription and verifying premium persists until the period end, then that the account is on free limits afterward with all data intact and an over-cap library in read-only mode.

**Acceptance Scenarios**:

1. **Given** a Premium user, **When** they cancel their subscription, **Then** the cancellation is confirmed, no further charges occur, and Premium entitlements remain active through the end of the paid period, with the account view showing the subscription will end (not renew) and on what date.
2. **Given** a cancelled Premium user whose paid period has ended and who has 400 saved jobs, **When** the downgrade takes effect, **Then** all 400 jobs remain visible and searchable, no data is deleted, and the library is read-only for additions with a clear explanation and a re-upgrade path.
3. **Given** a downgraded user with a read-only over-cap library, **When** they delete jobs to bring the library to 100 or below, **Then** they can save new jobs again under the free cap.
4. **Given** a downgraded user, **When** the calendar month rolls over, **Then** their analysis allowance is the free tier's 50, and their profile and past analyses are fully intact.
5. **Given** a downgraded user with an over-cap read-only library, **When** they re-subscribe to Premium, **Then** the library becomes writable again up to the 1,000-job cap.

---

### User Story 5 - Migrate Existing Allowlisted Users Without Interruption (Priority: P5)

An existing invite-only (allowlisted) user opens the extension after the freemium launch. Their existing profile, saved jobs, and past analyses are attached to their new account automatically, and they keep working without losing access at any point — no re-approval, no data loss, no forced re-setup.

**Why this priority**: Essential for launch (existing users must not be broken), but it is a one-time transition affecting a small, known population, and it depends on the account system from Story 1.

**Independent Test**: Can be tested by taking an allowlisted user's existing data, running the migration, signing in as that user, and verifying all prior data is present and the user can analyze immediately.

**Acceptance Scenarios**:

1. **Given** an existing allowlisted user with saved jobs, a profile, and past analyses, **When** the product switches to freemium, **Then** they can sign in with their Google account and find all their existing data intact, with no approval step and no period during which the product refuses to serve them.
2. **Given** a migrated user whose existing saved-jobs library exceeds 100 jobs, **When** they use the product on the free tier, **Then** no jobs are deleted and the over-cap library follows the same read-only rule as a downgraded account.
3. **Given** an allowlisted user who does not open the extension until months after launch, **When** they eventually sign in, **Then** the migration still applies and their data is intact.

---

### Edge Cases

- A user's analysis fails for reasons outside their control (e.g., the analysis service errors): the failed attempt does not consume an analysis from the monthly allowance.
- Several analysis requests race with one slot left in the allowance (same device or multiple devices): exactly the remaining number succeed; the cap is never exceeded (see Story 2, scenario 5).
- Calendar-month boundary: the reset moment is defined in a single consistent way for all users (see Assumptions) and the displayed reset date matches the actual reset behavior.
- Purchase completes but the entitlement update is delayed: the user sees a pending state, not an error, and activation still occurs within the one-minute target; if it genuinely fails, the user gets a clear recovery path rather than being charged with nothing to show.
- Payment fails at renewal: the user is notified, given a chance to fix payment, and never loses data; downgrade follows the paid-through period plus grace handling.
- A refund or chargeback occurs: premium entitlements are revoked going forward, but data is never deleted; over-cap library becomes read-only.
- A Premium user hits the 1,000-job library cap: saves are refused with a clear message; nothing is silently dropped.
- A user attempts to sign up with a non-Google account or an unverified Google email: refused with a plain-language explanation.
- A user cancels and re-subscribes within the same paid period: no double charge; renewal simply resumes.
- The same person signs in on multiple devices: plan, usage count, and library are consistent across devices; usage counts once per analysis regardless of device.
- A signed-out or signed-in-elsewhere state never silently discards a user's request: the user is told what happened and what to do next.

## Requirements *(mandatory)*

### Functional Requirements

#### Signup & Accounts

- **FR-001**: System MUST allow any person with a Google account and a verified email address to create an account via self-serve signup, with no human approval step.
- **FR-002**: System MUST refuse signup for Google accounts without a verified email and explain why in plain language.
- **FR-003**: A newly created account MUST be immediately usable on the free tier with no waiting period.
- **FR-004**: System MUST associate a user's profile, saved jobs, past analyses, plan, and usage with their account so they are consistent across devices and reinstalls.

#### Free Tier

- **FR-005**: Free-tier accounts MUST be limited to 50 successful job analyses per calendar month.
- **FR-006**: Free-tier accounts MUST be limited to a saved-jobs library of 100 jobs for additions.
- **FR-007**: System MUST count only successful analyses against the monthly allowance; failures caused by the system MUST NOT consume allowance.
- **FR-008**: System MUST reset each account's monthly analysis allowance at the start of each calendar month, at a single consistently defined reset moment.
- **FR-009**: When a free-tier user's monthly allowance is exhausted, the System MUST block further analyses and display a message stating that all 50 free analyses for the month are used, the date the allowance resets, and an upgrade path. A silent failure or generic error MUST never be the exhaustion experience.
- **FR-010**: Allowance exhaustion MUST NOT restrict access to saved jobs, profile, or past analyses in any way.
- **FR-011**: When a free-tier user at the 100-job library cap tries to save a job, the System MUST refuse the save with a clear message naming the limit and offering the options to upgrade or remove jobs.

#### Usage Enforcement

- **FR-012**: System MUST enforce per-user monthly analysis caps exactly: concurrent or parallel analysis requests MUST NOT allow an account to exceed its cap, regardless of device count or timing.
- **FR-013**: System MUST show each signed-in user their current plan, the number of analyses used this month against their cap, and (for subscribers) their renewal state, inside the extension.
- **FR-014**: Usage displayed to the user MUST reflect their actual consumed allowance (current as of the user's latest interaction).

#### Premium Subscription

- **FR-015**: Users MUST be able to purchase a Premium subscription at $5 per month from inside the extension.
- **FR-016**: Premium accounts MUST have a cap of 300 successful analyses per calendar month and a saved-jobs library of up to 1,000 jobs.
- **FR-017**: Premium analyses MUST be of higher quality than free-tier analyses, with measurably better fit scoring and extraction (see SC-008).
- **FR-018**: A completed Premium purchase MUST take effect on the account within one minute, without requiring reinstallation, sign-out, or manual refresh beyond normal use.
- **FR-019**: Analyses used earlier in the month MUST count against the new 300-analysis cap when a user upgrades mid-month; upgrading MUST immediately unblock a user who had exhausted the free allowance.
- **FR-020**: Users MUST be able to cancel their subscription at any time from inside the extension; cancellation MUST stop future charges while keeping Premium active through the end of the already-paid period.

#### Downgrade & Data Preservation

- **FR-021**: When a Premium subscription ends (cancellation reaching period end, failed renewal after grace handling, or refund/chargeback), the account MUST downgrade to free-tier limits without deleting or truncating any user data.
- **FR-022**: If a downgraded account's saved-jobs library exceeds the free 100-job cap, the library MUST become read-only for additions — viewing, searching, and deleting remain available — and the user MUST see an explanation and a re-upgrade path.
- **FR-023**: A downgraded user whose library returns to at or below 100 jobs (e.g., by deleting) MUST regain the ability to save jobs under the free cap; a user who re-subscribes MUST regain full Premium limits including a writable library up to 1,000 jobs.
- **FR-024**: When a renewal payment fails, the System MUST inform the user in plain language with a way to fix payment before the account downgrades.

#### Migration

- **FR-025**: System MUST migrate every existing allowlisted user to an account tied to their Google identity, preserving their profile, saved jobs, and past analyses, with no interruption of service and no approval step.
- **FR-026**: Migrated accounts MUST land on the free tier with the same over-cap read-only library rule as downgraded accounts; no migrated data is ever deleted.
- **FR-027**: Migration MUST apply whenever the user first signs in after launch, even if that is long after the switch.

### Key Entities

- **Account**: A person's identity in the product, created from a verified-email Google identity. Owns a profile, a saved-jobs library, past analyses, a plan, and monthly usage.
- **Plan**: The tier an account is on — Free (50 analyses/month, 100-job library, standard analysis quality) or Premium (300 analyses/month, 1,000-job library, higher analysis quality). Determines entitlements at any moment in time.
- **Subscription**: A Premium purchase attached to an account: its price ($5/month), renewal date, renewal state (will renew / will end / payment problem), and paid-through date. Cancellation ends renewal but not the paid-through entitlement.
- **Monthly Usage**: The count of successful analyses an account has consumed in the current calendar month, compared against the plan's cap. Resets each calendar month.
- **Saved-Jobs Library**: The set of jobs a user has saved, with a per-plan size cap for additions and a read-only-when-over-cap rule after downgrade or migration.
- **Analysis**: One job-posting analysis performed for an account; has a quality level determined by the account's plan at the time it runs, and consumes one unit of monthly usage when successful.
- **Legacy Allowlisted User**: A pre-launch user identified by the invite allowlist, whose existing data must be attached to an Account at migration time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user goes from installing the extension to receiving their first completed analysis in under 2 minutes, with zero human approval steps, measured on a standard connection.
- **SC-002**: Per-user monthly caps are enforced exactly: in a test firing 20 parallel analysis requests against an account with 1 remaining analysis, exactly 1 succeeds; across all usage, the number of successful analyses in a month never exceeds the account's cap.
- **SC-003**: 100% of users who hit their monthly cap see the explicit exhaustion message with the reset date and an upgrade path; zero silent failures or generic errors in the exhaustion path.
- **SC-004**: A Premium purchase is reflected in the account's entitlements within 1 minute of payment completion, without reinstalling, in at least 99% of purchases.
- **SC-005**: Worst-case monthly cost to serve one free-tier user (a user who consumes all 50 analyses and fills their 100-job library) stays under $0.15.
- **SC-006**: Downgrades (cancellation, failed renewal, refund) result in zero user data loss: 100% of saved jobs, profile data, and past analyses remain accessible afterward.
- **SC-007**: 100% of existing allowlisted users can sign in after launch and find all their prior data intact, with no service interruption attributable to the migration.
- **SC-008**: Premium analyses are measurably better than free analyses: on the project's fixed evaluation set of job postings, the premium configuration shows no regression on extraction metrics and a measurable improvement in fit-scoring quality, as reported by the evaluation harness comparing both configurations side by side.
- **SC-009**: Users can determine their current plan, usage this month, and renewal state from inside the extension without contacting support; support requests asking "how many analyses do I have left" trend to near zero after launch.

## Assumptions

- **Sign-in method**: Google sign-in is the only supported identity at launch; the "verified email" requirement is the one Google reports for the account. No email/password or other providers.
- **Calendar-month reset**: the monthly allowance resets at the start of each calendar month in a single fixed reference timezone (UTC) for all users; the UI always shows the concrete reset date so users are never guessing.
- **What counts as an analysis**: one successful analysis of one job posting consumes one unit, regardless of which site it came from; user-initiated re-analysis of the same posting consumes a new unit; system-caused failures consume nothing.
- **Migrated users start on Free**: existing allowlisted users are migrated to the free tier (not granted Premium); any of their libraries already over 100 jobs follow the read-only over-cap rule. No existing user loses data or access to what they already have.
- **Billing is handled by an established payment provider**: taxes, receipts, card handling, refunds, and dunning (retry/grace behavior on failed payments) follow the provider's standard capabilities; this spec defines the user-facing outcomes, not the provider's internals.
- **Grace on failed renewal**: a short grace period with user notification precedes downgrade after a failed renewal; the exact length follows the payment provider's standard dunning flow.
- **Single subscription level**: there is exactly one paid tier (Premium, $5/month, monthly billing only) at launch; no annual plans, trials, coupons, team plans, or regional pricing.
- **Quality difference is a product guarantee, not a number in this spec**: "noticeably better" premium analysis is validated by SC-008's evaluation-harness comparison (extraction non-regression + fit-scoring improvement on the fixed posting set) rather than a named metric threshold.
- **Existing per-account data model**: the account-persistent-storage capability (feature 002) exists and is the foundation this feature attaches plans, usage, and entitlements to.
- **Abuse handling is out of scope**: rate limiting beyond the monthly caps, multi-account abuse prevention, and fraud screening beyond the payment provider's defaults are not part of this feature.
