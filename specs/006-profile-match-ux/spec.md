# Feature Specification: Trustworthy, Actionable Profile Match

**Feature Branch**: `006-profile-match-ux`

**Created**: 2026-10-28

**Status**: Draft — formalized 2026-10-28 from the first draft on `claude/profile-match-ux-o1w484`. Implementation identifiers moved out of the requirements into Technical Shape; the draft's four open questions are resolved as documented defaults (see Assumptions). Clarified the same day, and a prerequisite scoring-model switch (FR-M01 to FR-M05) was added after the free model's retirement was confirmed. Revised the same day: dealbreaker violations no longer lower the fit score (see Clarifications).

**Input**: User description: "Analyze the current state of the profile match process and suggest important improvements in the UX; fix what is broken and draft a spec for the rest."

## Problem Context

The profile match is the product's core promise ("rank them against your profile"), yet today the user cannot tell when a score is out of date, what a number means, why a skill counts as matched or missing, or how to fix a wrong verdict. The current pipeline:

- **Profile**: one free-text box (up to 20,000 chars) plus free-text dealbreakers, edited on the extension options page ([`OptionsApp.tsx`](../../extension/entrypoints/options/OptionsApp.tsx)) or the web Profile page ([`Profile.tsx`](../../web/src/pages/Profile.tsx)).
- **Scoring**: the profile is serialized ([`shared/types/profile.ts`](../../shared/types/profile.ts)) into the same model call as extraction. The prompt ([`jobExtractionOrchestrator.ts`](../../functions/src/services/jobExtractionOrchestrator.ts)) asks for a 0–100 `fit.score`, a rationale, and `matching / missing / desired / strengths / weaknesses` lists. It gives no rubric, and it applies the dealbreaker cap (≤ 20) only through prompt wording.
- **Display**: [`FitScore.tsx`](../../extension/components/JobPanel/FitScore.tsx) shows a coloured number (≥ 70 green, > 20 amber, else red), the rationale, chips and bullet lists. The web [`AnalysisView.tsx`](../../web/src/components/AnalysisView.tsx) shows the same data as plain lists.

These are the problems, in order of how much they hurt user trust:

1. **Scores go stale silently.** [`needsFitRefresh`](../../extension/services/jobFlow.ts#L218) only rescores when the fit is missing or uses the pre-breakdown format. After the user edits their profile, every cached and saved score still reflects the old profile, with no indicator. The web library's "sort by fit" then ranks scores made against different profile versions, and by different models (free and Premium use different deployments), as if they were comparable.
2. **Dealbreaker failures look like ordinary low scores.** A violated dealbreaker shows up as a red "18", with the reason somewhere in the rationale prose.
3. **The number has no defined meaning.** The model is never told what 85 versus 60 means, and the UI's colour cut-offs are not tied to any rubric.
4. **The breakdown cannot be verified.** Work arrangement carries a verbatim, server-checked evidence quote ([`validateEvidence`](../../functions/src/services/jobExtractionOrchestrator.ts#L157)), but skill chips carry none. "Missing: Kafka" can't be traced to the posting line that requires it, and "Matching: Kubernetes" can't be traced to the résumé line that supports it.
5. **Profile setup is a blank text box.** The backend already extracts text from `.docx`/`.pdf` ([`documentExtraction.ts`](../../functions/src/services/documentExtraction.ts)), but that path isn't available for the résumé. Preferences that the analysis already extracts as structured fields (arrangement, salary, seniority, remote restrictions) can only be stated as prose dealbreakers, which the model may or may not honour.
6. **There is no way to correct a wrong verdict.** When the model calls a skill the user has "missing", the only remedy is to find the profile page, edit free text, and re-analyze manually. The panel doesn't say that re-analyzing uses up an analysis.
7. **Triage tools are uneven.** The extension's Saved tab sorts only by save date ([`SavedTab.tsx`](../../extension/components/JobPanel/SavedTab.tsx)), while the web library can sort and filter by fit. The web Compare view ([`CompareGrid.tsx`](../../web/src/components/CompareGrid.tsx)) stacks full analyses side by side instead of comparing them requirement by requirement.

8. **The free-tier scoring model is being retired, and it misjudges unstated facts.** Azure lists the free deployment's model as Deprecated, with inference retirement on **2027-04-14** and no automatic replacement, so on that date free analyses stop working. In a 2026-10-28 probe (a real 12K-character posting and a profile with the dealbreaker "no fully on-site roles", where the posting states no arrangement), the free model invented "onsite" and capped the score at 20. The Premium model also capped it at 20, treating "not stated" as a violation. Only the candidate replacement treated it as unverified. Rubric, verdict and stability work (US1, US2, SC-004) measured on the retiring model would have to be redone.

### Already fixed (baseline for this spec)

Commit `f1d229d` on this branch fixed a cross-surface parity bug. The web upload sent only the profile text, so dealbreakers never reached the model, and the web Profile page could not show or edit them. Both surfaces now serialize the profile the same way, and the web page edits dealbreakers. FR-001 keeps this from regressing.

## Clarifications

### Session 2026-10-28

- Q: How should a rescore count against the analysis allowance? → A: Rescores are free up to a monthly limit (10 per account per month, resetting with the analysis allowance), then cost 1 analysis each.
- Q: How should the "acceptable locations or timezones" preference be enforced, given postings' location restrictions are extracted only as free text? → A: It stays a structured preference but is judged by the model only (sent in the prompt), and a reported violation shows in the dealbreaker banner like a free-text dealbreaker. Arrangement, salary and seniority remain code-checked.
- Q: Should any of feature 006 be limited to Premium? → A: No. Every capability is available on both tiers, and the tiers keep differing only as they do today (model, monthly allowance, saved-postings cap).
- Q: What should a score saved before this feature (made without the rubric) show? → A: The number with a neutral "Unrated — rescore for a verdict" label, no verdict. It is left out of verdict filters but still sorts by number.
- Q: Saved postings keep only the analysis, not the posting text. How does rescoring work for a saved posting, including one that has been taken down? → A: Rescore runs only where the posting text is available again: the extension panel on the posting's page, or the web upload and paste screens. Library rows offer "Open posting to rescore" (URL source) or "Upload again to rescore" (document or paste source) instead. If the page no longer has a posting, the old score stays with a "Posting no longer available — score can't be updated" note, and no free rescore or analysis is used. No posting text is stored. *(Amended below for the web paste case and the monthly refund limit.)*
- Q: Should a violated dealbreaker lower the fit score? → A: No. The fit score reflects only how well the posting matches the candidate's skills, experience and seniority. Each violated dealbreaker (free-text or structured preference) is listed next to the score, and the score itself is never lowered or capped because of it. This replaces the earlier "cap at 20" behaviour.
- Q: The web has no paste screen. Where does a paste-sourced posting get rescored? → A: The web's Analyze document screen, renamed "Analyze posting", gains a "Paste text" option, so pasted postings can be analyzed and rescored on the web as well as in the extension's paste composer. The same text resolves to the same saved entry on both surfaces. Paste-sourced rows say "Paste again to rescore" everywhere. *(Revised 2026-10-28. This replaces the earlier answer, which kept paste rescores in the extension only.)*
- Q: The extension's "Open web app" control is a small grey icon that is easy to miss. What should it be? → A: A visible, labelled "Web app" button with the external-link icon, sized like the account bar's other buttons. Its tooltip, and what a screen reader announces, say that it opens in a new tab and that the web app asks the user to sign in with Google.
- Q: Should the web Library stay a flat list? → A: No. It becomes a timeline grouped by the day each posting was saved. Each entry shows the key facts without being opened: fit and verdict, salary, arrangement, location, seniority, status and source.
- Q: Does Compare need its own screen? → A: No. Compare opens as a pop-up dialog from the Library. The Compare page and its navigation entry are removed, and old `/compare` links go to the Library.
- Q: Which profile fields are added beyond résumé import, dealbreakers and the four planned preferences? → A: Two more. One is the most office days per week the user accepts, checked in code against the posting's stated office days. The other is whether the user needs visa sponsorship, judged by the model like locations. Minimum salary stays the only salary field. Other candidates are listed under Open Questions.
- Q: Does FR-M05's "per-analysis cost MUST NOT increase" bind every later PR, including US3's evidence quotes (estimated +$0.00015 to +$0.0003 per analysis, about +23% to +45% on the free tier)? → A: No. It binds the model switch only. Evidence is a feature cost: PR3 measures it on the eval and the product owner approves it in the PR.
- Q: Which model should Premium use? → A: `gpt-5.4-mini`, with FR-M05's cost limit waived for Premium. It costs about $0.006 per analysis, about $1.80 for a full 300-analysis month against $5.00 of revenue. It must still pass the quality gates (SC-002, SC-004, SC-008, SC-009 latency) and FR-M02. It retires 2027-09-21, so Premium needs another migration before then. Deployed and switched on 2026-10-29: deployment `gpt-5.4-mini` (version 2026-03-17, DataZoneStandard so processing stays in the US data zone, 50K TPM, $0.825/$4.95 per 1M tokens, about $0.0065 per analysis). Production setting `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` changed from `gpt-5.4-nano` to `gpt-5.4-mini` the same day, before PR1, after a two-posting probe through the production code path. Rollback: set it back to `gpt-5.4-nano`.
- Q: When the model, not the extension, finds that a re-opened page no longer holds a posting, the model call has already been paid for. Is that rescore always free? → A: Up to 10 times per account per month, then it counts like any other rescore. When the extension itself finds the page too thin to be a posting, nothing is sent and nothing is ever used, with no limit.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - I can trust that a score reflects my current profile (Priority: P1)

A user tightens their profile (adds a dealbreaker, rewrites their summary) and returns to postings they analyzed last week. Every score made against an older profile is visibly marked as out of date and offers a one-click rescore. When a posting violates a dealbreaker, the panel says so explicitly instead of only showing a low number.

**Why this priority**: A wrong score that looks right is worse than no score. Everything else in this spec builds on scores being trustworthy.

**Independent Test**: Analyze a posting, edit the profile, revisit the posting. It shows a "scored against an older profile" notice with a Rescore action, and rescoring clears the notice. Add a dealbreaker the posting violates and rescore: a dealbreaker banner names the violated line.

**Acceptance Scenarios**:

1. **Given** a saved posting scored against profile version A, **When** the user saves profile version B and opens that posting (extension panel, Saved tab row, web library, web detail), **Then** the score is marked as scored against an older profile, and a way to rescore is offered: "Rescore" in the extension panel on the posting's page, "Open posting to rescore" on library rows and web detail for postings from a URL, "Upload again to rescore" for postings from an uploaded document, and "Paste again to rescore" for postings from pasted text.
2. **Given** an out-of-date score, **When** the user clicks Rescore, **Then** the user is told beforehand what it costs ("free — 7 of 10 free rescores left this month", or "uses 1 analysis" once the free rescores are used up), and after it succeeds the score, breakdown and profile version all update in place, including in the saved library entry.
3. **Given** a profile with the dealbreaker "no fully on-site roles", **When** an on-site posting is analyzed, **Then** a banner above the score reads "Violates your dealbreaker: no fully on-site roles", and the score is not lowered by the violation: it falls in the same verdict band as when the posting is scored without that dealbreaker.
4. **Given** an out-of-date saved posting whose page has since been taken down, **When** the user opens the page and clicks Rescore, **Then** the old score stays, the panel notes "Posting no longer available — score can't be updated", the saved entry keeps that note, and no free rescore or analysis is used.
5. **Given** the web library sorted by fit, **When** some scores are out of date, **Then** they are visibly distinguished in the list, and the user can filter to "current profile only".
6. **Given** the user changes only whitespace in the profile, **When** they save, **Then** no score is marked out of date.

---

### User Story 2 - I understand what a score means at a glance (Priority: P2)

Next to the number, the user sees a plain-language verdict (**Strong match**, **Worth a shot**, **Stretch**, **Long shot**, **Dealbreaker**). The verdict's thresholds match a rubric the model was actually given, so 80 means the same thing across postings.

**Why this priority**: People triage by labels, not numbers. A shared rubric also makes scores comparable within a library.

**Independent Test**: Analyze postings across a spread of fit. Each shows a verdict label consistent with its score band, the same mapping applies in the extension and on the web, and the labels can be told apart without colour.

**Acceptance Scenarios**:

1. **Given** any fit scored under this feature, **When** it is displayed on any surface, **Then** a verdict label from the set in FR-009 is shown next to the score, derived from one mapping shared by all surfaces.2. **Given** a dealbreaker violation, **When** displayed, **Then** the verdict is "Dealbreaker", whatever the numeric score.
3. **Given** a screen-reader user, **When** focus reaches the score, **Then** the verdict and score are announced together ("Strong match, fit 86 out of 100").
4. **Given** a fit saved before this feature, **When** displayed, **Then** it shows its number with the label "Unrated — rescore for a verdict", and the verdict filter leaves it out.

---

### User Story 3 - I can verify why a skill counts as matched or missing (Priority: P3)

Each matching and missing item can be expanded or hovered to show its evidence. For a match, that's the résumé line that supports it and the posting line that asks for it. For a missing item, it's the posting line that requires it.

**Why this priority**: Evidence turns a verdict the user has to take on faith into one they can check, and it extends a principle the product already applies to work arrangement.

**Independent Test**: Analyze a posting with a known profile. Every evidence quote shown is a verbatim excerpt of the profile or the posting, and an item whose quote fails that check shows no evidence instead of an invented one.

**Acceptance Scenarios**:

1. **Given** a matching item, **When** the user expands it, **Then** they see a verbatim posting quote and a verbatim profile quote.
2. **Given** a missing or desired item, **When** expanded, **Then** they see a verbatim posting quote.
3. **Given** a model-returned quote that does not appear in its source, **When** the response is validated, **Then** the quote is dropped (the item stays) and a warning is logged, as already happens for work-arrangement evidence.
4. **Given** a posting saved before this feature (items with no evidence), **When** displayed, **Then** its items render as today, with no evidence affordance and no error.

---

### User Story 4 - Setting up my profile is quick (Priority: P4)

A new user uploads their résumé (`.pdf`/`.docx`) instead of pasting it, then fills a few structured preferences: acceptable arrangements, the most office days per week they accept, minimum salary and currency, seniority range, locations or timezones they can work in, and whether they need visa sponsorship. Arrangement, office-day, salary and seniority preferences are checked deterministically against the facts the analysis already extracts. The location/timezone and visa-sponsorship preferences are judged by the model, like free-text dealbreakers, because postings state them only as prose. Free-text dealbreakers remain for everything else.

**Why this priority**: Without a profile, the fit score, and much of the product's value, never appears. Checking preferences deterministically, where the posting's facts allow it, is free, consistent across runs, and immune to prompt drift.

**Independent Test**: Upload a résumé file. The profile text fills in for review before saving. Set "remote only" and analyze an on-site posting: the dealbreaker banner (US1) appears even if the model's own score was high.

**Acceptance Scenarios**:

1. **Given** the profile editor (extension options page or web Profile page), **When** the user uploads a `.pdf` or `.docx` résumé, **Then** the extracted text appears in the editor for review and is not saved until the user saves.
2. **Given** a résumé with no extractable text, **When** uploaded, **Then** the user sees the same plain-language message used for job-posting uploads.
3. **Given** a structured preference "remote only", **When** a posting is analyzed whose arrangement is confidently identified as on-site, **Then** the result is marked as a dealbreaker violation naming that preference, and the score is unchanged.
4. **Given** a posting whose arrangement is not stated, or which has no salary, **When** checked against a matching preference, **Then** it is not a violation. It appears as an "Unverified: arrangement not stated" (or equivalent) note in weaknesses instead.
5. **Given** a minimum salary in one currency and a posting in another, or with a different pay period, **When** checked, **Then** no violation is declared. The mismatch is noted as unverified.
6. **Given** a location preference "EU timezones only" and a posting restricted to "US residents only", **When** analyzed, **Then** the model reports the preference as violated, the dealbreaker banner names it, and the score is unchanged, exactly as for a free-text dealbreaker.
7. **Given** a preference of at most 2 office days a week, **When** a hybrid posting states 3 days in the office, **Then** the banner names "Office days: at most 2 per week" and the score is unchanged. A hybrid posting that doesn't state its office days gives an "Unverified: office days not stated" note instead.
8. **Given** "I need visa sponsorship", **When** a posting says it cannot sponsor visas, **Then** the model reports the preference as violated, the banner names "Work authorization: needs visa sponsorship", and the score is unchanged.
9. **Given** the web Profile page, **When** it opens, **Then** it is organized into headed sections: résumé (text and import), dealbreakers, and preferences. Confirmed skills join as a fourth section with US5.

---

### User Story 5 - I can correct a wrong verdict in one click (Priority: P5)

A missing-skill chip offers **"I have this"**. Clicking it adds the skill to a "Confirmed skills" section of the profile and offers to rescore this posting. The profile improves as a side effect of normal use.

**Why this priority**: The commonest complaint about automated matching is "it says I lack X but I have X". Fixing that in place keeps the user in the flow and improves every later score.

**Independent Test**: On a posting showing "Missing: Terraform", click "I have this". The profile now lists Terraform under confirmed skills, the score is marked out of date (US1), and a rescore moves Terraform to matching.

**Acceptance Scenarios**:

1. **Given** a missing or desired chip, **When** the user clicks "I have this", **Then** the skill is added to the profile's confirmed skills (no duplicates, ignoring case) and the profile is saved.
2. **Given** the user confirmed a skill by mistake, **When** they open the profile editor, **Then** confirmed skills are listed and individually removable.
3. **Given** a just-confirmed skill, **When** the save succeeds, **Then** the panel offers "Rescore this posting", showing its cost as in US1 #2, and does not rescore automatically.

---

### User Story 6 - I can triage and compare by fit wherever I am (Priority: P6)

The extension's Saved tab sorts and filters by fit and verdict, matching the web library. The web Library becomes a timeline grouped by the day each posting was saved, and each entry shows its key facts without being opened. Compare opens as a dialog from the Library instead of a separate page, and becomes a requirements table: rows are requirements gathered from the selected postings' breakdowns, columns are postings, and each cell shows matched / missing / nice-to-have / not asked. A header row shows score, verdict, salary and arrangement.

**Why this priority**: These are valuable but build on US1–US3. Sorting by out-of-date or unexplained scores would amplify the problems above.

**Independent Test**: Save postings with different scores. Sort the extension Saved tab by fit, highest first. Select three postings on the web and open Compare: a requirement shared by two of them appears as one row with cells in both columns.

**Acceptance Scenarios**:

1. **Given** the extension Saved tab, **When** the user picks "Fit (highest)", **Then** rows sort by score, with unscored postings last, and out-of-date scores are marked.
2. **Given** two to four postings selected for comparison, **When** Compare opens, **Then** requirements that differ only in case or whitespace merge into one row, and each cell's state comes from that posting's breakdown.
3. **Given** a narrow viewport, **When** Compare renders, **Then** the dialog fills the screen and the table scrolls horizontally inside its container, never the page.
4. **Given** postings saved on several days, **When** the user opens the web Library sorted by date, **Then** postings are grouped under "Today", "Yesterday" and dated headings, newest first. Each entry shows title, company, verdict and fit, salary, arrangement, location, seniority, status and source.
5. **Given** the Library sorted by fit, **When** it renders, **Then** entries form one ranked list without date headings, and each entry shows its save date.
6. **Given** two to four postings selected in the Library, **When** the user clicks Compare, **Then** a dialog opens over the Library. Escape or Close returns to the Library with focus back on Compare and the selection kept. Opening a posting's full analysis from the dialog goes to its detail page.

### Edge Cases

- **No profile**: the current "Configure profile" call to action stays. Out-of-date and verdict UI never appear for an unscored result.
- **Profile deleted after scoring**: existing scores are marked "scored against a deleted profile". Rescore yields an unscored result.
- **Profile fetch fails at analysis time**: as today, the analysis runs without a profile. The result must say "Fit not scored — your profile couldn't be loaded", not imply that no profile exists.
- **Web upload before the profile has loaded**: today [`Upload.tsx`](../../web/src/pages/Upload.tsx) can send a document before the profile request resolves, which silently yields an unscored result. Upload MUST wait for the profile request to settle (success or failure) first.
- **Usage allowance exhausted**: when the free rescores and the analysis allowance are both used up, Rescore and "I have this → rescore" show the existing allowance-exhausted state instead of failing silently. While free rescores remain, Rescore still works even if the analysis allowance is exhausted. Marking a score out of date never uses an analysis or a free rescore.
- **Posting taken down**: re-opening a saved posting whose page no longer holds a posting (removed, "position filled", login wall) leaves the previous score in place, marked "Posting no longer available — score can't be updated". The posting stays in the library and keeps sorting by its last score.
- **Document or paste source without the original**: if the user no longer has the file or text, the score simply stays out of date. Nothing is lost.
- **"Upload again" or "Paste again" with different content**: if the file or text the user provides resolves to a different posting than the one being rescored, the saved posting is left unchanged. The result is shown as a new analysis with "Save to library" and the note "This didn't match the saved posting, so it was analyzed as a new one."
- **Rescore fails** (model error, timeout): the free rescore or analysis is not consumed, and the previous score stays, still marked out of date.
- **Pre-feature saved postings** (no recorded profile version): treated as "profile version unknown". They show a softer "may be out of date" notice, not the out-of-date notice. Because they weren't scored against the rubric, they show no verdict: the number appears with the label "Unrated — rescore for a verdict". They are left out of verdict filters and still sort by number.
- **Free-to-Premium switch**: a score made by a different model tier is labelled with that tier in its details, but it isn't marked out of date for that reason alone.
- **Confirmed skills near the 20,000-character cap**: the confirmed-skills section counts toward the cap. Adding past it is refused with the existing over-limit message.
- **"I have this" while offline or the save fails**: the chip stays as it was and the existing save-error message is shown. No rescore is offered.

## Requirements *(mandatory)*

### Functional Requirements — Parity (baseline)

- **FR-001**: Every flow that requests a fit score (extension page analysis, paste and region-selection flows, web document and paste analysis) MUST send the profile in one shared serialized form that includes the profile text, dealbreakers and, once US4/US5 land, structured preferences and confirmed skills. Each flow MUST have an automated test asserting this. *(Delivered for dealbreakers in `f1d229d`.)*

### Functional Requirements — Scoring Model (prerequisite for all stories)

- **FR-M01**: Before any rubric, verdict or stability work is measured, the free tier MUST move to a scoring model with a provider retirement date no earlier than 2028-01-01, and the switch MUST ship well before the current free model's retirement (2027-04-14).
- **FR-M02**: The Premium tier MUST remain at least as good as the free tier on the fit evaluation (FR-M03). If the new free model matches or beats the current Premium model, Premium MUST move up as well.
- **FR-M03**: The evaluation corpus MUST include realistic, full-length postings (not only short synthetic snippets) paired with fixture profiles that carry dealbreakers and structured preferences, and it MUST score fit as well as extraction. Model selection for FR-M01/FR-M02 and SC-002 to SC-004 are measured on it.
- **FR-M04**: Model-specific request settings (for example, whether a model accepts a fixed sampling temperature, or how much internal reasoning it uses) MUST be configurable per deployment, so a model swap is a configuration change, not a code change.
- **FR-M05**: Switching models MUST NOT change free or Premium pricing or allowances, and the model switch MUST NOT increase the per-analysis model cost on either tier. This limit applies to the model switch only. A later story that adds model output, such as US3's evidence quotes, reports its measured cost increase as a feature cost, and the product owner approves it in that story's PR. **Waived for Premium on 2026-10-29**: Premium moves to `gpt-5.4-mini`, about 3.7× today's Premium cost per analysis. The no-increase limit still binds the free tier.

### Functional Requirements — Freshness and Dealbreakers (Story 1)

- **FR-002**: The system MUST record, with every fit result, which version of the profile it was scored against, and MUST expose the current profile version wherever the profile is read or saved. A profile version MUST depend only on the profile's meaningful content: whitespace-only edits and save timestamps MUST NOT change it.
- **FR-003**: A fit is **out of date** when its recorded profile version differs from the current one. Every surface that shows a fit (extension panel, Saved tab row, web library row, web detail, compare) MUST mark out-of-date fits and offer a way to rescore them (FR-003a).
- **FR-003a**: Because saved postings do not keep the posting text, a rescore MUST run only where the posting text is available again: the extension panel on the posting's page, the web Analyze posting screen (an uploaded document, or pasted text through its Paste text option), or the extension's paste composer (pasted text). Elsewhere the surface MUST offer "Open posting to rescore" (opens the source page, where the panel offers Rescore) for postings from a URL, "Upload again to rescore" for postings from an uploaded document, or "Paste again to rescore" for postings from pasted text. A rescore that finds no posting on the page MUST keep the previous score and record and show "Posting no longer available — score can't be updated" on the saved entry. When the extension detects this before sending anything, nothing is consumed. When the model detects it, the rescore is refunded up to 10 times per account per month; beyond that it is charged like any other rescore, because each one is a paid model call.
- **FR-004**: Rescore MUST state its cost before running, and MUST update both the cached and the saved analysis in place. Each account gets 10 free rescores per month, resetting when the analysis allowance resets. A rescore is free while any remain. After that it costs 1 analysis. A rescore is a re-analysis of a posting whose fit is out of date or version-unknown, started from Rescore or from one of the FR-003a actions ("Open posting to rescore", "Upload again to rescore"). Any other analysis is metered as today.
- **FR-004a**: The system MUST track free-rescore usage per account on the server, show the remaining count wherever Rescore is offered, and consume a free rescore (or an analysis) only when the rescore succeeds.
- **FR-005**: Every fit result MUST list the dealbreakers and structured preferences it violates, each worded as the user wrote it. Violations MUST NOT change the score: the score reflects only how well the posting matches the candidate's skills, experience and seniority. The model MUST be instructed not to lower the score for dealbreakers, and the system MUST NOT adjust the score after the model responds.
- **FR-006**: When a fit lists violations, the UI MUST show a dealbreaker banner above the score that names each one.
- **FR-007**: After a profile save, an open panel showing a result for the current page MUST offer to rescore it. It MUST NOT rescore automatically.

### Functional Requirements — Verdict and Rubric (Story 2)

- **FR-008**: The model MUST be given a scoring rubric with explicit bands: 85–100 all required skills covered and seniority aligned; 65–84 minor gaps; 40–64 significant gaps or a level mismatch; 0–39 major mismatch.
- **FR-009**: One mapping, shared by the extension and the web, MUST turn score plus violations into a verdict for every fit that records a profile version (that is, every fit scored under this feature). Fits without one get no verdict and the label "Unrated — rescore for a verdict". The verdicts are: **Strong match** (85–100), **Worth a shot** (65–84), **Stretch** (40–64), **Long shot** (0–39), or **Dealbreaker** (any violation). Score colours MUST come from the same mapping.
- **FR-010**: Verdicts MUST be distinguishable without colour: always a text label, plus an icon where space allows.

### Functional Requirements — Evidence (Story 3)

- **FR-011**: Each matching, missing and desired item MUST be able to carry a posting quote, and each matching item a profile quote. Surfaces MUST still render analyses saved before this feature, whose items carry no evidence.
- **FR-012**: The system MUST drop any quote that does not appear verbatim (ignoring whitespace differences) in its source, keep the item, and log a warning.
- **FR-013**: Evidence MUST be reachable by keyboard and pointer, hidden until requested, and MUST NOT increase the panel's default height.

### Functional Requirements — Profile Setup (Story 4)

- **FR-014**: Both profile editors MUST accept a `.pdf`/`.docx` résumé upload, using the same text extraction as job-posting uploads. The extracted text fills the editor for review, nothing is saved until the user saves, and importing MUST NOT use an analysis from the allowance.
- **FR-015**: The profile MUST gain optional structured preferences: acceptable work arrangements, the maximum office days per week (0 to 5), minimum salary (amount, currency, pay period), seniority range, acceptable locations or timezones, and whether visa sponsorship is needed. Both profile editors MUST group the profile into headed sections: résumé text with import, dealbreakers, preferences, and, once US5 lands, confirmed skills.
- **FR-016**: The arrangement, office-day, minimum-salary and seniority preferences MUST be checked deterministically after the model responds, against the posting's extracted arrangement, office days, salary and seniority. The location/timezone and visa-sponsorship preferences MUST NOT be checked in code. The model judges them like free-text dealbreakers, and any violation it reports enters the violation list (FR-005). No violation changes the score. For the code-checked preferences, a preference counts as violated only when the posting's value is known and contradicts it. When the posting's value is unknown, or not comparable (different currency or pay period), the system MUST add an "Unverified: …" weakness instead of declaring a violation.
- **FR-017**: Structured preferences MUST also be sent to the model (FR-001), so its rationale and lists take them into account.

### Functional Requirements — Correction Loop (Story 5)

- **FR-018**: Missing and desired items MUST offer "I have this", which adds the item's label to the profile's confirmed skills and saves the profile.
- **FR-019**: Both profile editors MUST list confirmed skills, each individually removable.
- **FR-020**: After a confirmation, the surface MUST offer a way to rescore (Rescore in the panel on the posting's page; otherwise the FR-003a alternatives) and MUST NOT rescore on its own.

### Functional Requirements — Triage and Compare (Story 6)

- **FR-021**: The extension Saved tab MUST support sorting by fit (highest and lowest first) and filtering by verdict, with unscored postings sorted last.
- **FR-022**: Compare MUST open as a modal dialog from the web Library when two to four postings are selected. It MUST render a requirements table as described in US6, merging requirement labels that differ only in case or whitespace, with each posting's full analysis still one click away. The dialog MUST keep focus inside while open, close on Escape or Close, return focus to the Compare button, and fill the screen on narrow viewports. The separate Compare page and its navigation entry MUST be removed, and `/compare` MUST redirect to the Library.
- **FR-029**: The web Library MUST show saved postings as a timeline grouped by the calendar day each was saved, in the viewer's time zone, newest first. With the "Saved (oldest)" sort, both the groups and the entries inside them run oldest first, with the same headings. Group headings MUST read "Today", "Yesterday", or the weekday and date (for example "Monday, October 26"), with the year added outside the current year. Filters apply within groups, and empty groups are hidden. When sorted by fit, the Library MUST instead show one ranked list without date headings, with each entry's save date on it.
- **FR-030**: Each Library entry MUST show, without being opened: title and company; verdict and fit score, with any out-of-date marker; salary as stated, or "Salary not stated"; arrangement, with office days for hybrid postings when stated, or "Arrangement not stated"; location and seniority when known; status; and source (the site's host name, the file name, or "Pasted"). Salary and arrangement MUST be formatted the same way as on the posting's detail page.

### Cross-Cutting Requirements

- **FR-023**: The extension and the web MUST derive verdicts, out-of-date status and legacy-analysis handling from the same shared logic, so the two surfaces can't drift apart again.
- **FR-024**: The "My profile" control in the score header MUST be a secondary action, so it doesn't compete with Save.
- **FR-025**: In the extension panel, the default fit view MUST show the verdict, score, rationale and up to three missing items, with "Show full breakdown" revealing the rest.
- **FR-026**: Every capability in this feature MUST be available to free and Premium accounts alike, with no new tier gating. Tiers keep differing only in model, monthly analysis allowance and saved-postings cap.
- **FR-027**: The web screen for analyzing a document, renamed "Analyze posting" because it now takes pasted text too, MUST offer a "Paste text" option next to file upload. Pasted text MUST be checked against the same length limits, with the same messages, as the extension's paste composer before anything is sent, so a paste that is too short or too long uses nothing. The same text MUST resolve to the same saved posting whether it was pasted on the web or in the extension. The result MUST be saveable to the library as a pasted posting.
- **FR-028**: The extension's link to the web app MUST be a visible, labelled control reading "Web app" with an external-link icon. It MUST be at least 24 × 24 px and styled like the account bar's other secondary buttons. Its tooltip and its screen-reader description MUST say that it opens in a new tab and that the web app asks the user to sign in with Google.

### User-Facing Vocabulary

| Term | Meaning | Never call it |
|------|---------|---------------|
| **Fit** / **fit score** | The 0–100 profile match for one posting | "rating", "grade" |
| **Verdict** | The label derived from the fit (FR-009) | "status", "tier" |
| **Out of date** | Scored against an older profile version | "stale" (internal only), "expired" |
| **Dealbreaker** | A free-text dealbreaker or a structured preference the posting violates | "blocker", "red flag" |
| **Rescore** | Re-run the analysis against the current profile | "refresh", "re-analyze" |
| **Confirmed skills** | Skills the user added via "I have this" | "verified skills" |

### Key Entities

- **Candidate Profile** (extended): profile text and dealbreakers as today, plus optional structured preferences (arrangements, maximum office days, minimum salary, seniority range, locations or timezones, and visa sponsorship), a list of confirmed skills, and a profile version derived from its content.
- **Fit** (extended): adds the list of violated dealbreakers and preferences and the profile version it was scored against. Matching, missing and desired items gain optional evidence quotes; items without evidence remain valid. The model tier that scored it is already recorded on the analysis.
- **Usage** (extended): alongside the monthly analysis count, a monthly free-rescore count and a monthly count of refunded "posting no longer available" rescores per account, reset on the same schedule.
- **Verdict**: derived, never stored. Computed from score and violations by the shared mapping.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of fits shown on any surface either match the current profile version or carry an out-of-date or version-unknown marker.
- **SC-002**: On the posting evaluation corpus, every posting that violates a fixture dealbreaker or structured preference is reported as a dealbreaker, and in at least 90% of those pairs the fit score falls in the same verdict band as when the same profile is scored with its dealbreakers and preferences removed (the score does not depend on dealbreakers).
- **SC-003**: On the evaluation corpus, at least 95% of evidence quotes returned by the model pass the verbatim check, and 100% of quotes shown to users are verbatim.
- **SC-004**: Re-running the same posting and profile 5 times yields the same verdict in at least 90% of corpus postings.
- **SC-005**: A first-time user with a résumé file reaches their first fit score in under 2 minutes from opening the profile editor.
- **SC-006**: For the same stored profile, the extension and the web send byte-identical profile content to the analysis.
- **SC-007**: A user can turn a wrong "missing" verdict into a rescored result in no more than 2 clicks from the panel.
- **SC-008**: On the evaluation corpus, the free tier never reports a dealbreaker violation for a fact the posting does not state (0 false dealbreakers), and arrangement accuracy stays at or above the current 100% on the existing fixtures.
- **SC-009**: After the model switch, the median model cost per free analysis is no higher than before, and p95 analysis latency stays within the 30-second budget (Constitution IV).

## Assumptions

- Rescoring re-runs the full analysis. The first 10 rescores each month are free (FR-004), and later ones count against the allowance like any other analysis. The 10-per-month limit is the same for free and Premium accounts.
- Saved postings keep storing the analysis only, not the posting text. Rescoring therefore needs the source page, file or text again (FR-003a), and bulk rescoring is out of scope (see Out of Scope).
- Dealbreaker violations, free-text or structured, never change the fit score. They are listed next to it, so "Dealbreaker" means the same thing whichever way it was stated.
- "I have this" stays one click. It does not ask for an evidence note.
- No currency or pay-period conversion. Mismatches are "unverified", never violations.
- The profile version reflects only the profile's meaningful content, not when it was saved.
- The model tier affects score quality but does not make a score out of date.
- Résumé import reuses the job-posting document limits (formats, size, no OCR) from feature 004.
- The posting evaluation corpus used for SC-002 to SC-004 and SC-008 gains full-length postings and fixture profiles with dealbreakers and structured preferences (FR-M03).
- The model switch (FR-M01 to FR-M05) is delivered first, as its own PR within this feature, so every later story is built and measured on the model that will remain.

## Out of Scope

- Bulk rescoring of the whole library. Saved postings don't keep the posting text, so a bulk rescore would mean re-visiting each page.
- A fit-only rescore that reuses stored extraction fields instead of re-running the full analysis.
- Application help built on the breakdown (résumé tailoring, cover-letter talking points, interview prep). This is a strong Premium candidate for a follow-up feature that uses US3's evidence.
- Multiple profiles per account (for example, "IC track" and "management track").
- Currency or pay-period conversion for salary preferences.

## Open Questions

None blocking. The first draft's four open questions were resolved as defaults in Assumptions and can be revisited with `/speckit-clarify`:

1. Store a bounded posting excerpt to enable library-wide rescoring → **resolved in Clarifications**: no posting text is stored. Rescore needs the page (or the original file or text) again.
2. Rescore cost → **resolved in Clarifications**: 10 free rescores per month, then 1 analysis each.
3. Structured-preference violations hard-cap the score → **superseded in Clarifications**: no violation changes the score.
4. "I have this" asks for an evidence note → **no**; one click.
5. More profile fields → **two added in Clarifications** (office days and visa sponsorship). Not added, pending a decision:
   - employment type (full-time, contract, part-time), which the analysis doesn't extract yet, so it would need a model-schema change and an eval re-run;
   - target job titles, which the résumé text largely covers already;
   - industries or companies to avoid, which free-text dealbreakers already handle.

## Technical Shape *(non-binding — inputs to planning)*

- **Model switch (FR-M01 to FR-M05) — measured 2026-10-28** (eastus2, `job-posting-analyzer-openai`; retail prices from the Azure Retail Prices API):
  - Current: free `gpt-4o-mini` 2024-07-18 (Deprecated, retires 2027-04-14, $0.15/$0.60 per 1M in/out); Premium `gpt-5.4-nano` 2026-03-17 (GA, retires 2027-09-21, $0.20/$1.25).
  - Candidate free model: **`gpt-6-luna` 2026-09-22** (GA, retires 2028-03-11, $0.10/$0.50 standard global short-context; long-context $0.20/$0.75, threshold unconfirmed). A `gpt-6-luna` deployment (GlobalStandard, 20K TPM) already exists in the resource but is not wired to any app setting.
  - **Required code change**: `gpt-6-luna` rejects `temperature: 0` (default 1 only), which `jobExtractionOrchestrator.ts` sends unconditionally. It accepts `reasoning_effort` `none | low | medium | high | xhigh` (not `minimal`). Add per-deployment settings (FR-M04), e.g. `AZURE_OPENAI_JOB_TEMPERATURE` / `AZURE_OPENAI_JOB_REASONING_EFFORT` and their `_PREMIUM` counterparts, omitted from the request when unset.
  - Probe results on the Intuit corpus posting (3.67K input tokens) plus a dealbreaker profile:

    | Model / setting | Score(s) | Unstated arrangement | Output tokens | ≈ $/analysis | Latency |
    |---|---|---|---|---|---|
    | `gpt-4o-mini` | 20 | Invented "onsite" → false dealbreaker | 428 | 0.00081 | 5.7 s |
    | `gpt-5.4-nano` | 20 | "Not stated" treated as violation | 694 | 0.0016 | 5.1 s |
    | `gpt-6-luna`, default effort | 67, 56 | Unverified (correct) | 1,053–1,206 (466–615 reasoning) | ~0.0009 | 9–11 s |
    | `gpt-6-luna`, `low` | 72, 59, 64 | Unverified (correct) | ~725 (~155 reasoning) | ~0.0007 | ~8 s |
    | `gpt-6-luna`, `none` | 60, 56, 63 | Unverified (correct) | ~580 (0 reasoning) | ~0.00066 | ~5.5 s |

  - Starting point for the plan: free → `gpt-6-luna` with `reasoning_effort: none` (scores stayed in one verdict band; default effort crossed the 64/65 boundary, which SC-004 would fail). Premium → re-evaluate on the FR-M03 corpus: `gpt-6-luna` at `low`/`medium`, or `gpt-5.4-mini` ($0.75/$4.50, retires 2027-09-21). Rejected: `gpt-5-nano` (retires 2027-02-09, before the model it would replace), Mistral Small/Ministral (retire 2026-12-09), and non-OpenAI Foundry models (the resource is kind `OpenAI`; they would need a new AIServices resource, and strict structured output isn't guaranteed).
  - **Decided 2026-10-29**: Premium → `gpt-5.4-mini` at temperature 0, with FR-M05 waived for Premium. It still has to pass the PR1 eval's quality gates, and is rolled back or replaced by R2's fallback if it fails. Deployed and switched on 2026-10-29: deployment `gpt-5.4-mini` (version 2026-03-17, DataZoneStandard so processing stays in the US data zone, 50K TPM, $0.825/$4.95 per 1M tokens, about $0.0065 per analysis). Production setting `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` changed from `gpt-5.4-nano` to `gpt-5.4-mini` the same day, before PR1, after a two-posting probe through the production code path. Rollback: set it back to `gpt-5.4-nano`.
  - Caveats: one posting and a few runs; the existing 6-posting eval (arrangement only, no profile) passed 100% on all three models. Prompt caching bills cache writes at $0.125/1M for `gpt-6-luna`, above its uncached input price, so cost must be measured on the FR-M03 corpus (SC-009).

- **Shared serialization (FR-001)**: every flow already goes through `profileToPromptText` in [`shared/types/profile.ts`](../../shared/types/profile.ts). Extend it with preferences and confirmed skills, and keep a contract test per surface.
- **Profile version (FR-002)**: SHA-256 of the whitespace-normalized `profileToPromptText` output, computed server-side in [`profileRepository.ts`](../../functions/src/services/profileRepository.ts) (on read and write, returned from `GET /profile` and `PUT /profile`) and in `orchestrateJobAnalysis` (from the profile it actually scores, `profileData` when sent and otherwise `req.profile`; stored as `fit.profileFingerprint`; see research R5), so the client never hashes anything.
- **Schema (FR-005, FR-011)**: extend `JOB_ANALYSIS_SCHEMA.fit` with `dealbreakersViolated: string[]` and add evidence as a separate optional `fit.evidence` object. `matching / missing / desired` stay string arrays, because published extension builds render them directly and would crash on objects (research R4).
- **Deterministic checks (FR-005, FR-016)**: a pure `applyPreferences(payload, preferences)` step after `validateEvidence` and `enforceConsistency`, which never changes the score; unit-tested on its own. Arrangement violations require `arrangementConfidence ≠ none`. `remoteRestrictions` is free text (`string | null`), so `applyPreferences` ignores the location preference; it reaches the model through `profileToPromptText`, and the model's `dealbreakersViolated` entries for it are kept as-is.
- **Quote validation (FR-012)**: generalize `validateEvidence` to the new item quotes.
- **Shared UI logic (FR-009, FR-023)**: `shared/` already holds types and design tokens. Add a framework-free `fitView.ts` (verdict, out-of-date detection, legacy normalization) that both the extension and the web import; replace the hard-coded thresholds in `FitScore.tsx`.
- **Freshness in the extension (FR-003)**: `needsFitRefresh` in [`jobFlow.ts`](../../extension/services/jobFlow.ts#L218) must not auto-rescore on a version mismatch (that would spend allowance silently); it marks instead.
- **Rescore paths (FR-003a)**: `SavedJobEntity` ([`user.ts`](../../functions/src/models/user.ts#L131)) holds no posting text, and `source` (`url` / `document` / `paste`) picks the library-row action. "Posting no longer available" fires when re-extraction hits `thin-content` or the model returns `isJobPosting: false` for a page previously saved as a posting. Record it as a field on the saved entry (for example, `unavailableAt`) so every surface shows it. Metering charges before the model call and refunds the charged counter on failure, so a failed rescore costs nothing (research R6).
- **Résumé upload (FR-014)**: a new `POST /profile/import` that reuses `extractDocument` and returns text only (no metering, no model call).
- **Exhausted allowance**: reuse the existing `UsageExhausted` component for Rescore.
- **Free-rescore metering (FR-004, FR-004a)**: add a monthly `rescoresUsed` counter next to the existing usage counter, reset on the same boundary. The analyze request carries a `rescore: true` flag plus the posting's prior `profileFingerprint`. The server decides eligibility itself: a saved posting's stored fingerprint is authoritative, and otherwise the claimed prior fingerprint must be one the account has actually had (research R6), so the flag can't be used to get free first-time analyses. The free-rescore limit belongs in the plan's overage/cost notes (Constitution V): each free rescore is an unbilled model call.
