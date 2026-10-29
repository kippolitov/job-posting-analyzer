# Implementation Plan: Trustworthy, Actionable Profile Match

**Branch**: `006-profile-match-ux` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-profile-match-ux/spec.md`
(clarified 2026-10-28; the Clarifications are inputs, not reopened here).

## Summary

The fit score is the product's core promise, but today it goes stale silently,
looks the same whether a posting is a dealbreaker or merely weak, has no defined
meaning, and can't be checked or corrected. On top of that, the free tier's
scoring model retires on 2027-04-14.

This plan delivers the feature as **six PRs in a fixed order**. Each PR is
independently deployable, and each one keeps the published extension and the web
app working against the deployed backend.

1. **Scoring-model switch (FR-M01–M05)**: per-deployment request settings,
   configurable API version, an eval harness over full-length postings and
   dealbreaker profiles, and a measured choice of free and Premium models.
   Expected outcome: free moves to `gpt-6-luna` at `reasoning_effort: none`, and
   Premium is chosen by the rule in research R2.
2. **US1 + US2**: profile fingerprints, out-of-date marking, free-rescore
   metering, dealbreakers listed next to an unchanged score, the rubric, and the shared verdict
   mapping in `shared/fitView.ts`.
3. **US3**: verbatim evidence quotes.
4. **US4**: résumé import and structured preferences.
5. **US5**: "I have this".
6. **US6**: Saved-tab triage, the timeline Library, and Compare as a
   requirements-table dialog opened from the Library.

**Decisions that shape every PR**, from [research.md](./research.md):

- **Additive-only fit shape (R4).** The published `FitScore.tsx` renders chip
  items as React children, so object items would crash any extension build still
  in Chrome Web Store review. Label arrays therefore stay `string[]` forever.
  Evidence, violations and the fingerprint are new optional fields.
- **The server serializes the profile (R5).** New clients send `profileData`,
  and the server runs the shared `profileToPromptText` and fingerprints the
  result. That makes SC-006 hold by construction and lets an old client's fits
  carry an honest fingerprint.
- **Rescore eligibility is verified on the server (R6).** The saved row's
  fingerprint is authoritative. Otherwise the claimed prior fingerprint must be in
  the account's fingerprint history. The 10-per-month cap is the abuse ceiling.
- **Three hazards were found in existing code and are fixed test-first:**
  - the Usage row's `Replace` writes would erase the new rescore counter (R6);
  - an old client's profile `PUT` would erase preferences (data-model §3);
  - `analyze-job` charges for invalid requests (R6 side fix).

## Technical Context

**Language/Version**: TypeScript 5.x (strict). Node 20 for Azure Functions
(`functions/`). React 18 in `extension/` (WXT, Chrome MV3) and `web/` (Vite SPA
on Azure Static Web Apps). Pure TypeScript source in `shared/`, imported directly
with no build.

**Primary Dependencies**: no new runtime dependencies.
- `openai` ^6.42 (`AzureOpenAI`, chat completions with strict `json_schema`).
- `@azure/data-tables` ^13.2.
- `mammoth` and `unpdf`, already used by 004's extraction, now reused for résumé
  import.
- Playwright, already a dev dependency in `extension/`, for the corpus export.

**Storage**: Azure Table Storage, with additive columns only.
- `Profiles` gains `preferences`, `confirmedSkills` and `fingerprintHistory`.
- `Usage` gains `rescoresUsed` and `unavailableRefunds`.
- `SavedJobs` gains `unavailableAt`.
- The extension's `chrome.storage.session` gains a `profile:fingerprint` key.

No new tables and no row rewrites. See [data-model.md](./data-model.md).

**Testing**: Vitest in all three packages, using recorded model fixtures under
`functions/tests/fixtures/jobAnalysis/` (Principle II, "no hollow mocks").
Integration tests run against Azurite. Playwright covers e2e and the corpus
export. The live-model eval harness runs on demand, never in CI.

**Target Platform**: Azure Functions (Linux, consumption plan), Chrome MV3
extension, and an evergreen-browser SPA.

**Project Type**: monorepo with `functions/`, `extension/`, `web/` and `shared/`.
This feature touches all four.

**Performance Goals**:
- Analysis p95 at or below 30 s (Constitution IV).
- No p95 regression of 20% or more on the CI benchmark (QG-4).
- Measured `gpt-6-luna` at `none`: about 5.5 s, against 5.7 s for `gpt-4o-mini`.
- Evidence (PR3) is the main latency risk (R9).

**Constraints**:
- Every PR must keep the published extension and web working against the
  deployed backend. The backend always deploys first, and the extension lags by
  the length of Chrome Web Store review.
- No prod app-setting or Azure resource change without asking you. The ones this
  feature needs are listed in the next section.
- Test-first, and at least 80% coverage on changed modules.
- No posting text is stored (Clarification 5).
- Every capability is available on both tiers (FR-026).

**Scale/Scope**:
- 2 tiers, with 50 and 300 analyses per month, plus 10 free rescores per month.
- 4 surfaces show fits: the extension panel, the Saved tab, the web library and
  detail pages, and Compare.
- The eval corpus has 11 postings (6 short, 5 full-length) × 4 profiles, giving
  44 labelled pairs.
- Deployment capacity is 20K TPM on `gpt-6-luna`.

## Changes requiring your approval

None of these happen without asking you at the time.

| When | Change | Why | Reversible |
|---|---|---|---|
| Before merging PR1 | Set `AZURE_OPENAI_JOB_TEMPERATURE=0` and `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM=0` on `job-posting-analyzer-func` | Keeps today's behaviour once temperature becomes optional (R1). The running code ignores them. | Yes, delete them |
| **Done 2026-10-29** | Created deployment `gpt-5.4-mini` (version 2026-03-17, DataZoneStandard, 50K TPM) and switched `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` from `gpt-5.4-nano` to `gpt-5.4-mini` | Premium's chosen model (R2), approved by you | Yes, set the setting back to `gpt-5.4-nano`, then delete the deployment |
| After the PR1 eval sign-off | Free: `AZURE_OPENAI_JOB_DEPLOYMENT=gpt-6-luna` and `AZURE_OPENAI_JOB_REASONING_EFFORT=none`, and delete the free temperature. Premium: already on `gpt-5.4-mini`; it stays if it passes the eval's quality gates, otherwise it reverts or takes R2's fallback. | FR-M01, FR-M02 | Yes, restore the old values |
| Only if `gpt-5.4-mini` fails and the fallback picks `gpt-6-luna` for Premium | Share the 20K TPM deployment, raise its TPM, or create a second `gpt-6-luna` deployment | Capacity (R2) | Yes |
| Before the free switch | Confirm the privacy-policy wording covers GlobalStandard cross-region processing of résumé text | Data handling (R2) | n/a |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Derived from `.specify/memory/constitution.md` v1.2.0:

| Principle | Gate | Status |
|-----------|------|--------|
| **I. Code Quality** | Meaningful naming, no dead code, single responsibility, review | ✅ PASS. Single-purpose pure units: `resolveModelConfig`, `profileFingerprint`, `resolveDealbreakers` / `applyPreferences`, `validateQuotes`, and `fitView`. Dead code is removed rather than kept: `scoreStyle` with its hard-coded 70/20 thresholds, and `needsFitRefresh`'s silent auto-refresh branches (R7). |
| **II. Testing Standards** | Test-first; ≥ 80% on changed modules; recorded fixtures; E2E for P1 journeys | ✅ PASS. Each PR's quickstart table becomes failing tests first. Model behaviour uses recorded fixtures. The live eval decides models but does not gate merges, because it is non-deterministic and costs money. **P1 E2E (US1)**: out-of-date marking and Rescore in the extension e2e suite, using the localhost fixture server, including the taken-down page. `shared/fitView.ts` gets coverage through both clients' suites, which share one fixture table (R10). |
| **III. UX Consistency** | Progress over 300 ms; plain-language errors with an action; stable terms; WCAG 2.1 AA | ✅ PASS. Rescore reuses the existing analyzing spinner. Every new error state names a next action (unavailable posting, exhausted allowance, failed import). New copy follows the spec's vocabulary table, so the UI says "Rescore", never "refresh". Verdicts are text plus icon, never colour alone (FR-010). Evidence is reachable by keyboard (FR-013). The screen-reader label is pinned by a test. **Watch item for QG-3**: the score header gains a banner, a freshness notice, a cost line and a secondary "My profile" button. FR-025's default collapsed view is what keeps this within the panel. |
| **IV. Performance** | ≤ 30 s; non-blocking; ≤ 512 MB; reject a p95 regression of 20% or more | ⚠️ **PASS WITH A WATCH ITEM.** PR1 is neutral to slightly faster at `none`. PR2 adds one point read (`SavedJobs`) and one profile read for rescore intents only, each a few ms. **PR3 evidence may add 2–4 s**, which is above 20% of about 5.5 s. If the R9 mitigations don't bring it under, PR3 carries a documented QG-4 exception for your approval, since the absolute p95 stays far below 30 s. |
| **V. Cost Discipline** | Free tier first; overage documented before adoption | ✅ PASS. No new infrastructure. The free rescores and refunded "unavailable" rescores are unbilled model calls, documented in the next section. The model switch lowers the free tier's per-analysis cost. |

**Quality Gates**:
- QG-1: lint with zero warnings in all three packages.
- QG-2: as above.
- QG-3: UX review of the score header, Rescore cost line and banner (PR2), the
  evidence disclosure (PR3), the import flow and Profile sections (PR4), and the timeline Library and
  Compare dialog (PR6).
- QG-4: `perf.test.ts` on every PR. PR1 also reports live p95.

**Development Workflow**: each PR targets `main` from its own branch, cut from
`main` after the previous PR merges. PR1 uses `006-profile-match-ux`, which
already carries the planning artifacts. PR2 to PR6 use `006-freshness-verdict`,
`006-evidence`, `006-profile-setup`, `006-confirm-skills` and
`006-triage-compare`. There are no dependency upgrades:
`openai` ^6.42 already supports `reasoning_effort`. Docs ship in the same PR
under `contracts/`. Every PR's `## Summary` feeds the auto-changelog.

**Post-design re-check (after Phase 1)**: ✅ no new violations. The design added
three pre-existing-hazard fixes. The QG-4 exception for PR3 is still only a
possibility, and it is handled per the constitution's exception rule if it
happens.

## Cost note — unbilled model calls (Constitution V, Overage awareness)

| Item | Free quota | Rate | Worst case per account per month |
|---|---|---|---|
| Free rescores (FR-004) | 10 | Unbilled model call | Free ≈ 10 × $0.00066 = $0.0066. Premium on `gpt-5.4-mini` ≈ 10 × $0.006 = $0.06. |
| Refunded "posting unavailable" rescores (FR-003a) | 10 (`unavailableRefunds`) | Unbilled model call | The same again |
| **Ceiling** | | | **≤ 20 unbilled calls**: free ≤ $0.013 (about 40% above the ≈ $0.033 cost of a full 50-analysis month); Premium ≤ $0.12 against $5.00 revenue. A full 300-analysis Premium month costs about $1.80 on `gpt-5.4-mini`, with FR-M05 waived for Premium. |
| Résumé import (FR-014) | Rate-limited per IP | CPU only, no model call | ≈ $0 on the consumption plan |

- These draw on the existing deployments' TPM and are covered by the existing
  $50/month budget alert from 003 T043.
- Model prices come from the Azure Retail Prices API on 2026-10-28, per spec
  Technical Shape.
- `gpt-6-luna` bills cache writes at $0.125/1M, above its uncached input price.
  The eval reports cached tokens separately rather than assuming savings (R3).

## PR sequence

Each PR lists its scope, its compatibility story, and what is deployed when.
"Old extension" means the currently published build.

### PR1 — Scoring-model switch (FR-M01–M05)

- **Backend**:
  - `resolveModelConfig` (contract [model-config.md](./contracts/model-config.md)).
  - Optional temperature and reasoning effort.
  - Configurable `apiVersion`.
  - An `observe` usage callback, with `model.usage` logs in both handlers.
- **Eval**:
  - `exportCorpusExtracts.ts` in `extension/scripts`.
  - `postings/full/*.json`, plus `profiles/*.json` and `pairs.json`.
  - The harness extensions (contract [eval-harness.md](./contracts/eval-harness.md)).
  - `modelPrices.json`, `evalConfigs.json` and `eval-models.md`.
- **Compatibility**: no wire change, so both clients are unaffected.
- **Deploy**: settings first (approval), then code, then eval and sign-off, then
  the settings switch (approval). No extension or web release is needed.
- **Done when**: `eval-models.md` is signed off, the free tier runs on a model
  that retires on or after 2028-01-01, and SC-008 and SC-009 hold.

### PR2 — US1 + US2: freshness, dealbreakers, rubric, verdict

- **Shared**:
  - `fitView.ts` with its fixtures (contract [fit-view.md](./contracts/fit-view.md)).
  - `Fit` gains `dealbreakersViolated` and `profileFingerprint`.
  - `dealbreakerLinesFromPrompt`.
  - `pasteIdentity` moves here from the extension, so the web paste and the
    extension paste share one key.
- **Backend**:
  - Fingerprints on profile GET and PUT, and `fingerprintHistory`.
  - Merge-PUT.
  - `profileData` on both analyze endpoints.
  - Rubric prompt, the `dealbreakersViolated` schema field and
    `resolveDealbreakers`.
  - Rescore eligibility and counters, with Merge writes and the
    charge-after-validation side fix.
  - `postingUnavailable`.
  - A `text` part on `analyze-document` for the web's Paste text option
    (FR-027, research R7).
  - `unavailableAt` on saved jobs.
  - Contracts: [analyze-api.md](./contracts/analyze-api.md),
    [profile-api.md](./contracts/profile-api.md),
    [saved-jobs-api.md](./contracts/saved-jobs-api.md).
- **Extension**:
  - The fingerprint session key plus `storage.onChanged`.
  - `needsFitRefresh` replaced with freshness marking.
  - Rescore with a cost line, using account usage.
  - Thin-content-with-saved-entry handling.
  - Dealbreaker banner, verdict label and icon, and the screen-reader label.
  - Default collapsed view (FR-025) and secondary "My profile" (FR-024).
  - FR-007's offer to rescore after a profile save.
  - A visible, labelled "Web app" button with a Google sign-in tooltip
    (FR-028). It touches only `AccountBar.tsx`, so it can ship earlier as its
    own small PR if you want it sooner.
- **Web**:
  - Freshness markers and source-specific rescore actions on library and detail.
  - Upload waits for the profile to settle (spec edge case).
  - Upload honours "Upload again to rescore" by updating the existing entry.
  - A Paste text option on the document screen, renamed "Analyze posting" (FR-027), which also
    serves "Paste again to rescore".
  - "Upload again" or "Paste again" with different content saves as a new
    posting instead of overwriting the one being rescored.
  - "Current profile only" filter.
  - Verdict on every fit.
- **Compatibility**:
  - The old extension receives additive fields only. It shows no dealbreaker
    banner, so the rationale names each violated dealbreaker in prose (research
    R8). Its scores are no longer capped at 20, which matches the new rule.
  - The old extension's profile saves no longer erase anything, because PUT
    merges.
  - Its analyses get fingerprints, so the new web shows them correctly.
- **Deploy**: CD deploys functions and web together. The extension publishes
  after review.

### PR3 — US3: evidence

- **Backend**:
  - The model schema's three lists become `{label, postingQuote, profileQuote}`
    objects internally.
  - `validateQuotes` over the posting and profile haystacks.
  - The server splits labels from `fit.evidence` (R4, R9).
- **Clients**: an expandable evidence disclosure per chip (FR-013) on the
  extension panel and the web detail.
- **Compatibility**: the label arrays are unchanged, and `evidence` is ignored
  by old clients.
- **Gate**: the eval's SC-003 and the cost and p95 delta are reported in the PR,
  with a possible QG-4 exception. The cost increase is a feature cost for your
  approval in the PR. FR-M05's no-increase limit covers only the PR1 model
  switch (R9).

### PR4 — US4: profile setup

- **Backend**:
  - `POST /api/profile/import` (no storage, no metering; R12).
  - `preferences` storage and validation, with `schemaVersion` 2. Preferences
    include maximum office days and visa sponsorship (R11).
  - `profileToPromptText` gains a Preferences section.
  - `applyPreferences` (R11).
- **Extension**: `apiFetch` gains `rawBody` for the multipart import. The
  options page gets import and preference fields.
- **Web**: the Profile page gets the same import and preference fields,
  organized into headed sections: résumé, dealbreakers and preferences.
- **Compatibility**:
  - Old extension saves keep preferences, because PUT merges.
  - Old extension analyses omit preferences, so they are fingerprinted and shown
    as out of date on new surfaces.

### PR5 — US5: "I have this"

- **Backend**: `confirmedSkills` with case-insensitive deduplication, counted in
  the 20,000 cap. Serialized as a Confirmed skills section.
- **Clients**:
  - "I have this" on missing and desired chips.
  - A post-save offer to rescore (FR-020).
  - A removable confirmed-skills list in both editors.
- **Compatibility**: as for PR4.

### PR6 — US6: triage and compare

- **Shared**: `sortByFit`, `filterByVerdict` and `mergeRequirementRows`.
- **Extension**: Saved tab sort and verdict filter.
- **Web**:
  - `CompareGrid` becomes the requirements table, scrolling inside its container.
  - Compare moves into a modal dialog opened from the Library, built on the
    native `<dialog>` element, which gives focus containment and Escape for
    free. The Compare page and nav entry are deleted, and `/compare`
    redirects to `/library`.
  - The Library becomes a timeline grouped by save day, and each entry shows
    fit, salary, arrangement, location, seniority, status and source
    (data-model §9).
  - `libraryQuery` delegates to the shared helpers.
- **Compatibility**: client-only. It works against any 006 backend.

## Risks

| Risk | Mitigation |
|---|---|
| `gpt-6-luna` at `none` fails SC-004 or SC-008 on the full corpus, since the spec's evidence is one posting | The R2 fallback order is `low`, then escalation. The deadline leaves months of margin. |
| The eval corpus is small (5 full-length postings) | `eval-models.md` states the sample size and corpus gaps. Re-run the eval if the corpus grows. |
| `gpt-5.4-mini` is unmeasured and could fail a quality gate, for example by flagging unstated facts as violations as `gpt-5.4-nano` did | The PR1 eval gates it. On failure, R2's fallback rule picks among the other candidates, and you are told before any switch. |
| `gpt-5.4-mini` retires 2027-09-21, so Premium must migrate again within a year | A follow-up issue is filed when PR1 merges (T027). |
| The model still lowers the score when it sees a dealbreaker, despite the instruction | SC-002's score-independence check in the PR2 eval. Below 90%, the fallback is scoring fit without dealbreakers in the prompt, which costs a second call and goes to you first (research R8). |
| Model paraphrases dealbreakers | R8 matching keeps unmatched entries, which fails safe toward showing a violation. SC-008 in the eval catches over-reporting. |
| Evidence pushes latency and cost up | R9 mitigations, measurement in the PR, and an explicit sign-off |
| The new web goes live before the functions during CD, so a web paste reaches an `analyze-document` without the `text` part | It returns `400` "Missing required file part" for about a minute and charges nothing (R7). |

## Project Structure

### Documentation (this feature)

```text
specs/006-profile-match-ux/
├── plan.md              # This file
├── spec.md              # Clarified spec (input)
├── research.md          # Phase 0 — R1..R12
├── data-model.md        # Phase 1 — entities, storage, derived values
├── quickstart.md        # Phase 1 — per-PR validation
├── contracts/
│   ├── model-config.md      # PR1
│   ├── eval-harness.md      # PR1
│   ├── analyze-api.md       # PR2–PR4
│   ├── profile-api.md       # PR2, PR4, PR5
│   ├── saved-jobs-api.md    # PR2
│   └── fit-view.md          # PR2, PR3, PR6
├── eval-models.md       # Written by PR1 (measured model choice)
├── checklists/
└── tasks.md             # Phase 2 output (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
shared/
├── types/job.ts                 # Fit gains dealbreakersViolated, profileFingerprint, evidence (PR2/PR3)
├── types/profile.ts             # profileToPromptText sections; dealbreakerLinesFromPrompt (PR2/4/5)
├── fitView.ts                   # NEW (PR2; extended PR3, PR6)
├── pasteIdentity.ts             # MOVED from extension/lib (PR2), used by web paste and the server
└── fitView.fixtures.ts          # NEW shared test table

functions/
├── src/services/
│   ├── modelConfig.ts           # NEW resolveModelConfig (PR1)
│   ├── jobExtractionOrchestrator.ts  # config, observe, rubric, schema, validateQuotes, resolveDealbreakers/applyPreferences
│   ├── profileFingerprint.ts    # NEW (PR2)
│   ├── profileRepository.ts     # merge PUT, history, preferences, confirmedSkills
│   ├── meteringService.ts       # Merge writes; rescore + unavailable counters
│   ├── rescoreEligibility.ts    # NEW pure decision + lookups (PR2)
│   ├── savedJobsRepository.ts   # unavailableAt
│   └── documentExtraction.ts    # unchanged; reused by import
├── src/analyze-job/index.ts     # validate → meter order; rescore; profileData
├── src/analyze-document/index.ts# rescore; profileData; text part (web paste)
├── src/profile/index.ts         # fingerprint; merge; import route (PR4)
├── src/models/{job,user}.ts     # FREE_RESCORES_PER_MONTH, entity columns, body guards
├── scripts/evalPostings.ts      # extended harness
├── scripts/{evalConfigs,modelPrices}.json   # NEW
└── tests/
    ├── fixtures/postings/full/*.json        # NEW (exported)
    ├── fixtures/profiles/*.json, pairs.json # NEW
    ├── fixtures/jobAnalysis/*.json          # new recorded outputs (dealbreaker, evidence, fabricated quote)
    ├── unit/…                               # modelConfig, fingerprint, eligibility, resolveDealbreakers, applyPreferences, validateQuotes
    └── integration/…                        # metering Merge, rescore flows, profile merge/import, unavailableAt

extension/
├── scripts/exportCorpusExtracts.ts          # NEW (PR1)
├── services/jobFlow.ts                      # freshness instead of auto-refresh; rescore intent; thin+saved
├── services/profileStorage.ts               # fingerprint session key; profileData; import
├── services/jobAnalysisClient.ts            # profileData, rescore, usage echo
├── services/api/apiClient.ts                # rawBody (PR4)
├── components/JobPanel/{FitScore,SavedJobRow,SavedTab,ThisPageTab,PasteComposer}.tsx
├── components/AccountBar.tsx                # labelled "Web app" button (FR-028)
├── entrypoints/options/OptionsApp.tsx       # import, preferences, confirmed skills
└── tests/{unit,e2e}/…

web/
├── src/api/{endpoints,types}.ts             # fingerprint, profileData, rescore, unavailableAt, import
├── src/pages/{Upload,Library,PostingDetail,Profile}.tsx   # Compare.tsx deleted in PR6
├── src/components/{AnalysisView,CompareGrid,LibraryControls}.tsx
├── src/components/{LibraryTimeline,LibraryEntry,CompareDialog}.tsx   # NEW (PR6)
├── src/components/PastePosting.tsx          # NEW Paste text option (FR-027)
├── src/lib/libraryQuery.ts
├── src/lib/{libraryTimeline,formatJob}.ts   # NEW (PR6), data-model §9
└── tests/{unit,contract,e2e}/…
```

**Structure Decision**: the existing four-package monorepo, with no new package.
Display logic shared across clients goes into `shared/`, as types and tokens did
in 004, because `shared/` is the only code both clients import.

## Complexity Tracking

No constitution violations require justification. One *conditional* exception
is pre-declared rather than discovered late: a QG-4 p95 regression exception for
PR3 (evidence), raised only if the R9 mitigations don't bring the regression
under 20%.
