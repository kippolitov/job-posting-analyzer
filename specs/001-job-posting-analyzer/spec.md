# Feature Specification: Job Posting Analyzer

**Feature Branch**: `001-job-posting-analyzer`

**Created**: 2026-07-04

**Status**: Draft

**Input**: User description: "Extend the existing Chrome extension (Video Knowledge Panel) with a second operating mode: the Job Posting Analyzer. When the user opens the side panel on any non-YouTube page, the extension analyzes the current page as a potential job posting and surfaces structured, decision-relevant information: work arrangement (remote / hybrid / on-site, including days-in-office for hybrid roles), salary, seniority, tech stack, and a fit score against the user's candidate profile. The user can save analyzed postings to a persistent local library with status tracking and notes. YouTube video pages retain the existing Video Knowledge Panel behavior unchanged; mode selection is automatic based on the active tab URL." (Source: docs/jobposting/spec.md)

## Problem Statement

Job postings scatter critical decision criteria — especially work arrangement details like "hybrid, 3 days in office" — through unstructured description text. Comparing postings across LinkedIn, Indeed, company career pages, and ATS-hosted boards requires manually re-reading each page and maintaining a separate tracking spreadsheet. The user wants a single-click, on-page analysis with durable, filterable saved results.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Analyze the Current Page as a Job Posting (Priority: P1)

As a job seeker browsing postings on any website, I open the side panel and immediately see the work arrangement, salary, seniority, and tech stack of the posting on the current page, with evidence for how the work arrangement was determined — so I can decide within seconds whether the posting is worth my time.

**Why this priority**: This is the core value of the feature. Without on-page analysis there is nothing to save, score, or track. It is independently shippable: analysis alone (no library, no fit score) already replaces manual re-reading of postings.

**Independent Test**: Can be fully tested by opening the side panel on a public job posting page and verifying that the extracted fields render with correct values and an evidence quote for the arrangement classification.

**Acceptance Scenarios**:

1. **Given** the user is on a job posting page on any non-YouTube site, **When** they open the side panel, **Then** the panel displays the Job Posting Analyzer mode (not the Video Knowledge Panel) with analysis triggered per the configured behavior (auto-trigger with a cancel affordance), or the cached result if this page was previously analyzed.
2. **Given** the user triggers analysis on a job posting page, **When** analysis completes, **Then** the panel displays: job title, company, location, work arrangement classification (remote / hybrid / on-site / unspecified), days in office and days remote (when hybrid), remote restrictions (e.g., "US only"), salary range, seniority level, and tech stack.
3. **Given** an analysis result is displayed, **When** the work arrangement was inferred from description text rather than stated explicitly, **Then** the panel shows the verbatim evidence quote from the posting supporting the classification and labels the classification as `explicit` or `inferred`.
4. **Given** a posting does not state its work arrangement, **When** analysis completes, **Then** the arrangement displays as **Unspecified** — the system MUST NOT guess.
5. **Given** the user opens the side panel on a page that is not a job posting (e.g., a news article), **When** analysis runs, **Then** the panel reports "This doesn't look like a job posting" and offers to analyze anyway.
6. **Given** the analysis backend is unreachable or returns an error, **When** analysis is triggered, **Then** the panel shows a human-readable error with a retry action, and any structured fields already extracted from the page itself are still displayed.
7. **Given** the user is on a YouTube watch page, **When** they open the side panel, **Then** the existing Video Knowledge Panel renders exactly as today, with no Job Analyzer UI present.

---

### User Story 2 - Save Postings to a Persistent Library (Priority: P2)

As a job seeker who has analyzed a promising posting, I save it with one click and later browse, filter, and update my saved postings — replacing my tracking spreadsheet.

**Why this priority**: Durable tracking is the second half of the stated problem ("durable, filterable saved results"). It depends on User Story 1 producing analyses but delivers standalone value on top of it.

**Independent Test**: Can be tested by saving an analyzed posting, restarting the browser, and verifying the posting appears in the Saved tab with its status, notes, and a working link back to the original page.

**Acceptance Scenarios**:

1. **Given** the user is viewing an analysis result, **When** they click **Save**, **Then** the posting (canonical URL, extracted fields, timestamp, default status `interested`) is stored persistently and survives browser restarts.
2. **Given** the user has saved postings, **When** they open the **Saved** tab, **Then** they see a list filterable by work arrangement and by status, sortable by date saved, with each item linking back to the original posting URL.
3. **Given** a saved posting, **When** the user changes its status (`interested` / `applied` / `interviewing` / `rejected` / `ghosted` / `archived`) or edits its notes, **Then** the change persists immediately.
4. **Given** a saved posting, **When** the user deletes it from the Saved tab, **Then** it is removed from the library.
5. **Given** the user has saved postings, **When** they trigger export, **Then** all saved postings download as a single JSON file for backup/portability.

---

### User Story 3 - Revisit Detection and Analysis Caching (Priority: P3)

As a job seeker who reaches the same posting again — possibly via a different campaign link — I see my saved analysis, status, and notes instantly instead of paying for and waiting on a fresh analysis.

**Why this priority**: Saves time and backend cost on the very common revisit path, and prevents duplicate library entries. Builds on Stories 1 and 2 but is separable: without it the feature still works, just with redundant re-analysis.

**Independent Test**: Can be tested by saving a posting, navigating away, returning to the same posting via a link with tracking parameters appended, and verifying the panel shows "Already saved" with the stored data and no new backend call.

**Acceptance Scenarios**:

1. **Given** the user navigates to a page whose canonical URL matches a previously saved posting, **When** they open the side panel, **Then** the panel indicates "Already saved" and shows the stored analysis, status, and notes without re-invoking the analysis backend.
2. **Given** a saved or cached posting is displayed, **When** the user clicks a manual **Re-analyze** action, **Then** a fresh analysis runs and replaces the displayed result.
3. **Given** the same posting is reached via URLs differing only in tracking parameters, **When** the user saves or revisits it, **Then** the system treats them as one posting (single library entry, cache hit).
4. **Given** a page was analyzed (but not saved) within the cache lifetime, **When** the user re-opens the side panel on it, **Then** the cached result displays without a new backend call.

---

### User Story 4 - Fit Score Against a Candidate Profile (Priority: P3)

As a job seeker with a defined profile (skills, seniority, domains, dealbreakers), I see a 0–100 fit score with a short rationale on every analyzed posting, so I can triage postings without re-reading my own criteria each time.

**Why this priority**: High-value triage aid, but the feature is fully usable without it — extraction fields alone answer the core questions. Requires the profile editor plus scoring, so it carries more scope than Story 3.

**Independent Test**: Can be tested by configuring a candidate profile in extension options, analyzing a posting, and verifying a fit score and one-to-two-sentence rationale render; then clearing the profile and verifying the prompt to configure it appears instead.

**Acceptance Scenarios**:

1. **Given** the user has configured a candidate profile, **When** analysis completes, **Then** the panel displays a fit score (0–100) and a one-to-two-sentence rationale comparing the posting against the profile.
2. **Given** the user has not configured a candidate profile, **When** analysis completes, **Then** extraction fields display normally and the fit score section shows a prompt to configure the profile in extension options.
3. **Given** the user opens extension options, **When** they edit the candidate profile (free-text: skills, seniority, domains, dealbreakers) and save, **Then** the profile is stored locally and used for subsequent analyses.
4. **Given** the profile contains a dealbreaker that the posting violates (e.g., "no fully on-site roles" vs. an on-site posting), **When** the fit score is computed, **Then** the score is hard-capped at 20 or below and the rationale names the violated dealbreaker.

---

### Edge Cases

- **Single-page applications** (LinkedIn, Indeed) that swap job content without full navigation: analysis is bound to the moment the user triggers it; re-triggering re-extracts the currently visible content.
- **Pages with multiple structured job postings** (list pages): the system analyzes the most prominent/first posting and informs the user that a specific posting page yields better results.
- **Contradictory signals** (location field says "Remote", body says "3 days onsite"): the analysis classification wins, the evidence quote is mandatory, and confidence is marked `inferred`.
- **Very long pages**: extracted text is capped before transmission, consistent with the existing 80,000-character transcript cap.
- **Tracking-parameter-laden URLs**: canonicalization strips known tracking parameters so the same posting reached via different campaign links deduplicates.
- **Non-job pages analyzed anyway**: forced analysis on a non-job page still returns a structured result labeled as not a job posting.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST automatically select panel mode by active tab URL: YouTube watch pages → Video Knowledge Panel (existing, unchanged); all other `http(s)` pages → Job Posting Analyzer.
- **FR-002**: The system MUST extract page content only upon explicit user action (opening/interacting with the side panel), never via passive background crawling.
- **FR-003**: The system MUST parse embedded structured job posting data (schema.org `JobPosting` markup) when present and use it as the primary source for title, company, location, salary, employment type, and remote flag.
- **FR-004**: The system MUST send cleaned page text plus any embedded structured data to the analysis backend and receive a structured result containing: `arrangement` (remote | hybrid | onsite | unspecified), `daysInOffice`, `daysRemote`, `remoteRestrictions`, `salary` (min, max, currency, period), `seniority`, `techStack[]`, `title`, `company`, `location`, `isJobPosting` (boolean), `arrangementConfidence` (explicit | inferred | none — `none` pairs with an `unspecified` arrangement), and `arrangementEvidence` (verbatim quote).
- **FR-005**: The system MUST display `unspecified` rather than a guessed value when the posting does not state its work arrangement; `daysInOffice`/`daysRemote` MUST be null unless hybrid details are stated or directly inferable, in which case the evidence quote is required.
- **FR-006**: The system MUST compute a fit score (0–100) and short rationale comparing the posting against the user's candidate profile, when a profile is configured; a profile dealbreaker violated by the posting caps the score at ≤ 20 with the dealbreaker named in the rationale.
- **FR-007**: The system MUST provide a candidate profile editor in extension options (free-text profile: skills, seniority, domains, dealbreakers), stored locally and transmitted only with analysis requests.
- **FR-008**: The system MUST allow saving an analyzed posting with: canonical URL, all extracted fields, fit score, status, free-text notes, saved timestamp, and last-updated timestamp.
- **FR-009**: Saved postings MUST persist across browser restarts (durable local storage; cross-device sync is out of scope for this feature).
- **FR-010**: The system MUST canonicalize URLs (strip `utm_*`, `ref`, `refId`, `trk`, `gh_src`, `lever-origin`, and similar tracking parameters; normalize known job board URL patterns) and use the canonical URL as the deduplication key.
- **FR-011**: The system MUST detect revisits to saved postings and display saved state instead of re-analyzing; a manual "Re-analyze" action MUST be available.
- **FR-012**: The system MUST cache analysis results per canonical URL so repeat analyses within the cache lifetime do not re-invoke the analysis backend (cache policy: least-recently-used eviction, 200 entries, 14-day lifetime).
- **FR-013**: The Saved tab MUST support filtering by arrangement and status, and sorting by saved date; each entry MUST support status change, note editing, opening the original URL in a new tab, and deletion.
- **FR-014**: The system MUST label non-job pages as such (`isJobPosting: false`) while still permitting a forced analysis.
- **FR-015**: All AI analysis MUST continue to route through the existing secured backend service; no AI provider credentials may ship in the extension.
- **FR-016**: The existing YouTube analysis and chat features MUST remain functionally unchanged, including their storage behavior.
- **FR-017**: The system MUST export saved postings as a single JSON file download for backup/portability.

### Key Entities *(include if feature involves data)*

- **JobAnalysis**: The structured extraction result for one page at one point in time — the fields listed in FR-004 plus fit score, rationale, analysis model/version metadata, and analyzed-at timestamp.
- **SavedJob**: A persisted posting — canonical URL, original source URL, JobAnalysis snapshot, status (`interested` / `applied` / `interviewing` / `rejected` / `ghosted` / `archived`), free-text notes, saved-at and last-updated timestamps.
- **CandidateProfile**: User-authored profile text plus optional structured dealbreakers, stored locally in the extension and editable in options.
- **PageExtract**: The client-side extraction payload — canonical URL, page title, embedded structured job data blocks (if any), and cleaned main-content text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Work arrangement classification matches a human reading of the posting in ≥ 90% of a 50-posting validation set, with zero cases where an explicitly stated arrangement is contradicted.
- **SC-002**: Hybrid day counts (days in office / days remote) are extracted in 100% of validation-set postings where they are stated in the posting text.
- **SC-003**: Time from side-panel open to rendered analysis is ≤ 8 seconds at the median on typical postings.
- **SC-004**: Users can save a posting and find it again via the Saved tab's filters in under 30 seconds, with saved data intact after a browser restart.
- **SC-005**: Zero regressions in the existing YouTube flow — the existing test suite passes unchanged.
- **SC-006**: Revisiting a saved or recently analyzed posting displays results without any new analysis backend call (0 redundant calls on the revisit path).

## Assumptions

- **Analysis trigger**: Analysis auto-triggers when the side panel opens on a non-YouTube page, with a visible cancel affordance (adopted from the draft's OQ-1; an explicit-click alternative was considered and rejected as adding friction to the primary flow).
- **Dealbreaker handling**: A violated profile dealbreaker hard-caps the fit score at ≤ 20 and is named in the rationale, rather than only annotating the rationale (adopted from the draft's OQ-2).
- **Cache policy**: Analysis cache uses least-recently-used eviction with 200 entries and a 14-day lifetime (adopted from the draft's OQ-3).
- **Local-only persistence**: There is no user account or sign-in; all persistence is local to the browser profile. Cross-device sync is a planned follow-up, and the storage design should not preclude a future server-backed swap.
- **Existing backend capacity**: The current analysis backend can accept an additional request type for job analysis without architectural change.
- **Language scope**: Postings are primarily in English; non-English postings are analyzed best-effort without a stated accuracy target.

## Out of Scope

- Automated crawling, polling, or bulk scraping of job boards.
- Cross-device sync / server-side persistence of saved jobs (planned follow-up; storage layer designed to permit the swap).
- Application tracking beyond status + notes (no reminders, no calendar integration).
- Browser support beyond Chrome (other browsers remain a future option).
- Multi-posting extraction from list/search-result pages.
