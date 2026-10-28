# Feature Specification: Trustworthy, Actionable Profile Match

**Feature Branch**: `006-profile-match-ux` (drafted on `claude/profile-match-ux-o1w484`)

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: "Analyze the current state of the profile match process and suggest important improvements in the UX; fix what is broken and draft a spec for the rest."

## Problem Context

The profile match is the product's core promise ("rank them against your profile"), yet today the user cannot tell when a score is out of date, what a number means, why a skill counts as matched or missing, or how to fix a wrong verdict. The current pipeline:

- **Profile**: one free-text box (up to 20,000 chars) plus free-text dealbreakers, edited on the extension options page ([`OptionsApp.tsx`](../../extension/entrypoints/options/OptionsApp.tsx)) or the web Profile page ([`Profile.tsx`](../../web/src/pages/Profile.tsx)).
- **Scoring**: the profile is serialized ([`shared/types/profile.ts`](../../shared/types/profile.ts)) into the same model call as extraction. The prompt ([`jobExtractionOrchestrator.ts`](../../functions/src/services/jobExtractionOrchestrator.ts)) asks for a 0–100 `fit.score`, a rationale, and `matching / missing / desired / strengths / weaknesses` lists. It gives no rubric, and it applies the dealbreaker cap (≤ 20) only through prompt wording.
- **Display**: [`FitScore.tsx`](../../extension/components/JobPanel/FitScore.tsx) shows a coloured number (≥ 70 green, > 20 amber, else red), the rationale, chips and bullet lists. The web [`AnalysisView.tsx`](../../web/src/components/AnalysisView.tsx) shows the same data as plain lists.

These are the problems, in order of how much they hurt user trust:

1. **Scores go stale silently.** [`needsFitRefresh`](../../extension/services/jobFlow.ts) only rescores when the fit is missing or uses the pre-breakdown format. After the user edits their profile, every cached and saved score still reflects the old profile, with no indicator. The web library's "sort by fit" then ranks scores made against different profile versions, and by different models (free and Premium use different deployments), as if they were comparable.
2. **Dealbreaker failures look like ordinary low scores.** A violated dealbreaker shows up as a red "18", with the reason somewhere in the rationale prose.
3. **The number has no defined meaning.** The model is never told what 85 versus 60 means, and the UI's colour cut-offs are not tied to any rubric.
4. **The breakdown cannot be verified.** Work arrangement carries a verbatim, server-checked evidence quote ([`validateEvidence`](../../functions/src/services/jobExtractionOrchestrator.ts)), but skill chips carry none. "Missing: Kafka" can't be traced to the posting line that requires it, and "Matching: Kubernetes" can't be traced to the résumé line that supports it.
5. **Profile setup is a blank text box.** The backend already extracts text from `.docx`/`.pdf` (`documentExtraction.ts`), but that path isn't available for the résumé. Preferences that the analysis already extracts as structured fields (arrangement, salary, seniority, remote restrictions) can only be stated as prose dealbreakers, which the model may or may not honour.
6. **There is no way to correct a wrong verdict.** When the model calls a skill the user has "missing", the only remedy is to find the profile page, edit free text, and re-analyze manually. The panel doesn't say that re-analyzing uses up an analysis.
7. **Triage tools are uneven.** The extension's Saved tab sorts only by save date ([`SavedTab.tsx`](../../extension/components/JobPanel/SavedTab.tsx)), while the web library can sort and filter by fit. The web Compare view ([`CompareGrid.tsx`](../../web/src/components/CompareGrid.tsx)) stacks full analyses side by side instead of comparing them requirement by requirement.

### Already fixed (baseline for this spec)

Commit `f1d229d` on this branch fixed a cross-surface parity bug. The web upload sent only `profile.text`, so dealbreakers never reached the model, and the web Profile page could not show or edit them. Both surfaces now serialize through the shared `profileToPromptText`, and the web page edits dealbreakers. FR-001 below keeps this from regressing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - I can trust that a score reflects my current profile (Priority: P1)

A user tightens their profile (adds a dealbreaker, rewrites their summary) and returns to postings they analyzed last week. Every score made against an older profile is visibly marked as stale and offers a one-click rescore. When a posting violates a dealbreaker, the panel says so explicitly instead of only showing a low number.

**Why this priority**: A wrong score that looks right is worse than no score. Everything else in this spec builds on scores being trustworthy.

**Independent Test**: Analyze a posting, edit the profile, revisit the posting. It shows a "scored against an older profile" notice with a Rescore action, and rescoring clears the notice. Add a dealbreaker the posting violates and rescore: a dealbreaker banner names the violated line.

**Acceptance Scenarios**:

1. **Given** a saved posting scored against profile version A, **When** the user saves profile version B and opens that posting (panel, Saved tab row, web library, web detail), **Then** the score is marked stale and a "Rescore" action is offered.
2. **Given** a stale score, **When** the user clicks Rescore, **Then** the panel says beforehand that this uses one analysis from their allowance, and after it succeeds the score, breakdown and fingerprint all update in place, including in the saved library entry.
3. **Given** a profile with the dealbreaker "no fully on-site roles", **When** an on-site posting is analyzed, **Then** a banner above the score reads "Violates your dealbreaker: no fully on-site roles", and the score is at most 20.
4. **Given** the web library sorted by fit, **When** some scores are stale, **Then** stale scores are visibly distinguished in the list, and the user can filter to "current profile only".
5. **Given** the user edits only whitespace or reorders nothing material, **When** they save, **Then** no score is marked stale (the fingerprint uses the normalized serialization).

---

### User Story 2 - I understand what a score means at a glance (Priority: P2)

Next to the number, the user sees a plain-language verdict (**Strong match**, **Worth a shot**, **Stretch**, **Long shot**, **Dealbreaker**). The verdict's thresholds match a rubric the model was actually given, so 80 means the same thing across postings.

**Why this priority**: People triage by labels, not numbers. A shared rubric also makes scores comparable within a library.

**Independent Test**: Analyze postings across a spread of fit. Each shows a verdict label consistent with its score band, the same mapping applies in the extension and on the web, and the labels can be told apart without colour.

**Acceptance Scenarios**:

1. **Given** any fit result, **When** it is displayed on any surface, **Then** a verdict label from the shared set (FR-009) is shown next to the score, derived from one shared mapping.
2. **Given** a dealbreaker violation, **When** displayed, **Then** the verdict is "Dealbreaker", whatever the numeric score.
3. **Given** a screen-reader user, **When** focus reaches the score, **Then** the verdict and score are announced together ("Strong match, fit 86 out of 100").

---

### User Story 3 - I can verify why a skill counts as matched or missing (Priority: P3)

Each matching and missing item can be expanded or hovered to show its evidence. For a match, that's the résumé line that supports it and the posting line that asks for it. For a missing item, it's the posting line that requires it.

**Why this priority**: Evidence turns a verdict the user has to take on faith into one they can check, and it extends a principle the product already applies to work arrangement.

**Independent Test**: Analyze a posting with a known profile. Every evidence quote shown is a verbatim substring of the profile or the posting, and an item whose quote fails that check shows no evidence instead of an invented one.

**Acceptance Scenarios**:

1. **Given** a matching item, **When** the user expands it, **Then** they see a verbatim posting quote and a verbatim profile quote.
2. **Given** a missing or desired item, **When** expanded, **Then** they see a verbatim posting quote.
3. **Given** a model-returned quote that is not a substring of its source, **When** the response is validated, **Then** the quote is dropped (the item stays) and a warning is logged, mirroring the existing arrangement-evidence backstop.

---

### User Story 4 - Setting up my profile takes one minute (Priority: P4)

A new user uploads their résumé (`.pdf`/`.docx`) instead of pasting it, then fills a few structured preferences: acceptable arrangements, minimum salary and currency, seniority range, and locations or timezones they can work in. Structured preferences are checked directly in code against the fields the analysis already extracts. Free-text dealbreakers remain for everything else.

**Why this priority**: Without a profile, the fit score, and much of the product's value, never appears. Checking preferences in code is free, consistent across runs, and immune to prompt drift.

**Independent Test**: Upload a résumé file. The profile text fills in for review before saving. Set "remote only" and analyze an on-site posting: the dealbreaker banner (US1) appears even if the model's own score was high.

**Acceptance Scenarios**:

1. **Given** the profile editor (extension options page or web Profile page), **When** the user uploads a `.pdf` or `.docx` résumé, **Then** the extracted text appears in the editor for review and is not saved until the user saves.
2. **Given** a résumé with no extractable text, **When** uploaded, **Then** the user sees the same plain-language message used for job-posting uploads.
3. **Given** a structured preference "arrangement ∈ {remote}", **When** a posting is analyzed with `arrangement = onsite` and `arrangementConfidence ≠ none`, **Then** the result is marked as a dealbreaker violation naming that preference, and the score is capped at 20.
4. **Given** a posting with `arrangement = unspecified` or no salary, **When** checked against a matching preference, **Then** it is not a violation. It appears as an "Unverified: arrangement not stated" note in weaknesses instead.
5. **Given** a minimum salary in one currency and a posting in another, or with a different period, **When** checked, **Then** no violation is declared. The mismatch is noted as unverified (no currency conversion in this feature).

---

### User Story 5 - I can correct a wrong verdict in one click (Priority: P5)

A missing-skill chip offers **"I have this"**. Clicking it adds the skill to a "Confirmed skills" section of the profile and offers to rescore this posting. The profile improves as a side effect of normal use.

**Why this priority**: The commonest complaint about automated matching is "it says I lack X but I have X". Fixing that in place keeps the user in the flow and improves every later score.

**Independent Test**: On a posting showing "Missing: Terraform", click "I have this". The profile now lists Terraform under confirmed skills, the score is marked stale (US1), and a rescore moves Terraform to matching.

**Acceptance Scenarios**:

1. **Given** a missing or desired chip, **When** the user clicks "I have this", **Then** the skill is appended to the profile's confirmed-skills list (deduplicated, case-insensitive) and the profile is saved.
2. **Given** the user confirmed a skill by mistake, **When** they open the profile editor, **Then** confirmed skills are listed and individually removable.
3. **Given** a just-confirmed skill, **When** the save succeeds, **Then** the panel offers "Rescore this posting (uses 1 analysis)" and does not rescore automatically.

---

### User Story 6 - I can triage and compare by fit wherever I am (Priority: P6)

The extension's Saved tab sorts and filters by fit and verdict, matching the web library. The web Compare view becomes a requirements table: rows are requirements gathered from the selected postings' breakdowns, columns are postings, and each cell shows matched / missing / nice-to-have / not asked. A header row shows score, verdict, salary and arrangement.

**Why this priority**: These are valuable but build on US1–US3. Sorting by stale or unexplained scores would amplify the problems above.

**Independent Test**: Save postings with different scores. Sort the extension Saved tab by fit, highest first. Select three postings on the web and open Compare: a requirement shared by two of them appears as one row with cells in both columns.

**Acceptance Scenarios**:

1. **Given** the extension Saved tab, **When** the user picks "Fit (highest)", **Then** rows sort by score, with unscored postings last, and stale scores are marked.
2. **Given** two to four postings selected for comparison, **When** Compare opens, **Then** requirements that differ only in case or whitespace merge into one row, and each cell's state comes from that posting's breakdown.
3. **Given** a narrow viewport, **When** Compare renders, **Then** the table scrolls horizontally inside its container, never the page.

### Edge Cases

- **No profile**: the current "Configure profile" call to action stays. Stale and verdict UI never appear for `fit: null`.
- **Profile deleted after scoring**: existing scores are marked "scored against a deleted profile". Rescore yields `fit: null`.
- **Profile fetch fails at analysis time**: as today, the analysis runs without a profile. The result must say "Fit not scored — your profile couldn't be loaded", not imply that no profile exists.
- **Web upload before the profile has loaded**: today [`Upload.tsx`](../../web/src/pages/Upload.tsx) can send a document before `fetchProfile` resolves, which silently yields `fit: null`. Upload MUST wait for the profile request to settle (success or failure) first.
- **Usage allowance exhausted**: Rescore and "I have this → rescore" show the existing exhausted state (`UsageExhausted`) instead of failing silently. Marking a score stale never uses an analysis.
- **Pre-feature saved postings** (no fingerprint): treated as "profile version unknown". They show a softer "may be out of date" notice, not the stale notice.
- **Free-to-Premium switch**: a score made by a different model tier is labelled with that tier in its details, but it isn't marked stale for that reason alone.
- **Confirmed skills near the 20,000-char cap**: the confirmed-skills section counts toward the cap. Adding past it is refused with the existing over-limit message.

## Requirements *(mandatory)*

### Functional Requirements — Parity (baseline)

- **FR-001**: Every surface that requests a fit score (extension analyze-job, paste and region flows, web analyze-document) MUST serialize the profile through the single shared `profileToPromptText`, and MUST include dealbreakers and, once US4/US5 land, structured preferences and confirmed skills. A contract test per surface MUST assert the serialized field. *(Delivered for dealbreakers in `f1d229d`.)*

### Functional Requirements — Freshness and Dealbreakers (Story 1)

- **FR-002**: The server MUST compute a **profile fingerprint** (a stable hash of the normalized serialized profile) and return it with every fit result and with `GET /profile` and `PUT /profile`.
- **FR-003**: A fit is **stale** when its fingerprint differs from the current profile's. Every surface that shows a fit (panel, Saved tab row, web library row, web detail, compare) MUST mark stale fits and offer Rescore where a rescore is possible.
- **FR-004**: Rescore MUST state its cost ("uses 1 analysis") before running, and MUST update the cached and saved analysis in place.
- **FR-005**: The fit schema MUST gain `dealbreakersViolated: string[]`, where each entry is the violated dealbreaker or structured preference as the user wrote it. When it isn't empty, the server MUST enforce `score ≤ 20` in code instead of trusting the prompt.
- **FR-006**: When `dealbreakersViolated` isn't empty, the UI MUST show a dealbreaker banner above the score that names each violation.
- **FR-007**: After a profile save, an open panel showing a result for the current page MUST offer to rescore it. It MUST NOT rescore automatically.

### Functional Requirements — Verdict and Rubric (Story 2)

- **FR-008**: The prompt MUST include a scoring rubric with explicit bands. Proposed: 85–100 all required skills covered and seniority aligned; 65–84 minor gaps; 40–64 significant gaps or a level mismatch; 0–39 major mismatch.
- **FR-009**: A single shared mapping (in `shared/`) MUST turn score plus violations into a verdict: **Strong match / Worth a shot / Stretch / Long shot / Dealbreaker**. Colour thresholds MUST come from the same mapping.
- **FR-010**: Verdicts MUST be distinguishable without colour (a text label always, and an icon where space allows).

### Functional Requirements — Evidence (Story 3)

- **FR-011**: The `matching`, `missing` and `desired` items MUST become objects carrying `label`, `postingQuote`, and, for matching items, `profileQuote`. The UI MUST still accept the legacy string-array shape for old snapshots.
- **FR-012**: The server MUST drop any quote that is not a whitespace-normalized substring of its source, keep the item, and log a warning, extending the existing `validateEvidence` approach.
- **FR-013**: Evidence MUST be reachable by keyboard and pointer, and MUST NOT expand the panel's default height. It's hidden until requested.

### Functional Requirements — Profile Setup (Story 4)

- **FR-014**: Both profile editors MUST accept a `.pdf`/`.docx` résumé upload, reusing the server's existing document text extraction. The extracted text fills the editor for review, and nothing is saved until the user saves.
- **FR-015**: The profile MUST gain optional structured preferences: acceptable arrangements, minimum salary (amount, currency, period), seniority range, and acceptable locations or timezones.
- **FR-016**: Structured preferences MUST be checked in code after the model responds, against the extracted `arrangement`, `salary`, `seniority` and `remoteRestrictions`. A preference counts as violated only when the posting's value is known and contradicts it. When the posting's value is unknown, the server MUST add an "Unverified: …" weakness instead of declaring a violation.
- **FR-017**: Structured preferences MUST also be serialized into the prompt (FR-001) so the model's rationale and lists take them into account.

### Functional Requirements — Correction Loop (Story 5)

- **FR-018**: Missing and desired items MUST offer "I have this", which adds the label to the profile's confirmed-skills list and saves the profile.
- **FR-019**: Both profile editors MUST list confirmed skills, each individually removable.
- **FR-020**: After a confirmation, the panel MUST offer Rescore (FR-004) and MUST NOT rescore on its own.

### Functional Requirements — Triage and Compare (Story 6)

- **FR-021**: The extension Saved tab MUST support sorting by fit (highest and lowest first) and filtering by verdict, with unscored postings sorted last.
- **FR-022**: The web Compare view MUST render a requirements table as described in US6, merging requirement labels that differ only in case or whitespace, with the per-posting full analysis still one click away.

### Cross-Cutting Requirements

- **FR-023**: The extension and the web MUST render fit results from the same shared view logic (verdict mapping, stale detection, legacy-shape handling), so the two surfaces can't drift apart again.
- **FR-024**: The "My profile" control in the score header MUST be a secondary action, so it doesn't compete with Save.
- **FR-025**: In the extension panel, the default fit view MUST show the verdict, score, rationale and up to three missing items, with "Show full breakdown" revealing the rest.

### Key Entities

- **Candidate Profile** (extended): `text`, `dealbreakers[]`, plus new `preferences` (arrangements, minimum salary, seniority range, locations), `confirmedSkills[]`, and the server-computed `fingerprint`.
- **Fit** (extended): adds `dealbreakersViolated[]` and `profileFingerprint`, turns `matching / missing / desired` into evidence-carrying items (legacy strings still accepted), and records the model that scored it (already present on the analysis as `model`).
- **Verdict**: derived, never stored. Computed from score and violations by the shared mapping.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of fits shown on any surface either match the current profile fingerprint or carry a stale or unknown marker.
- **SC-002**: On the eval corpus (`npm run eval:postings`), every posting that violates a fixture dealbreaker or structured preference returns a non-empty `dealbreakersViolated` and a score ≤ 20 (enforced in code).
- **SC-003**: On the eval corpus, ≥ 95% of returned evidence quotes pass the substring check, and 100% of quotes shown in the UI are verbatim.
- **SC-004**: Re-running the same posting and profile 5 times yields the same verdict band in ≥ 90% of corpus postings.
- **SC-005**: A first-time user with a résumé file reaches their first fit score in under 2 minutes from opening the profile editor.
- **SC-006**: Contract tests assert identical serialized-profile output from the extension and the web for the same stored profile.

## Assumptions

- Rescoring re-runs the full analysis and counts against the allowance like any analysis. A fit-only endpoint is out of scope (see Open Questions).
- No currency or pay-period conversion. Mismatches are "unverified", never violations.
- The fingerprint covers only the profile's semantic content (normalized serialization), not `updatedAt`.
- The model tier affects score quality but is not treated as staleness.

## Out of Scope

- Bulk rescoring of the whole library. Saved postings don't keep the posting text (only the analysis), so a bulk rescore would mean re-visiting each page. See Open Questions.
- Application help built on the breakdown (résumé tailoring, cover-letter talking points, interview prep). This is a strong Premium candidate for a follow-up feature that consumes US3's evidence.
- Multiple profiles per account (for example, "IC track" and "management track").

## Open Questions

1. Should saved postings store a bounded excerpt of the posting text, so the library can be rescored without re-visiting pages? This has privacy, storage-size and `MAIN_TEXT_CAP` implications.
2. Should a fit-only rescore (reusing stored extraction fields) cost less than a full analysis, or nothing?
3. Should structured-preference violations hard-cap the score at 20 like prose dealbreakers, or show the banner and leave the model's score unchanged?
4. Should "I have this" ask for a short evidence note ("5 years, led migration") to make the next match stronger, or stay one click?

## Technical Shape *(non-binding — inputs to planning)*

- **Fingerprint**: SHA-256 of the whitespace-normalized `profileToPromptText` output, computed server-side in `profileRepository` (on read and write) and in `orchestrateJobAnalysis` (from `req.profile`), so the client never has to hash anything.
- **Schema**: extend `JOB_ANALYSIS_SCHEMA.fit` with `dealbreakersViolated` and the evidence-item objects. Keep `isJobAnalysisPayload` and the shared `Fit` type tolerant of the legacy string arrays.
- **Deterministic checks**: a pure `applyPreferences(payload, preferences)` step after `validateEvidence` and `enforceConsistency`, unit-tested on its own.
- **Shared UI logic**: `shared/` already holds types and design tokens. Add a framework-free `fitView.ts` (verdict, stale detection, legacy normalization) that both the extension and the web import.
- **Résumé upload**: a new `POST /profile/import` that reuses `extractDocument` and returns text only (no metering, no model call).
