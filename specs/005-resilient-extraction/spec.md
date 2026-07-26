# Feature Specification: Resilient Page Extraction with User-Driven Fallbacks

**Feature Branch**: `005-resilient-extraction`

**Created**: 2026-07-25

**Status**: Draft — revised 2026-07-25 against the captured corpus baseline
(`extension/tests/fixtures/pages/README.md`). Three assumptions in the first
draft did not survive measurement; the corrections are marked **[measured]**.

**Input**: User description: "Make page extraction work on job sites it currently fails on, and give the user a way to drive extraction when automatic extraction still gets it wrong. Three workstreams: (1) wait for single-page-application job boards to finish rendering before extracting, instead of reading an empty shell on the first try; (2) harvest structured posting data the page already carries — microdata and embedded JSON state blobs used by the major applicant tracking systems — and replace the fixed `main`/`[role=main]`/`article` container guess with a text-density score, so pages with no semantic container still yield the posting body; (3) give the user two escape hatches — paste posting text directly into the panel, and point at the posting region on the page with an element picker whose choice is remembered per host, so the next posting on that host extracts correctly with no user action."

## Problem Context

Extraction today is a single synchronous pass ([`extractPage`](../../extension/lib/pageExtractor.ts)) fired once at analysis time from [`jobFlow.ts:231`](../../extension/services/jobFlow.ts#L231). It reads schema.org JSON-LD, then takes the longest text among `main`, `[role=main]`, and `article`, falling back to `document.body`. If the result has no JSON-LD and under 300 characters of text, the panel shows `thin-content`.

That pass has three failure modes, established by measurement rather than assumption:

**Timing.** A reported failure — `jobs.intuit.com/job/new-york/staff-software-engineer/27595/97097980048` — was reproduced in a real browser running the shipped extraction logic verbatim. Fully loaded, the page yields 1 JSON-LD `JobPosting` and ~11,900 characters of `main` text containing both the description and the qualifications: **extraction succeeds on a settled page.** The host is a Phenom People single-page application that hydrates `main` client-side, and extraction fires once with no readiness check, so a toolbar click during hydration reads an empty shell. The user sees "Not enough page content to analyze" on a page visibly full of content.

**[measured] The readiness predicate is wrong, not merely absent.** This is the correction that most changes the design. The current test — `jsonLd.length > 0 || mainText.length >= 300` — passes on JSON-LD *alone*, before any body text exists. On 3 of 6 fixtures it fires while `mainText` is still empty: Workday at 8 ms (text at 736 ms), Ashby at 10 ms (text at 369 ms), Phenom at 3314 ms (text at 3440 ms). A retry loop built on this predicate would return instantly with an empty `mainText` and be **no better than today**. Worse, on those pages the extension does not error at all today — JSON-LD alone satisfies the thin-content check, so the model silently receives structured fields and no posting body.

**[measured] Readiness must key on stability, not a threshold crossing.** On Phenom, body text crosses 300 characters at ~3440 ms but keeps growing until ~4280 ms, ending at ~11,900. Returning at first crossing captures a fraction of the posting. The slowest fixture settles at **4883 ms**, which is the floor for any readiness budget — the first draft's implied ~3 s would have missed the very page that motivated the feature.

**Container blindness. [measured]** The three-selector guess has no fallback between "a semantic container exists" and "swallow the entire body". **3 of 6 corpus fixtures — Ashby, Lever, Workday — land on the body path.** On Lever the selected text opens with the cookie-consent banner ("Cookie Policy🍪DenyAccept…"); on Workday with "Skip to main content… page is loaded". The analysis still runs, on diluted input, so this degrades silently. It is more prevalent than the first draft assumed and is the single broadest quality problem in the corpus.

**Signal blindness.** Microdata (`itemtype="…/JobPosting"`) is unread, though JSON-LD covering the same facts is usually present alongside it.

**[measured] The state-blob premise did not survive.** The first draft asserted that most applicant tracking systems ship the complete posting as JSON before rendering it — Phenom's `window.phApp.ddo`, Next.js `__NEXT_DATA__`, Nuxt's `__NUXT_DATA__`, Remix's `__remixContext`, generic `window.__INITIAL_STATE__` — and treated harvesting it as the highest-leverage coverage move. A scan of every global and inline script across the corpus found **no usable posting payload on any fixture**. Greenhouse, the one fixture with no JSON-LD and therefore the case where a blob would matter most, exposes `__remixContext` (19,958 B) that verifiably does not contain the posting body. That premise is withdrawn; blob harvesting survives only as a narrow, evidence-gated requirement (FR-009).

No amount of automatic improvement covers every site. The feature therefore pairs the automatic work with two user-driven paths, the second of which converts a single user correction into a durable per-host adapter.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Extraction Waits for the Page to Be Ready (Priority: P1)

A user opens a job posting on a single-page-application job board and clicks the extension icon while the page is still hydrating. Instead of an immediate "not enough content" error, extraction waits for the posting to appear and analyzes it. The user perceives only the normal analyzing spinner.

**Why this priority**: It is the dominant, reproducible, user-invisible failure class; it requires no new UI, no new permissions, and no payload change; and every other workstream is measured against a baseline that is only meaningful once timing noise is removed. Shipped alone it already fixes the reported Intuit failure and every site like it.

**Independent Test**: Load a hydrating SPA posting and trigger analysis at first paint, before `main` is populated. Confirm the analysis completes against the hydrated content. Separately, confirm a genuinely empty page still errors, within the readiness budget, rather than hanging.

**Acceptance Scenarios**:

1. **Given** a job posting on a client-rendered board, **When** the user triggers analysis before the posting content has rendered, **Then** extraction waits for the content and analyzes the full posting.
2. **Given** a page whose content is already present when analysis is triggered, **When** extraction runs, **Then** it returns on its first attempt with no added delay.
3. **Given** a page that never yields usable content, **When** the readiness budget expires, **Then** the user sees the thin-content error within that budget, and the message states that the page appeared to still be loading and offers a retry.
4. **Given** extraction is waiting for readiness, **When** the user cancels, **Then** waiting stops immediately and no analysis request is sent.
5. **Given** a page that becomes ready partway through the budget, **When** it does, **Then** extraction returns at that moment rather than waiting out the full budget.

---

### User Story 2 - Structured Data and Scored Containers Widen Coverage (Priority: P2)

A user analyzes postings across a range of applicant tracking systems. On hosts that embed the posting as JSON, the analysis is grounded in that exact data. On hosts with no semantic container, the panel still gets the posting body rather than the whole page.

**Why this priority**: It is the broadest coverage-per-line change, and it improves accuracy on pages that already "work" today by feeding the model the posting instead of the posting plus chrome. It depends on Story 1 only in that measurement is unreliable without it.

**Independent Test**: Run a fixture corpus of saved postings from the major applicant tracking systems through extraction and confirm both the share of pages yielding usable content and the share yielding structured data rise against the pre-change baseline, with no regression on pages that already succeeded.

**Acceptance Scenarios**:

1. **Given** a page embedding posting data in a recognized state blob, **When** extraction runs, **Then** the posting subtree is harvested and sent alongside the page text, identified by its source.
2. **Given** a page marked up with `JobPosting` microdata and no JSON-LD, **When** extraction runs, **Then** the microdata is harvested as structured data.
3. **Given** a page with no `main`, `[role=main]`, or `article`, **When** extraction runs, **Then** the scored container selection returns the posting body, and navigation, related-jobs lists, and footers are absent from it.
4. **Given** a page where a semantic container already yields the posting cleanly, **When** extraction runs, **Then** the selected text is unchanged from the current behavior.
5. **Given** a page whose state blob is very large, **When** it is harvested, **Then** only the posting-shaped subtree is sent and the structured payload stays within its size cap.
6. **Given** structured data was harvested, **When** the analysis returns a work arrangement, **Then** evidence quoted from that structured data is accepted rather than downgraded to `unspecified`.

---

### User Story 3 - Paste Posting Text Directly (Priority: P3)

A user is looking at a posting the extension cannot read at all — a login-walled board, a PDF, an emailed description, a page behind a bot check. They copy the text, paste it into the panel, and get the same analysis as any page-based one.

**Why this priority**: It is the unconditional escape hatch: it depends on nothing, cannot be defeated by any site, and bounds the worst case for every extraction failure the automatic work does not cover. It is also the smallest of the four stories.

**Independent Test**: Open the paste composer from the header button with no readable page open at all, paste a job description, confirm the analysis returns with the same fields and fit scoring as a page analysis, and confirm it can be saved to the library and found again. Separately, confirm a draft survives closing and reopening the composer, switching tabs, and navigating the underlying page.

**Acceptance Scenarios**:

1. **Given** a user with posting text on the clipboard, **When** they paste it into the panel and analyze, **Then** they get the same analysis shape and fit scoring as a page-based analysis.
2. **Given** a pasted analysis, **When** the user saves it, **Then** it enters the library identified as paste-sourced rather than by URL, and is distinguishable from page-sourced postings.
3. **Given** pasted text below the usable minimum or above the content cap, **When** the user tries to analyze, **Then** they are told which it is and what to do, before any analysis allowance is consumed.
4. **Given** a pasted analysis, **When** it completes, **Then** it counts against the same monthly allowance as any other analysis, and the allowance-exhausted state behaves identically.
5. **Given** the same text pasted twice, **When** the second analysis is requested, **Then** it resolves consistently against the first rather than creating an ambiguous duplicate library entry.

---

### User Story 4 - Scope the Page by Hand, and the Host Is Learned (Priority: P4)

Automatic extraction picks the wrong region on a host the user visits often. The user narrows it by hand in whichever way suits them — choosing "Analyze a region" and either pointing at the posting body on the page or choosing it from the ranked list in the panel, or simply highlighting the posting and right-clicking "Analyze selection" — and the analysis re-runs against that region. The next posting they open on that host extracts correctly with no action at all.

**Both mechanisms scope the *current page*.** Their results are that page's analysis, identified by its canonical URL, replacing whatever automatic extraction produced. This is what separates them from paste (Story 3), which produces a posting with no URL at all — and why they live on the "This Page" surface and the page's own context menu, not behind the paste button. It is also why they are unavailable in exactly the case paste exists for: a page the extension cannot read cannot be picked from or selected in.

**Why this priority**: It is the only path that turns a single user correction into durable coverage, but it is the largest build and it depends on the paste escape hatch already existing for the cases where neither picking nor selecting is possible. Last of the four for effort reasons, not value reasons.

**Independent Test**: On a host where automatic extraction picks the wrong region, scope it by hand (either mechanism), confirm the analysis re-runs against that region; then open a different posting on the same host and confirm it extracts from the equivalent region with no user action.

**Acceptance Scenarios**:

1. **Given** an analysis that picked the wrong region, **When** the user starts region selection from the "This Page" surface, **Then** hovering the page highlights the block under the cursor and shows what will be captured.
2. **Given** region selection is active, **When** the user clicks a block, **Then** it closes and the analysis re-runs against that block's text.
3. **Given** region selection is active, **When** the user presses Escape or clicks the panel, **Then** it closes with no change to the current result.
3a. **Given** a user who cannot use a pointing device, **When** they start region selection, **Then** the panel lists the candidate regions, arrow keys move between them, the page highlights the current one, and Enter commits it — the whole flow completing without a pointer.
4. **Given** text highlighted on a job posting, **When** the user right-clicks and chooses "Analyze selection", **Then** the analysis runs against the full highlighted text — not a truncated copy — whether or not the panel was already open.
5. **Given** a region scoped by either mechanism, **When** the analysis runs, **Then** it is a fresh analysis of the current page: any previously stored or cached analysis of that URL is bypassed and then replaced, never returned in its place.
6. **Given** a region scoped by either mechanism, **When** the analysis succeeds, **Then** the user is offered the choice to reuse that region on this host in future, and declining leaves nothing learned.
7. **Given** a region stored for a site, **When** the user later analyzes a different posting on that site, **Then** the stored region is used automatically and the panel says so.
8. **Given** a stored region that no longer matches the page — the site redesigned, or nothing matches — **When** extraction runs, **Then** it falls back to automatic extraction without an error, and the stale region is discarded after repeated misses.
9. **Given** a stored region, **When** the user wants it gone, **Then** they can clear it for the current site, and clear every site's region, from the options page.
10. **Given** a picked or selected region yielding less than the usable minimum, **When** the user commits it, **Then** they are told it is too small and are left able to try again.

---

## Requirements *(mandatory)*

### Functional Requirements — Readiness (Story 1)

- **FR-001** **[measured — rewritten]**: The readiness test MUST key on extracted body text reaching the usable minimum. Presence of structured data MUST NOT by itself satisfy readiness, because it is routinely available before the posting body renders (3/6 fixtures). The current `jsonLd.length > 0 || text >= minimum` predicate MUST NOT be reused as the retry condition.
- **FR-002** **[measured — rewritten]**: Extraction MUST return once body text has cleared the minimum *and* stopped growing for a **400 ms** stability window — not on first crossing, which on the motivating fixture captures roughly 3% of the posting. A page whose text is stable on the first attempt MUST incur no more than that one 400 ms stability window of delay.
- **FR-003** **[measured]**: The readiness budget MUST be at least the corpus's slowest observed settle time (4883 ms) plus headroom, fixed at **6000 ms**, and the worst case MUST stay inside the analysis latency budget (constitution IV / QG-4). A budget under ~3 s is disqualified: it fails the fixture that motivated the feature.
- **FR-004**: Re-attempts MUST be driven by observed page change, not by fixed polling alone, so a page that settles early is not made to wait. A page whose content is already complete and unmutated at the moment analysis is triggered MUST return via a fast path of roughly **150 ms**, not pay the 400 ms stability window meant for pages still rendering.
- **FR-004a** **[measured]**: Extraction MUST NOT return structured data with an empty or below-minimum body text while the readiness budget remains, since that is the silent-degradation path 3/6 fixtures take today.
- **FR-005**: When the budget expires without usable content, the resulting error MUST distinguish "the page was still loading" from "this page has no content", and MUST remain retryable.
- **FR-005a**: The retry offered after a budget expiry MUST re-run extraction from the beginning, including a fresh readiness cycle. Re-presenting the same expired result would make the action dishonest, and a page that was mid-hydration is exactly the case where trying again works.
- **FR-006**: A user cancel during the readiness wait MUST stop it immediately and send no analysis request.
- **FR-006a**: A labeled cancel control MUST be present for the whole readiness wait, not only once the model call starts. The wait is now the longer of the two phases on a slow page, and it is the phase a user is most likely to want out of. It is the same control, in the same place, across both phases — the user cannot tell readiness from the model call (see Progress indication below), so a control that moved or changed between them would be reacting to a distinction the user never perceived.
- **FR-006b**: Cancelling MUST leave the page immediately re-analyzable. A cancelled attempt's in-flight extraction MUST NOT suppress or corrupt the result of the next one — the abandoned injection resolves after the new request has started, and must be inert rather than merely ignored once.
- **FR-006c**: A user who cancels during the readiness wait and immediately re-triggers analysis on the same page MUST get a normal, full-budget attempt. Cancelling MUST NOT leave any per-page lockout, cooldown, or shortened retry behind — FR-006b already requires the abandoned attempt be inert; this requirement is about the *next* attempt starting clean, not merely surviving the previous one.
- **FR-007**: Extraction MUST report readiness provenance — attempts made and time spent — for diagnosis and for the eval harness.

- **FR-007a** **[QG-3 resolved]** **Progress indication.** A single indicator covers readiness and analysis together, using the existing "Analyzing page…" copy, and MUST appear within constitution III's 300 ms threshold of the moment *any* analysis is triggered — a page load, a scoped picker or selection commit (FR-026), or a paste submission (FR-017) — not only when the model call begins, otherwise a 6 s readiness wait (or an equivalent wait for a re-run analysis) is a silent frozen UI, which constitution III forbids outright. The two phases of a page analysis are deliberately *not* distinguished in copy: the user cannot act differently on "waiting for the page" versus "waiting for the model," so naming the split would trade stable vocabulary for a distinction without a decision behind it. This is not an inaccuracy — the copy describes the analysis as a whole, and that description is true throughout both phases.

- **FR-007b** **[QG-3 resolved]** **Error-card actions.** The thin-content card carries three actions once Stories 3 and 4 ship: Retry, "Analyze a region", and a paste shortcut. They MUST NOT appear as three equal-weight actions in one block. Retry MUST be the primary action (a filled button) — it is free and needs no further input from the user. "Analyze a region" MUST be a secondary action (an outlined or text button) — it requires the user to pick or select something first. The paste shortcut MUST be the quietest of the three, a plain-text link rather than a button, since paste (FR-017e) is the remedy for pages the other two cannot fix — a login wall, a PDF, a bot check — not a first response to an ordinary parsing miss.

### Functional Requirements — Signals and Containers (Story 2)

- **FR-008**: Extraction MUST harvest `JobPosting` microdata in addition to JSON-LD.
- **FR-009** **[measured — downgraded]**: Blob harvesting MUST NOT be built against the named conventions on faith; none was found to carry posting data on any corpus fixture. Before any blob-harvesting code ships, a corpus fixture MUST be exhibited whose posting body is recoverable *only* from a state blob. If no such fixture can be produced, this requirement is dropped and the effort moves to FR-012. The discovery scan in `extension/scripts/corpusProbe.ts` is the gate.
- **FR-010**: Each harvested structured source MUST carry its own provenance so the analysis prompt and any future debugging can tell JSON-LD from microdata from a state blob.
- **FR-011**: Harvested structured data MUST be pruned to the posting-shaped subtree and MUST be capped at **20,000 characters** total (`JSON.stringify(structuredSources).length`); the cap MUST be enforced client-side before transmission, and an over-cap source MUST be dropped whole rather than truncated mid-object.
- **FR-012** **[measured — promoted]**: Container selection MUST score candidates by text density and link density rather than falling through to `document.body`. This is now the feature's highest-value automatic change: 3 of 6 fixtures take the body path today, admitting cookie banners and skip-links into the model input. Scoring MUST apply whenever the semantic path yields nothing *or* yields a container that scores worse than a scored candidate — not only when `main`/`[role=main]`/`article` are absent entirely.
- **FR-013**: Container selection MUST NOT change the selected text on pages where the existing semantic-container path already yields the posting.
- **FR-014**: The analysis request payload MUST carry harvested structured sources in addition to the existing JSON-LD field, and MUST remain accepted by the existing request validation.
- **FR-015**: The backend evidence check MUST treat all transmitted structured sources as valid quotable input, so evidence drawn from harvested data is not downgraded to `unspecified`.
- **FR-016**: The backend prompt MUST state the relative trust of each structured source kind, preserving today's rule that page body text wins when it contradicts structured data.

### Functional Requirements — Paste (Story 3)

- **FR-017**: The panel MUST offer a path to analyze pasted posting text with no readable page required, triggered by a **persistent action button in the panel header row, beside the "This Page" and "Saved" tabs** — a button, not a third tab.
- **FR-017a**: The button MUST NOT be a child of the tab bar's `role="tablist"` element. Every child of a tablist is announced as a tab; a non-tab button inside it misrepresents the panel's structure to assistive technology. The header row is a flex container holding the tablist and the button as siblings. Keyboard traversal of the header row MUST follow that structure: Tab moves focus into and out of the row as one stop into the tablist plus one stop at the button (standard `Tab` order across sibling widgets), while the arrow keys move only between the tabs *inside* the tablist, per the standard tablist pattern — the button is never a target of the tablist's arrow-key handling.
- **FR-017b**: Activating the button MUST open a paste composer occupying the panel body, with the tab panels hidden while it is open — and inert: the "This Page" and "Saved" tab controls MUST NOT be reachable while the composer is open, whether by pointer or keyboard, since a tab click while their panel is hidden would be a no-op that looks like a bug. The button MUST expose its open state (`aria-pressed`), and the composer MUST be dismissible by Escape and by an explicit close control, returning the user to the previously selected tab. The composer MUST be an accessibly-labeled region (e.g. `role="region"` with an accessible name), so a screen-reader user perceives it opening as more than the header button's `aria-pressed` flipping. On open, keyboard focus MUST move into the composer (its text area); on close by either Escape or the close control, focus MUST return to the header button.
- **FR-017c**: Opening, closing, and reopening the composer MUST preserve the draft within a session, as MUST switching between "This Page" and "Saved" while it is closed. The composer's empty state MUST show placeholder guidance telling the user what to paste (e.g. "Paste a job posting…") rather than a bare empty text area.
- **FR-017d**: Page navigation and tab switches MUST NOT close the composer or clear its draft. Those events invalidate a page analysis, but pasted text is independent of any page — evicting the user mid-paste would be a defect introduced purely by the entry-point wiring.
- **FR-017e**: The extraction-failure and no-access states SHOULD offer a contextual shortcut that opens the composer directly. This is a convenience rather than the only door, but it is the sole remedy for `no-access` pages (Chrome's own pages, the Web Store), which today dead-end with no path forward. The shortcut MUST open the same composer the header button opens — same label for the action ("Paste text"), same empty-or-draft state — so the two entry points read as one door, not two.
- **FR-017f**: If the monthly analysis allowance is already exhausted when the composer is opened, the composer MUST show the allowance-exhausted state immediately, before the user starts typing — not defer it to submission of a draft the user has already invested time composing.
- **FR-018**: Pasted text MUST be validated against the same usable minimum and content cap as page text, with the outcome reported before any analysis allowance is consumed.
- **FR-018a**: The refusal for a bound violation — pasted text below the usable minimum or above the content cap (this requirement), or a scoped region below the usable minimum (FR-034) — MUST state the applicable number (e.g., "at least 300 characters" / "under 40,000 characters"), not merely that a bound was crossed, and the two refusals MUST share the same sentence shape and the same kind of next action ("add more text" for too little, "trim it" or "select a smaller block" for too much), so a user who hits one and later the other reads it as one rule rather than two unrelated messages.
- **FR-019**: A paste-sourced analysis MUST produce the same analysis shape and fit scoring as a page-sourced one.
- **FR-020**: A paste-sourced analysis MUST be identified as paste-sourced wherever a posting's source is shown or stored, rather than being attributed to a URL. This binds every surface that shows a posting's source today: the panel's Saved tab, the options page, and the web companion app's library (`web/src/pages/Library.tsx`), which already branches on `source === "document"` for feature 004's document-sourced postings and MUST gain an equivalent `"paste"` branch — this is a deviation from this feature's plan.md, which listed `web/` as unaffected; tasks.md T057 already tracks it.
- **FR-020a**: Wherever a list of postings shows an identifying label per entry, a paste-sourced entry — having no URL and no filename — MUST show a label derived from its content: the extracted job title if analysis produced one, otherwise a short excerpt of the pasted text. It MUST NOT show a blank, a URL-shaped placeholder, or the raw synthetic key (FR-021).
- **FR-021**: A paste-sourced analysis MUST be storable in the library under a stable synthetic identity derived from its content, so repeat pastes of the same text resolve consistently.
- **FR-022**: A paste-sourced analysis MUST count against the same monthly allowance and library cap as any other analysis, with identical at-cap behavior.

### Functional Requirements — Page Scoping and Learned Hosts (Story 4)

Two mechanisms, one outcome. Requirements below say "scoping" where they bind both.

**Picker**

- **FR-023**: The user MUST be able to start region selection on the current page from the **"This Page" surface**, reachable both from a failed extraction and from a successful-but-wrong one. It MUST NOT be placed behind the paste button (FR-017), whose purpose is off-page input.
- **FR-024**: The pointer path MUST highlight the block under the cursor and indicate what will be captured before the user commits. "Indicate what will be captured" MUST be observable, not left to implementation taste: at minimum the highlighted block's text length (e.g. a small character count near the cursor), matching the same measure the panel list shows per FR-024b, so a hovering mouse user and a keyboard user relying on FR-024b's list see the same fact about a candidate.
- **FR-024a** **[WCAG 2.1.1]**: Region selection MUST be completable with the keyboard alone. Because the panel and the page are separate browsing contexts, an in-page overlay cannot receive keyboard focus from a control in the panel — so the keyboard path MUST live **in the panel**: the candidate regions are listed there, arrow keys move between them, the page highlights the current candidate as a supplement, and Enter commits. A pointer-only picker does not conform and MUST NOT be the sole path.
- **FR-024b**: Each candidate in the list MUST be identifiable without seeing the page — at minimum a label, its text length, and a leading excerpt — because a screen-reader user cannot rely on the in-page highlight. The list MUST be ordered by the FR-012 score and MUST include every candidate the scorer considered, not only the winner; restricting the list to the automatic choice would offer the user only the region that already failed them. Moving between candidates, by arrow key in the panel or by hover on the page, MUST be announced to assistive technology (e.g. an `aria-live` region naming the current candidate's label), matching the sighted user's in-page highlight with an equivalent for a screen-reader user.
- **FR-024c** **[WCAG 1.4.1, 1.4.11]**: The in-page highlight MUST be perceivable without relying on color alone — a border or outline shape change, not a color shift by itself — and MUST meet a 3:1 contrast ratio against the adjacent page content it is drawn over, per WCAG 1.4.11's requirement for non-text UI. Because the highlight is drawn over arbitrary third-party page content whose own colors are not controlled, it MUST use a rendering technique (e.g. a mixed-blend-mode outline, or a drop-shadow ring) that maintains that contrast rather than a flat color chosen once and assumed sufficient.
- **FR-025**: Region selection MUST be dismissible without side effects via Escape and via leaving the page. "Without side effects" means the page is left exactly as the overlay found it: dismissal MUST return keyboard focus to the control that started it, MUST restore the scroll position the page had when selection started, and MUST remove any styling the overlay applied to the page (highlight outlines, dimming, cursor changes).

**Analyze selection**

- **FR-023a**: The user MUST be able to highlight text on a page and analyze it from the browser's context menu, without the panel being open beforehand.
- **FR-023b**: The analyzed text MUST be the full selection read from the page. The context-menu payload's own selection text MUST NOT be used as the source, as it is subject to truncation and job postings routinely exceed it.
- **FR-023c**: A selection MUST be reducible to a region for learning purposes via its range's common ancestor, so that selecting and picking feed the same learning path rather than existing as two unrelated mechanisms.

**Common to both**

- **FR-026**: Committing a scoped region MUST re-run the analysis against that region's text, as an analysis **of the current page** — identified by the page's canonical URL, not by a synthetic identity.
- **FR-026a**: A scoped analysis MUST bypass the saved-library and session-cache lookup and then replace the stored result. Without this, scoping a page that already has a stored analysis silently returns the previous, wrong analysis and the user's correction appears to do nothing.
- **FR-026b**: Learning MUST be offered after a successful scoped analysis, not imposed by the act of scoping. A one-off correction on an unusual posting MUST NOT silently teach a selector that then misapplies to every posting on that host. The offer MUST be presented inline in the "This Page" result — not a transient toast that can be missed, since accepting or declining has a lasting effect the user should make deliberately — and MUST remain visible and actionable until the user accepts, declines, or navigates away; navigating away without choosing MUST be treated as declining (nothing is learned), consistent with FR-026b's own "declining leaves nothing learned" default. On acceptance, the panel MUST show a brief confirmation naming the site (in the vocabulary's "site" term, e.g. "Will always analyze this region on jobs.example.com"), so the user knows what was just made to stick.
- **FR-027**: A scoped region MUST be reduced to a selector that is stable across postings on the same host; machine-generated class names MUST NOT be relied on.
- **FR-028**: A learned selector MUST be stored per host, locally, and MUST be applied ahead of automatic extraction on subsequent analyses of that host.
- **FR-029**: A learned selector that fails to match, or that yields less than the usable minimum, MUST fall through to automatic extraction silently, and MUST be retired after **3** consecutive misses. Retirement itself MUST also be silent — the same falling-through-without-error behavior FR-029 already requires for a single miss, extended to the point the selector is discarded. A per-retirement notice would call attention to a background bookkeeping detail the user did not ask about and cannot act on differently than they already can from the options page (FR-031); the options page remains the place to check what is currently learned.
- **FR-030**: The number of learned hosts MUST be capped at **200**, with least-recently-used eviction.
- **FR-031**: The user MUST be able to clear the stored region for the current site and clear all stored regions, from the options page. The options page's list of learned hosts MUST show, per row, at minimum the site (FR-032's vocabulary) and a control to clear that row; clearing MUST take effect immediately without a confirmation dialog, matching the reversible, low-stakes nature of the action — a cleared site simply falls back to automatic extraction, and a future correction re-teaches it in one action (FR-026b).
- **FR-032**: The panel MUST indicate when a result came from a stored region rather than automatic extraction, in the vocabulary fixed below (e.g. "Always analyzing this region on jobs.example.com"). The indicator MUST persist for as long as that result is shown — it is not a transient toast — and MUST be a plain-text label, not an actionable control; undoing the always-analyze choice happens on the options page (FR-031), not from the indicator itself.
- **FR-032a**: The learned-region indicator (FR-032) MUST carry an accessible name equivalent to its visible text, not rely on visual styling alone to convey "this came from a stored region." Where scoping controls are disabled per FR-036a, the stated reason MUST be programmatically associated with the control (e.g. `aria-describedby`), not shown only as adjacent visual text, so it is available to a screen-reader user encountering the disabled control directly.
- **FR-033**: Learned selectors MUST NOT leave the browser; no selector, host, or scoped content may be transmitted to the backend under this feature.
- **FR-034**: A scoped region yielding less than the usable minimum MUST be refused with an explanation, leaving the user able to try again without restarting the flow. The explanation MUST follow FR-018a — state the minimum as a number and share wording with the paste-side refusal.

### Cross-Cutting Requirements

- **FR-035**: Every extraction result MUST record which strategy produced it — learned selector, picked region, selection, structured data, semantic container, scored container, body fallback, or paste — and this provenance MUST be available to the eval harness.
- **FR-036**: The feature MUST NOT request any new **host** permissions in store or release builds, and MUST operate within the existing `activeTab` grant model. It MAY add the `contextMenus` API permission, which FR-023a requires; that is a manifest addition subject to Web Store review but grants no site access and does not weaken the extension's permission posture.
- **FR-036a**: Both scoping mechanisms depend on page access and MUST degrade honestly where it does not exist. On a page the extension cannot read, they MUST be unavailable with a stated reason rather than present-and-broken, and the user MUST be pointed at paste (FR-017), which is the only path that works there. The stated reason MUST distinguish its actual cause rather than use one generic message for both: a page the extension has no access to at all (a `no-access` page such as a Chrome internal page or the Web Store) gets a reason naming that; a page the extension *can* read but where scoping has separately failed (e.g. a shadow-root or cross-origin-iframe selection, per Edge Cases) gets a reason naming that instead. This requirement is only satisfiable once Story 3 ships — pointing the user at paste is a dead end if paste does not yet exist — so Story 4 MUST NOT ship its honest-degradation path ahead of Story 3 (plan.md's phased delivery already orders them this way).
- **FR-037**: All new error and empty states MUST be plain language with a stated next action, per constitution III. This binds, at minimum: the "still loading" thin-content variant (FR-005), the below-minimum and above-cap paste refusals (FR-018a), the below-minimum scoped-region refusal (FR-034), the disabled-scoping-with-reason state (FR-036a), the paste composer's empty state (FR-017c), and the shadow-root/cross-origin-iframe scoping failure (Edge Cases) — a reviewer checking FR-037 for coverage can check this list without deriving it from tasks.md.
- **FR-038**: No new runtime dependency may be added to the extension bundle for container scoring; the scoring heuristic MUST be self-contained.

### User-Facing Vocabulary

Constitution III requires stable terminology. Four terms were competing for one
concept across FR-023, FR-028–FR-032 and the options page; this fixes them.
**These bind user-visible copy only** — code, storage keys, contracts, and
provenance values keep `learnedSelectors` / `learned:<host>` /
`strategy: "learned-selector"` unchanged, so nothing downstream churns.

| Concept | User-facing | Never shown to the user |
|---|---|---|
| The part of the page being analyzed | **region** | selector, container, node, subtree |
| The site it belongs to | **site** | host, origin, domain |
| Doing the thing | **analyze** ("Analyze a region", "Analyze selection") | pick, scope, extract |
| Making it stick | **always** ("Always analyze this region on jobs.intuit.com") | learn, remember, save, teach |

"Analyze" is the verb this product already uses everywhere — the context menu,
the spinner, the action itself — so region correction reads as the same action
narrowed, not a new feature with its own jargon. Persistence is carried by
**"always"** rather than a fourth noun: there is no "learned region" or
"remembered region" in the UI, only a region this site always analyzes.

**"Saved" is reserved.** The panel already has a Saved tab for saved postings;
a "saved region" would collide with it.

### Key Entities

- **Structured source**: One harvested block of posting data, carrying its kind (JSON-LD, microdata, or the specific state-blob convention), its pruned payload, and its size after pruning.
- **Extraction provenance**: The record of how a given extraction resolved — strategy used, readiness attempts, elapsed time, whether the readiness budget expired, and whether a learned selector was tried and missed.
- **Learned host selector**: A per-host record of a user-taught selector — from a pick or from a selection's common ancestor — when it was learned, and its consecutive-miss count, subject to a capped, least-recently-used store.
- **Scoped region**: A user-designated part of the current page, produced by the picker or by a text selection. It carries the page's own identity, not a synthetic one, and its analysis supersedes any stored analysis of that URL.
- **Paste-sourced posting**: A posting whose content came from user-pasted text, identified by a stable content-derived synthetic key rather than a URL. Distinct from a scoped region in exactly this respect.

## Success Criteria *(mandatory)*

Baseline captured 2026-07-25 over 6 fixtures; the table and aggregates live in `extension/tests/fixtures/pages/README.md` and regenerate via `npx tsx scripts/baselineReport.ts`.

- **SC-001**: The `phenom-intuit` fixture analyzes successfully when analysis is triggered during hydration, with no user action, on the first try — with the full posting (~11,900 chars), not the ~300-char prefix available at 3440 ms.
- **SC-002**: Body-fallback container selection drops from **3/6** to at most 1/6, and no fixture's selected text shrinks below its baseline. Specifically: `lever-palantir` no longer opens with the cookie-consent banner, and `workday-nvidia` no longer opens with "Skip to main content".
- **SC-003**: The corrected readiness predicate never returns structured data with below-minimum body text — demonstrated on the `jsonld-early` hydration fixture, where JSON-LD is present at 0 ms and body text arrives at 1500 ms. (The corpus's **3/6** "predicate passed before text" figure is a capture-time timeline measurement and has no post-change counterpart; it establishes the problem's prevalence, not the fix.)
- **SC-003a**: `thin-posting-control` still produces the thin-content error. Any change that makes it "succeed" is fabricating content and fails this criterion.
- **SC-004**: On pages that are already settled when analysis is triggered, added latency from readiness checking stays within the ~150 ms fast path (FR-004) — negligible relative to the analysis call, and a reviewer can check this against the fixed number rather than a subjective read of "negligible."
- **SC-005**: Worst-case extraction time — a page that never becomes ready — stays within the readiness budget, and total analysis time stays within the constitution IV ceiling.
- **SC-006**: On corpus pages with no semantic container, the selected text excludes navigation, related-jobs lists, and footers, verified against per-fixture expectations.
- **SC-007**: A user can go from "this page cannot be analyzed" to a completed analysis via paste without leaving the panel.
- **SC-008**: After one scoped correction on a host — by either mechanism — a second, previously unseen posting on that host extracts from the equivalent region with no user action.
- **SC-008a**: Scoping a page that already has a stored analysis returns the newly scoped result, never the previously stored one.
- **SC-008b**: A selection longer than the context-menu payload's truncation limit is analyzed in full.
- **SC-009**: A learned selector that stops matching produces a normal automatic-extraction result, never a user-visible error.
- **SC-010**: Arrangement accuracy on the existing posting eval does not regress, and arrangement downgrades caused by evidence falling outside the transmitted input drop to zero on fixtures with harvested structured data.
- **SC-011**: Every step of region selection — starting it, choosing among candidates, committing, and accepting or declining the always-analyze offer — completes with the keyboard alone, verified by a test that never dispatches a pointer event.

### Measurement Corpus — built

Exists at `extension/tests/fixtures/pages/`, distinct from the model-accuracy corpus at `functions/tests/fixtures/postings/` consumed by [`evalPostings.ts`](../../functions/scripts/evalPostings.ts). Six fixtures covering Phenom People, Greenhouse, Lever, Ashby, Workday, and SmartRecruiters (as the thin-posting control). Captured from live boards by `extension/scripts/captureCorpus.ts`, which resolves postings from each board's listing page rather than hard-coding posting URLs, and rejects stub postings that would silently become fixtures proving nothing.

Two gaps are open and accepted: **iCIMS** is unrepresented (the documented URL pattern 404s on every company tried), and **SmartRecruiters** appears only as a stub posting (every posting sampled on the reachable board is a stub).

One structural limitation matters for planning: **the snapshots cannot regression-test Story 1.** A saved DOM is ready by construction. The corpus sets the readiness budget from live timings; Story 1's automated test needs a synthetic delayed-hydration fixture, which is planning work, not capture work.

## Edge Cases

- The user triggers analysis, then navigates away mid-readiness-wait: the `activeTab` grant dies with the navigation; the wait must end without an orphaned error.
- A page that renders content and then replaces it (a skeleton that yields to a "job no longer available" state): readiness must not latch on the skeleton and return stale text.
- Infinite-scroll or lazy-loaded description sections: content grows for the entire budget and never "settles"; the budget must bound this rather than waiting for quiet that never comes.
- A state blob containing many postings (a list page that also carries detail payloads): pruning must not silently pick an arbitrary one; the existing multiple-postings notice is the model for surfacing this.
- A state blob large enough to matter for memory or transmission before pruning.
- Microdata and JSON-LD both present and disagreeing.
- The picker on a page that re-renders under the cursor, invalidating the highlighted node between hover and click. The same re-render invalidates the panel's candidate list (FR-024a); a stale list must not commit a node that no longer exists.
- A scoped region inside a shadow root or a cross-origin iframe, where no selector from the top document can address it. Out of scope to support; must fail with an explanation naming the actual cause ("this part of the page can't be scoped" rather than a generic scoping-failed message), and the learning offer (FR-026b) MUST be suppressed rather than offered against a selector that can never match.
- A selection spanning partial text nodes, or crossing several siblings, so its common ancestor is far broader than what the user highlighted — the analysis must use the highlighted text, while any *learning* offer must describe the broader region it would actually store. Where that broader region cannot be named more precisely than "a larger part of the page containing your selection," the offer's copy MUST say exactly that rather than attempt a false precision (e.g. inventing a container name); the acceptance criterion is honesty about the imprecision, not eliminating it — this is accepted as a hard copy problem, not a solved one.
- A selection made, then the user right-clicks somewhere that clears it before choosing the menu item.
- "Analyze selection" invoked on a page whose analysis is already open in the panel for a *different* tab: the command targets the tab the user right-clicked in, and the panel MUST switch to (or open for) that tab's analysis rather than overwriting whatever the previously-open tab's analysis was showing.
- A scoped analysis (picker or selection) that fails after the region was committed — a network error, or the monthly allowance running out between commit and response. The user MUST return to a state where the region is still considered current: retrying re-runs the analysis against the same committed region, not a blank slate requiring the user to scope again.
- A selection of a few words — far below the usable minimum — where the right response is refusal, not an analysis of a fragment.
- A host whose postings live on two structurally different templates, so one learned selector is right for half of them.
- Pasted text that is not a job posting at all: the existing `isJobPosting: false` and "Analyze anyway" path applies unchanged.
- The Google SERP overlay special case in the current extractor must keep working; readiness and scoring must not bypass it.

## Out of Scope

- Iframe drilling via `allFrames` injection. A real gap for some boards, deliberately deferred so this feature's permission and injection model stays unchanged.
- Server-side fetching or rendering of posting URLs.
- Asking the model to choose an extraction selector.
- Syncing learned selectors between users or devices; they stay local per FR-033.
- Any per-host hard-coded adapter table. Learned selectors are the maintainable substitute.
- Changes to the analysis schema, fit scoring, metering, or tier behavior.

## Open Questions

- ~~**Readiness budget**~~ **[resolved by measurement]**: slowest settle is 4883 ms (`phenom-intuit`), stable across 5 runs at 3408–3600 ms time-to-text. Budget floor ≈ 5 s; planning to fix the exact value and the stability-window length, whose cost lands on every fast page (the other five fixtures settle in 973–1589 ms).
- ~~**Paste entry point**~~ **[decided 2026-07-25 — persistent action button]**: a button in the panel header row beside the two tabs, opening a paste composer over the panel body. (An earlier draft of this question said "fourth tab"; the panel has two today, so the alternative would have been a third.)

  Chosen over a failure-state-only affordance because paste is an *origination* path, not only a recovery one — job descriptions arrive as PDFs, emails, and messages with no page ever involved, the same need feature 004 built document upload to serve. A failure-only entry point would force those users to open an arbitrary page and wait for it to fail.

  Chosen over a third tab because "This Page" and "Saved" name places while paste names an action, and a tab bar that mixes the two reads wrong; a button also avoids a tablist whose selected tab does not correspond to what the body is showing. See FR-017a–FR-017e.
- **Consecutive-miss threshold** before retiring a learned selector: too low retires on a transient render, too high leaves the user with a silently dead learning.
- **Learned selector storage**: `chrome.storage.local` versus `sync`. `sync` follows the user across machines but has tighter quotas and makes FR-033's "never leaves the browser" phrasing arguable.

## Technical Shape *(non-binding — inputs to planning)*

Recorded because three constraints materially shape the plan and are easy to miss:

**`extractPage` is serialized, not imported.** It runs via `chrome.scripting.executeScript({ func })`, so it must stay self-contained — no imports, no module scope. This is why constants are duplicated inline today, and it is the reason FR-038 forbids pulling in a readability library: the scoring heuristic has to be hand-rolled inside the injected function, or the injection must move to a bundled file, which is a larger change to the extension's build and grant model. Returning a promise from the injected function is supported and is the mechanism for FR-001.

**Evidence validation is a tripwire.** [`validateEvidence`](../../functions/src/services/jobExtractionOrchestrator.ts#L153) downgrades any arrangement whose evidence quote is not a substring of `jsonLd + title + mainText`. Adding structured sources to the prompt without adding them to that haystack would make Story 2 *reduce* arrangement confidence on exactly the pages it improves. FR-015 exists to prevent this; it is the single most likely silent regression in the feature.

**Paste has a precedent to follow.** Feature 004 already added a source discriminator, a filename, and a synthetic dedupe key to `SavedJobs` for document-sourced analyses. Paste is the same problem — an analysis with no URL — and should extend that discriminator rather than invent a parallel identity scheme. FR-021's synthetic key should follow the shape 004 established.

**Payload compatibility.** `isAnalyzeJobRequest` validates only `url`, `mainText`, `title`, and `jsonLd`, so adding fields to the extract payload is backward-compatible in both directions: an older extension keeps working against a newer backend, and a newer extension against an older one loses the new signals without erroring. Keeping `jsonLd` populated as it is today, and adding structured sources alongside it, preserves that property.
