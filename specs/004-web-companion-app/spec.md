# Feature Specification: Companion Web Application with Document-Upload Analysis

**Feature Branch**: `004-web-companion-app`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Add a companion web application, available to every account on every tier (free and premium alike, no web-only gating), where a user signs in with the same Google account they use in the extension and sees the same data: their saved job postings library and candidate profile are the single server-side source of truth, so anything saved, edited, or analyzed on the web appears in the extension and vice versa, with no separate web copy and no migration. Signed in on the web, the user can browse their full saved-postings library with each posting's stored analysis — fit score with matching/missing/desired skills and strengths/weaknesses, work arrangement with evidence and confidence, salary, seniority, tech stack, status, and notes — and can search, filter (by status, arrangement, seniority, fit-score range), and sort it, with the larger screen showing richer views than the side panel allows (e.g., comparing several postings side by side). They can view and edit their candidate profile (same single profile, same 20,000-character limit) and see their current plan, monthly usage, and renewal state. The web app adds one new analysis path: the user uploads a Word (.docx) or PDF document containing a job description or requirements (up to 10 MB), the document's text is extracted, and the same structured analysis is generated — identical output shape and fit scoring as a page-based analysis, with the source shown as an uploaded document rather than a URL. A document-sourced analysis counts against the same monthly analysis allowance as extension analyses (50 free / 300 premium, atomically metered so parallel requests can never exceed the cap), and hitting the cap produces the same explicit 'allowance used, resets on <date>' state with an upgrade path — never a silent failure. The user can save a document-sourced analysis into their library (counting against the same 100/1,000 library cap, with the same at-cap refusal message), and uploaded documents themselves are not retained after analysis — only the extracted analysis and the document's filename are stored. Unreadable, password-protected, image-only (no extractable text), or non-.docx/.pdf files are rejected before any allowance is consumed, with a plain-language explanation of what's wrong and what formats are accepted. A signed-out visitor sees a public landing page explaining the product but cannot reach any account data; all account data requires the same verified Google sign-in as the extension."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign In on the Web and See the Same Data (Priority: P1)

A user who already uses the extension opens the companion web application, signs in with the same Google account, and immediately sees the same saved-postings library and candidate profile they have in the extension — no separate copy, no import, no migration step. A signed-out visitor who lands on the web app instead sees a public page explaining the product and cannot reach any account data until they sign in.

**Why this priority**: This is the foundational promise of the feature — one account, one server-side source of truth, reachable from a second surface. Every other capability (searching, editing, document analysis) depends on the web app being able to authenticate the same identity and read the same data. Shipping only this story already delivers value: users get a full-screen, read-anywhere view of the library they previously could only see in the side panel.

**Independent Test**: Sign in on the web with a Google account that has existing saved postings and a profile in the extension, and confirm the same postings and profile appear; separately, visit the web app signed-out and confirm the landing page shows but no account data is reachable.

**Acceptance Scenarios**:

1. **Given** a user with saved postings and a profile created in the extension, **When** they sign in to the web app with the same Google account, **Then** they see the same saved postings and the same profile, with no separate web copy and no migration or import step.
2. **Given** a signed-in web user viewing a saved posting, **When** they open that posting's stored analysis, **Then** they see the full stored analysis — fit score with matching, missing, and desired skills and strengths and weaknesses; work arrangement with its evidence and confidence; salary; seniority; tech stack; status; and notes.
3. **Given** a change made in the extension (a posting saved, edited, or deleted), **When** the user next loads or refreshes the web app, **Then** the change is reflected on the web; and a change made on the web is likewise reflected in the extension — the two surfaces read and write one shared source of truth.
4. **Given** a visitor who is not signed in, **When** they open the web app, **Then** they see a public landing page explaining the product and cannot reach any saved postings, profile, usage, or plan data.
5. **Given** a visitor signing in on the web, **When** their Google email is not verified, **Then** access is refused with the same verified-email requirement as the extension, explained in plain language.

---

### User Story 2 - Search, Filter, Sort, and Compare the Library (Priority: P2)

Signed in on the web, the user works through a large library the way a small side panel never allowed: they search postings by text, filter by status, work arrangement, seniority, and fit-score range, and sort the results — then use the larger screen to view several postings side by side so they can compare fit at a glance.

**Why this priority**: The bigger screen is the main reason to use the web app for library work rather than the side panel. It depends on Story 1 (the library must be visible on the web first) but adds the differentiated value that makes the web surface worth opening. It is independently testable once the library renders.

**Independent Test**: With a library of many postings across different statuses, arrangements, seniorities, and fit scores, apply each search, filter, and sort and confirm the visible set matches the criteria; then open a side-by-side comparison of several postings and confirm their analyses show together.

**Acceptance Scenarios**:

1. **Given** a library of many saved postings, **When** the user searches by text, **Then** only postings matching the search are shown, and clearing the search restores the full set.
2. **Given** a library with postings of varied status, arrangement, seniority, and fit score, **When** the user filters by any one or a combination of status, work arrangement, seniority, and a fit-score range, **Then** only postings meeting all applied filters are shown, and the applied filters are visible and removable.
3. **Given** a filtered or full library, **When** the user chooses a sort order (e.g., by fit score or by when it was saved), **Then** the postings reorder accordingly.
4. **Given** several postings the user wants to compare, **When** they open a side-by-side comparison view, **Then** the selected postings' analyses are shown together in a layout that makes the larger screen's extra space useful for comparison.
5. **Given** applied filters or a search that match no postings, **When** the result set is empty, **Then** the user sees a clear empty-state message rather than a blank screen, and can clear the criteria to return.

---

### User Story 3 - View and Edit the Candidate Profile on the Web (Priority: P3)

The user opens their candidate profile on the web, reads it in a full-width editor, and edits it. Because it is the same single profile the extension uses, the edit is immediately the profile everywhere — the next analysis on either surface scores against the updated profile. In the same account area they can see their current plan, monthly usage, and renewal state.

**Why this priority**: Editing the one shared profile from the web is a direct, high-confidence demonstration of the two-way single-source-of-truth promise, and the profile drives fit scoring for every analysis. It depends on Story 1's shared identity and data but is otherwise self-contained.

**Independent Test**: Edit the profile on the web, confirm the same text appears in the extension, and confirm a subsequent analysis scores against the edited profile; also confirm the 20,000-character limit is enforced on the web and that plan, usage, and renewal state display correctly.

**Acceptance Scenarios**:

1. **Given** a signed-in web user with an existing profile, **When** they open the profile, **Then** they see the same single profile content that the extension uses.
2. **Given** the user editing their profile on the web, **When** they save a change, **Then** the change persists to the shared source of truth and appears in the extension without any separate copy or re-entry.
3. **Given** a user editing the profile on the web, **When** they attempt to save more than 20,000 characters, **Then** the save is prevented and they see a plain-language message about the 20,000-character limit — the same limit enforced in the extension.
4. **Given** a signed-in web user, **When** they open their account view on the web, **Then** they see their current plan, analyses used this month against their cap, and their renewal state — consistent with what the extension shows.

---

### User Story 4 - Analyze an Uploaded Document (Priority: P4)

Instead of analyzing a live web page, the user uploads a Word or PDF file that contains a job description or requirements. The web app extracts the document's text and produces the same structured analysis it would for a page — same fit scoring, same output shape — with the source shown as the uploaded document rather than a URL. If the file cannot be used, the user is told exactly why before anything is charged against their allowance; if the allowance is already used up, they get the same explicit exhaustion state as the extension.

**Why this priority**: This is the one genuinely new capability the web app adds beyond mirroring the extension. It is the reason a user might open the web app to do work they cannot do in the extension. It depends on the shared account, profile, and metering being in place (Stories 1 and 3) so the analysis scores correctly and counts correctly.

**Independent Test**: Upload a valid .docx and a valid .pdf containing a job description and confirm each produces a structured analysis with the same shape and fit scoring as a page-based analysis, sourced as an uploaded document; upload invalid files and confirm each is rejected with a specific reason and no allowance consumed; drive an account to its monthly cap and confirm the next upload shows the exhaustion state.

**Acceptance Scenarios**:

1. **Given** a signed-in user with allowance remaining, **When** they upload a .docx or .pdf (up to 10 MB) containing a job description, **Then** the document's text is extracted and a structured analysis is generated with the identical output shape and fit scoring as a page-based analysis, shown with the uploaded document (its filename) as the source instead of a URL.
2. **Given** a successful document analysis, **When** it completes, **Then** exactly one unit of the account's monthly analysis allowance is consumed — the same allowance shared with extension analyses (50 free / 300 premium).
3. **Given** an account that has used its full monthly analysis allowance, **When** the user uploads a document to analyze, **Then** the analysis is blocked and the user sees the same explicit "allowance used, resets on <date>" state with an upgrade path — never a silent failure or generic error.
4. **Given** an uploaded file that is not a .docx or .pdf, is larger than 10 MB, is unreadable or corrupt, is password-protected, or is image-only with no extractable text, **When** the user submits it, **Then** it is rejected before any allowance is consumed, with a plain-language explanation of what is wrong and which formats and size are accepted.
5. **Given** multiple document-analysis requests fired at once by an account with only one analysis left in its allowance, **When** they are processed, **Then** exactly one succeeds and the rest are blocked with the exhaustion message — the cap can never be exceeded by racing parallel requests.
6. **Given** any document analysis (successful or rejected), **When** it finishes, **Then** the uploaded document itself is not retained — only the extracted analysis and the document's filename are stored; a system-caused failure after acceptance consumes no allowance.

---

### User Story 5 - Save a Document-Sourced Analysis to the Library (Priority: P5)

Having analyzed an uploaded document, the user decides to keep it. They save the document-sourced analysis into their library, where it lives alongside their page-sourced postings — searchable, filterable, and visible in the extension too — subject to the same library size cap and the same at-cap refusal as any saved posting.

**Why this priority**: Saving is the step that turns a one-off document analysis into a durable, cross-surface library entry, closing the loop with Stories 1–2. It depends on Story 4 having produced an analysis and on the shared library from Story 1, and is exercised less than analysis itself, so it comes last.

**Independent Test**: Save a document-sourced analysis, confirm it appears in the web library and in the extension with the uploaded-document source; then fill a library to its cap and confirm the next save is refused with the cap message.

**Acceptance Scenarios**:

1. **Given** a completed document-sourced analysis, **When** the user saves it to their library, **Then** it becomes a saved posting in the shared library — appearing on the web and in the extension — with its source shown as the uploaded document (filename) rather than a URL, and it participates in search, filter, and sort like any other posting.
2. **Given** an account whose library is at its size cap (100 free / 1,000 premium), **When** the user tries to save a document-sourced analysis, **Then** the save is refused with the same at-cap message used elsewhere, naming the limit and offering to upgrade or remove postings — nothing is silently dropped.
3. **Given** a saved document-sourced posting, **When** the user views it later on either surface, **Then** the stored analysis and filename are present, but the original uploaded document is not available for download because it was never retained.

---

### Edge Cases

- A document contains far more text than a typical posting (e.g., a long multi-role requirements pack): the system handles the extracted text the same way it handles large page inputs, without failing silently.
- A .pdf that is a scan (images of text) with no selectable text is treated as image-only and rejected with the "no extractable text" explanation — no allowance consumed.
- A file has a .docx or .pdf extension but is actually a different or corrupt format: it is rejected as unreadable before any allowance is consumed.
- A document analysis is accepted and starts but the analysis service errors partway: the attempt consumes no allowance, and the uploaded document is still not retained.
- The same person is signed in on the web and in the extension simultaneously and both change the same posting or the profile: the shared source of truth resolves to one consistent stored value (last write wins) with no separate divergent copies; usage counts once per analysis regardless of surface.
- A signed-in web session expires or the account signs out elsewhere: the user is returned to the public/sign-in experience and never shown another account's data.
- A document upload is interrupted mid-transfer: the user can retry; a partially uploaded file is not analyzed and consumes no allowance.
- A user on the free tier whose library is over the free cap (from prior premium use or migration) tries to save a document-sourced analysis: the same read-only over-cap rule applies — the save is refused, nothing is deleted.

## Requirements *(mandatory)*

### Functional Requirements

#### Authentication & Access

- **FR-001**: The web app MUST require the same verified-email Google sign-in as the extension before exposing any account data, and MUST refuse access to Google accounts without a verified email with a plain-language explanation.
- **FR-002**: A signed-out visitor MUST see a public landing page describing the product and MUST NOT be able to reach any saved postings, profile, usage, or plan data.
- **FR-003**: Signing in on the web MUST resolve to the same account as the extension for the same Google identity, granting the same tier and entitlements with no web-only gating and no premium-only web features.

#### Shared Data / Single Source of Truth

- **FR-004**: The saved-postings library and the candidate profile MUST be a single server-side source of truth shared by the web app and the extension; there MUST be no separate web copy and no migration or import when a user first uses the web app.
- **FR-005**: Any posting saved, edited, or deleted, and any profile edit, made on one surface MUST be reflected on the other surface, so the web and the extension always read and write the same data.
- **FR-006**: Monthly usage, plan, and library contents MUST be consistent across the web and the extension; an analysis MUST count exactly once regardless of the surface that ran it.

#### Library Browsing & Views

- **FR-007**: A signed-in web user MUST be able to browse their full saved-postings library.
- **FR-008**: For each saved posting, the web app MUST be able to display the full stored analysis: fit score with matching, missing, and desired skills and with strengths and weaknesses; work arrangement with its evidence and confidence; salary; seniority; tech stack; status; and notes.
- **FR-009**: The web app MUST use the larger screen to offer views richer than the side panel allows, including comparing several postings side by side.

#### Search, Filter, Sort

- **FR-010**: Users MUST be able to search the library by text.
- **FR-011**: Users MUST be able to filter the library by status, by work arrangement, by seniority, and by a fit-score range, individually or in combination, with applied filters visible and removable.
- **FR-012**: Users MUST be able to sort the library.
- **FR-013**: When a search or filter combination matches no postings, the web app MUST show a clear empty state rather than a blank screen, with a way to clear the criteria.

#### Candidate Profile

- **FR-014**: Users MUST be able to view and edit their candidate profile on the web; it MUST be the same single profile the extension uses.
- **FR-015**: The web app MUST enforce the same 20,000-character limit on the profile as the extension, preventing a save that exceeds it and explaining the limit in plain language.

#### Plan, Usage & Renewal Visibility

- **FR-016**: The web app MUST show each signed-in user their current plan, analyses used this month against their cap, and their renewal state, consistent with what the extension shows.

#### Document-Upload Analysis

- **FR-017**: The web app MUST let a signed-in user upload a Word (.docx) or PDF document, up to 10 MB, containing a job description or requirements, and MUST extract the document's text for analysis.
- **FR-018**: A document-sourced analysis MUST produce the identical output shape and fit scoring as a page-based analysis, using the account's tier-appropriate analysis quality (same as extension analyses at that tier).
- **FR-019**: A document-sourced analysis MUST show its source as the uploaded document (its filename) rather than a URL.
- **FR-020**: The web app MUST reject a file before consuming any allowance when the file is not a .docx or .pdf, exceeds 10 MB, is unreadable or corrupt, is password-protected, or is image-only with no extractable text — giving a plain-language explanation of what is wrong and which formats and size are accepted.

#### Metering & Caps (shared with the extension)

- **FR-021**: A successful document-sourced analysis MUST consume exactly one unit of the account's shared monthly analysis allowance (50 free / 300 premium); system-caused failures after acceptance MUST consume no allowance.
- **FR-022**: The monthly analysis cap MUST be enforced atomically for document analyses: concurrent or parallel upload requests MUST NOT allow an account to exceed its cap.
- **FR-023**: When the monthly analysis allowance is exhausted, a document-analysis attempt MUST be blocked and show the same explicit "allowance used, resets on <date>" state with an upgrade path — never a silent failure or generic error.
- **FR-024**: Saving a document-sourced analysis MUST count against the same saved-postings library cap (100 free / 1,000 premium), and a save at the cap MUST be refused with the same at-cap message (naming the limit and offering to upgrade or remove postings), consistent with the over-cap read-only rule that applies to downgraded or migrated accounts.

#### Document Retention

- **FR-025**: The uploaded document itself MUST NOT be retained after analysis; only the extracted analysis and the document's filename MUST be stored. A saved document-sourced posting MUST NOT offer the original file for download.

### Key Entities

- **Web Session**: A signed-in web presence for an account, established by the same verified-email Google sign-in as the extension; grants access to that account's shared data and nothing else.
- **Saved-Postings Library** *(shared, existing)*: The single server-side set of a user's saved postings, each carrying its stored analysis, status, and notes; read and written identically by the web app and the extension. A posting's source is either a URL (page-based) or an uploaded document (filename).
- **Candidate Profile** *(shared, existing)*: The single profile (≤ 20,000 characters) that fit scoring runs against, editable from either surface.
- **Analysis** *(existing, extended)*: One structured analysis for an account — fit score with matching/missing/desired skills and strengths/weaknesses, work arrangement with evidence and confidence, salary, seniority, tech stack — now producible from either a page (URL source) or an uploaded document (filename source), with identical shape and quality per tier, consuming one unit of monthly usage when successful.
- **Uploaded Document**: A transient .docx or .pdf (≤ 10 MB) submitted for analysis; its text is extracted for analysis and the file is discarded — only the resulting analysis and the filename persist.
- **Monthly Usage & Plan** *(shared, existing)*: The account's tier, monthly analysis count against its cap, and renewal state — the same values surfaced in the extension, now also visible and consumed on the web.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of a signed-in user's existing saved postings and their stored analyses, plus their candidate profile, are visible on the web with no separate copy, import, or migration step.
- **SC-002**: A change made on one surface (save, edit, or delete a posting; edit the profile) is visible on the other surface on its next load in 100% of cases, with no divergent second copy.
- **SC-003**: On a library spanning multiple statuses, arrangements, seniorities, and fit scores, every search, filter (status, arrangement, seniority, fit-score range), and sort returns exactly the postings matching the criteria, verified across a representative test set.
- **SC-004**: A document-sourced analysis of a valid .docx or .pdf produces output with the identical field shape as a page-based analysis in 100% of cases, sourced as the uploaded document rather than a URL.
- **SC-005**: 100% of invalid uploads (wrong type, over 10 MB, unreadable, password-protected, or image-only) are rejected with a specific plain-language reason and consume zero analysis allowance.
- **SC-006**: The shared monthly analysis cap is enforced exactly for document analyses: in a test firing 20 parallel upload requests against an account with 1 remaining analysis, exactly 1 succeeds and the account's monthly successful analyses never exceed its cap.
- **SC-007**: 100% of users who hit their monthly cap while uploading a document see the explicit exhaustion message with the reset date and an upgrade path; zero silent failures in that path.
- **SC-008**: After any document analysis (successful, rejected, or failed mid-way), zero uploaded document files remain stored; only the extracted analysis and filename persist, verifiable in storage.
- **SC-009**: A save of a document-sourced analysis into a library at its cap is refused with the at-cap message in 100% of cases, with zero postings silently dropped and zero existing data deleted.
- **SC-010**: A signed-out visitor can reach zero bytes of account data (postings, profile, usage, plan); every attempt to reach account data without the verified Google sign-in is refused.

## Assumptions

- **Web analysis path is document-only**: The web app's sole new analysis entry point is document upload; analyzing a live URL/page remains the extension's job and is out of scope for the web app. The web app otherwise mirrors and manages the shared library and profile.
- **Same identity and entitlements as the extension**: The web app reuses the existing Google verified-email sign-in and the existing per-account model (features 002 and 003); it introduces no new sign-in method, no new plan, and no web-only tier. Free = 50 analyses/month and a 100-posting library; Premium = 300 analyses/month and a 1,000-posting library.
- **Tier-based analysis quality carries over**: A document-sourced analysis uses the same tier-appropriate analysis quality as extension analyses at that tier (premium is higher quality), with the same output shape and fit scoring.
- **Cross-surface conflict resolution**: When the same posting or profile is changed on both surfaces close together, the shared store resolves to one consistent value (last write wins); there is no offline merge or per-surface copy.
- **Same monthly reset and counting rules**: The shared monthly allowance, its reset moment, and what counts as one analysis are exactly as defined for the extension (feature 003); a document analysis is one analysis.
- **Accepted document formats and size**: Only .docx and .pdf are accepted, up to 10 MB each; other office/text formats and larger files are out of scope and rejected with guidance. Text extraction requires machine-readable text (no OCR of image-only documents at launch).
- **No document retention or download**: Uploaded files are used for extraction and then discarded; the product deliberately stores no copy, so document-sourced saved postings cannot offer the original file for download.
- **Foundational features exist**: The account-persistent-storage capability (feature 002) and the freemium/premium tier with atomic monthly metering and library caps (feature 003) exist and are the foundation this web app reads from and consumes.
- **Landing page scope**: The public landing page explains the product and routes to sign-in; marketing depth, pricing pages, and SEO beyond a basic explanatory page are out of scope for this feature.
