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

**Independent Test**: Paste a job description into the panel with no readable page open at all, confirm the analysis returns with the same fields and fit scoring as a page analysis, and confirm it can be saved to the library and found again.

**Acceptance Scenarios**:

1. **Given** a user with posting text on the clipboard, **When** they paste it into the panel and analyze, **Then** they get the same analysis shape and fit scoring as a page-based analysis.
2. **Given** a pasted analysis, **When** the user saves it, **Then** it enters the library identified as paste-sourced rather than by URL, and is distinguishable from page-sourced postings.
3. **Given** pasted text below the usable minimum or above the content cap, **When** the user tries to analyze, **Then** they are told which it is and what to do, before any analysis allowance is consumed.
4. **Given** a pasted analysis, **When** it completes, **Then** it counts against the same monthly allowance as any other analysis, and the allowance-exhausted state behaves identically.
5. **Given** the same text pasted twice, **When** the second analysis is requested, **Then** it resolves consistently against the first rather than creating an ambiguous duplicate library entry.

---

### User Story 4 - Point at the Posting, and the Host Is Learned (Priority: P4)

Automatic extraction picks the wrong region on a host the user visits often. The user clicks "Pick region", the page highlights blocks as they hover, they click the posting body, and the analysis re-runs against it. The next posting they open on that host extracts correctly with no action at all.

**Why this priority**: It is the only path that turns a single user correction into durable coverage, but it is the largest build and it depends on the paste escape hatch already existing for the cases where picking is impossible. It is the last of the four for effort reasons, not value reasons.

**Independent Test**: On a host where automatic extraction picks the wrong region, pick the posting body, confirm the analysis re-runs against the picked region; then open a different posting on the same host and confirm it extracts from the equivalent region with no user action.

**Acceptance Scenarios**:

1. **Given** an analysis that picked the wrong region, **When** the user starts the picker, **Then** hovering the page highlights the block under the cursor and shows what will be captured.
2. **Given** the picker is active, **When** the user clicks a block, **Then** the picker closes and the analysis re-runs against that block's text.
3. **Given** the picker is active, **When** the user presses Escape or clicks the panel, **Then** the picker closes with no change to the current result.
4. **Given** a region was picked on a host, **When** the user later analyzes a different posting on the same host, **Then** the learned region is used automatically and the panel indicates the host was learned.
5. **Given** a learned region that no longer matches the page — the site redesigned, or the selector matches nothing — **When** extraction runs, **Then** it falls back to automatic extraction without an error, and the stale learning is retired after repeated misses.
6. **Given** a learned region, **When** the user wants it gone, **Then** they can clear it for the current host, and clear all learned hosts, from the options page.
7. **Given** a picked region yielding less than the usable minimum, **When** the user clicks it, **Then** they are told the selection is too small and the picker stays open for another try.

---

## Requirements *(mandatory)*

### Functional Requirements — Readiness (Story 1)

- **FR-001** **[measured — rewritten]**: The readiness test MUST key on extracted body text reaching the usable minimum. Presence of structured data MUST NOT by itself satisfy readiness, because it is routinely available before the posting body renders (3/6 fixtures). The current `jsonLd.length > 0 || text >= minimum` predicate MUST NOT be reused as the retry condition.
- **FR-002** **[measured — rewritten]**: Extraction MUST return once body text has cleared the minimum *and* stopped growing for a short stability window — not on first crossing, which on the motivating fixture captures roughly 3% of the posting. A page whose text is stable on the first attempt MUST incur no more than that one stability window of delay.
- **FR-003** **[measured]**: The readiness budget MUST be at least the corpus's slowest observed settle time (4883 ms) plus headroom, and the worst case MUST stay inside the analysis latency budget (constitution IV / QG-4). A budget under ~3 s is disqualified: it fails the fixture that motivated the feature.
- **FR-004**: Re-attempts MUST be driven by observed page change, not by fixed polling alone, so a page that settles early is not made to wait.
- **FR-004a** **[measured]**: Extraction MUST NOT return structured data with an empty or below-minimum body text while the readiness budget remains, since that is the silent-degradation path 3/6 fixtures take today.
- **FR-005**: When the budget expires without usable content, the resulting error MUST distinguish "the page was still loading" from "this page has no content", and MUST remain retryable.
- **FR-006**: A user cancel during the readiness wait MUST stop it immediately and send no analysis request.
- **FR-007**: Extraction MUST report readiness provenance — attempts made and time spent — for diagnosis and for the eval harness.

### Functional Requirements — Signals and Containers (Story 2)

- **FR-008**: Extraction MUST harvest `JobPosting` microdata in addition to JSON-LD.
- **FR-009** **[measured — downgraded]**: Blob harvesting MUST NOT be built against the named conventions on faith; none was found to carry posting data on any corpus fixture. Before any blob-harvesting code ships, a corpus fixture MUST be exhibited whose posting body is recoverable *only* from a state blob. If no such fixture can be produced, this requirement is dropped and the effort moves to FR-012. The discovery scan in `extension/scripts/corpusProbe.ts` is the gate.
- **FR-010**: Each harvested structured source MUST carry its own provenance so the analysis prompt and any future debugging can tell JSON-LD from microdata from a state blob.
- **FR-011**: Harvested structured data MUST be pruned to the posting-shaped subtree and MUST be capped in size; the cap MUST be enforced before transmission.
- **FR-012** **[measured — promoted]**: Container selection MUST score candidates by text density and link density rather than falling through to `document.body`. This is now the feature's highest-value automatic change: 3 of 6 fixtures take the body path today, admitting cookie banners and skip-links into the model input. Scoring MUST apply whenever the semantic path yields nothing *or* yields a container that scores worse than a scored candidate — not only when `main`/`[role=main]`/`article` are absent entirely.
- **FR-013**: Container selection MUST NOT change the selected text on pages where the existing semantic-container path already yields the posting.
- **FR-014**: The analysis request payload MUST carry harvested structured sources in addition to the existing JSON-LD field, and MUST remain accepted by the existing request validation.
- **FR-015**: The backend evidence check MUST treat all transmitted structured sources as valid quotable input, so evidence drawn from harvested data is not downgraded to `unspecified`.
- **FR-016**: The backend prompt MUST state the relative trust of each structured source kind, preserving today's rule that page body text wins when it contradicts structured data.

### Functional Requirements — Paste (Story 3)

- **FR-017**: The panel MUST offer a path to analyze pasted posting text with no readable page required.
- **FR-018**: Pasted text MUST be validated against the same usable minimum and content cap as page text, with the outcome reported before any analysis allowance is consumed.
- **FR-019**: A paste-sourced analysis MUST produce the same analysis shape and fit scoring as a page-sourced one.
- **FR-020**: A paste-sourced analysis MUST be identified as paste-sourced wherever a posting's source is shown or stored, rather than being attributed to a URL.
- **FR-021**: A paste-sourced analysis MUST be storable in the library under a stable synthetic identity derived from its content, so repeat pastes of the same text resolve consistently.
- **FR-022**: A paste-sourced analysis MUST count against the same monthly allowance and library cap as any other analysis, with identical at-cap behavior.

### Functional Requirements — Picker and Learned Hosts (Story 4)

- **FR-023**: The user MUST be able to start an element picker on the current page from the panel, reachable both from a failed extraction and from a successful-but-wrong one.
- **FR-024**: The picker MUST highlight the block under the cursor and indicate what will be captured before the user commits.
- **FR-025**: The picker MUST be dismissible without side effects via Escape and via leaving the page.
- **FR-026**: Committing a pick MUST re-run the analysis against the picked region's text.
- **FR-027**: A pick MUST be reduced to a selector that is stable across postings on the same host; machine-generated class names MUST NOT be relied on.
- **FR-028**: A learned selector MUST be stored per host, locally, and MUST be applied ahead of automatic extraction on subsequent analyses of that host.
- **FR-029**: A learned selector that fails to match, or that yields less than the usable minimum, MUST fall through to automatic extraction silently, and MUST be retired after repeated consecutive misses.
- **FR-030**: The number of learned hosts MUST be capped, with least-recently-used eviction.
- **FR-031**: The user MUST be able to clear the learned selector for the current host and clear all learned selectors, from the options page.
- **FR-032**: The panel MUST indicate when a result came from a learned region rather than automatic extraction.
- **FR-033**: Learned selectors MUST NOT leave the browser; no selector, host, or picked content may be transmitted to the backend under this feature.
- **FR-034**: A pick yielding less than the usable minimum MUST be refused with an explanation, leaving the picker open.

### Cross-Cutting Requirements

- **FR-035**: Every extraction result MUST record which strategy produced it — learned selector, structured data, semantic container, scored container, body fallback, or paste — and this provenance MUST be available to the eval harness.
- **FR-036**: The feature MUST NOT request any new host permissions in store or release builds; it MUST operate within the existing `activeTab` grant model.
- **FR-037**: All new error and empty states MUST be plain language with a stated next action, per constitution III.
- **FR-038**: No new runtime dependency may be added to the extension bundle for container scoring; the scoring heuristic MUST be self-contained.

### Key Entities

- **Structured source**: One harvested block of posting data, carrying its kind (JSON-LD, microdata, or the specific state-blob convention), its pruned payload, and its size after pruning.
- **Extraction provenance**: The record of how a given extraction resolved — strategy used, readiness attempts, elapsed time, whether the readiness budget expired, and whether a learned selector was tried and missed.
- **Learned host selector**: A per-host record of a user-picked selector, when it was learned, and its consecutive-miss count, subject to a capped, least-recently-used store.
- **Paste-sourced posting**: A posting whose content came from user-pasted text, identified by a stable content-derived synthetic key rather than a URL.

## Success Criteria *(mandatory)*

Baseline captured 2026-07-25 over 6 fixtures; the table and aggregates live in `extension/tests/fixtures/pages/README.md` and regenerate via `npx tsx scripts/baselineReport.ts`.

- **SC-001**: The `phenom-intuit` fixture analyzes successfully when analysis is triggered during hydration, with no user action, on the first try — with the full posting (~11,900 chars), not the ~300-char prefix available at 3440 ms.
- **SC-002**: Body-fallback container selection drops from **3/6** to at most 1/6, and no fixture's selected text shrinks below its baseline. Specifically: `lever-palantir` no longer opens with the cookie-consent banner, and `workday-nvidia` no longer opens with "Skip to main content".
- **SC-003**: Extractions returning structured data with below-minimum body text drop from **3/6** to 0/6.
- **SC-003a**: `thin-posting-control` still produces the thin-content error. Any change that makes it "succeed" is fabricating content and fails this criterion.
- **SC-004**: On pages that are already settled when analysis is triggered, added latency from readiness checking is negligible relative to the analysis call.
- **SC-005**: Worst-case extraction time — a page that never becomes ready — stays within the readiness budget, and total analysis time stays within the constitution IV ceiling.
- **SC-006**: On corpus pages with no semantic container, the selected text excludes navigation, related-jobs lists, and footers, verified against per-fixture expectations.
- **SC-007**: A user can go from "this page cannot be analyzed" to a completed analysis via paste without leaving the panel.
- **SC-008**: After one pick on a host, a second, previously unseen posting on that host extracts from the equivalent region with no user action.
- **SC-009**: A learned selector that stops matching produces a normal automatic-extraction result, never a user-visible error.
- **SC-010**: Arrangement accuracy on the existing posting eval does not regress, and arrangement downgrades caused by evidence falling outside the transmitted input drop to zero on fixtures with harvested structured data.

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
- The picker on a page that re-renders under the cursor, invalidating the highlighted node between hover and click.
- A picked region inside a shadow root or a cross-origin iframe, where no selector from the top document can address it. Out of scope to support; must fail with an explanation rather than storing a selector that can never match.
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
- **Paste entry point**: a fourth panel tab versus an action surfaced from the extraction-failure state. The tab is more discoverable; the failure-state affordance is better targeted and adds no chrome. Worth deciding against how often paste is expected to be the *first* thing a user reaches for.
- **Consecutive-miss threshold** before retiring a learned selector: too low retires on a transient render, too high leaves the user with a silently dead learning.
- **Learned selector storage**: `chrome.storage.local` versus `sync`. `sync` follows the user across machines but has tighter quotas and makes FR-033's "never leaves the browser" phrasing arguable.

## Technical Shape *(non-binding — inputs to planning)*

Recorded because three constraints materially shape the plan and are easy to miss:

**`extractPage` is serialized, not imported.** It runs via `chrome.scripting.executeScript({ func })`, so it must stay self-contained — no imports, no module scope. This is why constants are duplicated inline today, and it is the reason FR-038 forbids pulling in a readability library: the scoring heuristic has to be hand-rolled inside the injected function, or the injection must move to a bundled file, which is a larger change to the extension's build and grant model. Returning a promise from the injected function is supported and is the mechanism for FR-001.

**Evidence validation is a tripwire.** [`validateEvidence`](../../functions/src/services/jobExtractionOrchestrator.ts#L153) downgrades any arrangement whose evidence quote is not a substring of `jsonLd + title + mainText`. Adding structured sources to the prompt without adding them to that haystack would make Story 2 *reduce* arrangement confidence on exactly the pages it improves. FR-015 exists to prevent this; it is the single most likely silent regression in the feature.

**Paste has a precedent to follow.** Feature 004 already added a source discriminator, a filename, and a synthetic dedupe key to `SavedJobs` for document-sourced analyses. Paste is the same problem — an analysis with no URL — and should extend that discriminator rather than invent a parallel identity scheme. FR-021's synthetic key should follow the shape 004 established.

**Payload compatibility.** `isAnalyzeJobRequest` validates only `url`, `mainText`, `title`, and `jsonLd`, so adding fields to the extract payload is backward-compatible in both directions: an older extension keeps working against a newer backend, and a newer extension against an older one loses the new signals without erroring. Keeping `jsonLd` populated as it is today, and adding structured sources alongside it, preserves that property.
