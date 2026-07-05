# Tasks: Job Posting Analyzer

**Input**: Design documents from `/specs/001-job-posting-analyzer/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/analyze-job.md](./contracts/analyze-job.md), [quickstart.md](./quickstart.md)

**Tests**: INCLUDED — the project constitution (Principle II) strictly enforces test-first: tests are written and confirmed failing before implementation, ≥ 80% coverage on changed modules, real fixtures/msw over hollow mocks, E2E for the P1 journey.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Include exact file paths in descriptions

## Path Conventions

Two-package repo per plan.md: `extension/` (WXT + React 18 + TS5, Vitest + msw + Playwright) and `functions/` (Azure Functions v4, Node 20, Vitest).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Manifest/config groundwork and a green regression baseline

- [x] T001 Add `activeTab` and `scripting` permissions and register the `entrypoints/options/` options-page entrypoint in extension/wxt.config.ts (keep existing YouTube host permissions; side panel enabled for all tabs)
- [x] T002 [P] Record regression baseline: run existing suites unchanged (`cd extension && npm test`, `cd functions && npm test`) and confirm green before any feature work (guards FR-016/SC-005)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types and URL canonicalization used by every story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 [P] Define all shared types (`Arrangement`, `ArrangementConfidence`, `Seniority`, `JobStatus`, `SalaryPeriod`, `PageExtract`, `JobAnalysis`, `Salary`, `Fit`, `SavedJob`, `CandidateProfile`) per data-model.md in extension/types/job.ts
- [x] T004 [P] Write failing table-driven unit tests for URL canonicalization (tracking-param strip: `utm_*`, `ref`, `refid`, `trk`, `trackingid`, `gh_src`, `lever-origin`, `src`, `source`, `mkt_tok`, `fbclid`, `gclid`; LinkedIn `/jobs/view/{id}`, Indeed `viewjob?jk=`, Greenhouse/Lever/Ashby fixtures; host lowercase, trailing-slash/fragment drop; SHA-256 key) in extension/tests/canonicalUrl.test.ts
- [x] T005 Implement `canonicalize(url): string` and `canonicalKey(url): Promise<string>` (SHA-256) with the table-driven board normalizer registry in extension/lib/canonicalUrl.ts until T004 tests pass

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Analyze the Current Page as a Job Posting (Priority: P1) 🎯 MVP

**Goal**: Side panel on any non-YouTube page extracts the page, calls `POST /api/analyze-job`, and renders arrangement (+evidence, confidence), salary, seniority, tech stack; YouTube pages keep the existing panel untouched.

**Independent Test**: Quickstart Scenarios 1–3 — open the panel on a real posting and see correct fields with evidence; non-job page and backend-down paths degrade gracefully; existing YouTube suites pass unchanged.

### Tests for User Story 1 (write FIRST, confirm they FAIL) ⚠️

- [x] T006 [P] [US1] Write failing jsdom unit tests for the page extractor: JSON-LD variants (single object, array, `@graph`, malformed JSON, multiple `JobPosting` blocks), main-text heuristic (`<main>`/`[role=main]`/`article`/density fallback, `nav`/`header`/`footer`/`aside`/`script`/`style` stripped), 40,000-char cap, thin-content detection in extension/tests/pageExtractor.test.ts
- [x] T007 [P] [US1] Write failing backend unit tests for the orchestrator: prompt assembly (JSON-LD as ground truth, `TELECOMMUTE` ⇒ remote/explicit), evidence-substring validation downgrade (hallucinated quote → `unspecified`/`none`, days nulled), hybrid-days consistency rule, JSON-LD contradiction case, one schema-repair retry then typed 502 in functions/test/jobExtractionOrchestrator.test.ts; fake the Azure OpenAI call with recorded structured-output response fixtures in functions/test/fixtures/ — no hand-rolled mocks (constitution Principle II)
- [x] T008 [P] [US1] Write failing msw contract tests for the analysis client pinned to contracts/analyze-job.md: happy path, 30 s timeout, 400/413/502/504 typed errors, schema-invalid response rejection in extension/tests/jobAnalysisClient.test.ts
- [x] T019 [P] [US1] Write the failing Playwright E2E for the P1 journey (fixture posting page → panel opens → analysis renders with badge + evidence; YouTube page → video panel) in extension/tests/e2e/jobAnalyzer.spec.ts — written test-first with T006–T008 and expected to stay red until T017 completes (ID retained for traceability after reorder)

### Implementation for User Story 1

- [x] T009 [P] [US1] Implement the self-contained injectable extractor function (no imports; returns `PageExtract`) per plan "Page extraction" in extension/lib/pageExtractor.ts until T006 passes
- [x] T010 [P] [US1] Implement the orchestrator: system prompt with extraction rules, structured-output call (`response_format: json_schema`, `strict: true`, schema from contracts/analyze-job.md), server-side post-validation (evidence backstop, hybrid-days rule), `AZURE_OPENAI_JOB_DEPLOYMENT` override in functions/src/services/jobExtractionOrchestrator.ts until T007 passes
- [x] T011 [US1] Implement the HTTP trigger: function-key auth like `/api/analyze`, request validation (`extract` required, 413 over 40k chars, `assumeJobPosting` flag), typed error bodies per contract, appends `model`/`analyzedAt` in functions/src/analyze-job/index.ts
- [x] T012 [US1] Implement the extension client for `POST /api/analyze-job` (30 s timeout, typed error mapping) in extension/services/jobAnalysisClient.ts until T008 passes
- [x] T013 [US1] Add tab-URL mode routing in extension/entrypoints/background.ts: YouTube `/watch` → `{mode:'video'}` (existing flow untouched), other `http(s)` → `{mode:'job', tabId}`; orchestrate `chrome.scripting.executeScript` injection of the extractor on panel open
- [x] T014 [US1] Add the two-branch mode switch (VideoKnowledgePanel | JobPanel, no shared state beyond the shell) in extension/entrypoints/sidepanel/
- [x] T015 [P] [US1] Create the arrangement badge component (remote / hybrid+days / onsite / unspecified variants, WCAG AA contrast, accessible labels) in extension/components/JobPanel/ArrangementBadge.tsx
- [x] T016 [US1] Create the panel shell with ThisPage|Saved tabs (Saved tab stubbed until US2) in extension/components/JobPanel/JobPanel.tsx
- [x] T017 [US1] Create the ThisPage tab: progress indicator with cancel affordance (auto-trigger per spec assumption), analysis fields, evidence quote + explicit/inferred label, thin-content state ("Not enough page content to analyze"), non-job state with "Analyze anyway", multi-posting list-page notice ("a specific posting page yields better results" — spec Edge Cases), error banner + Retry with JSON-LD-derived fields still rendered in extension/components/JobPanel/ThisPageTab.tsx
- [x] T018 [P] [US1] Build the accuracy eval harness: 50 redacted posting fixtures with expected `arrangement`/`daysInOffice` in functions/test/fixtures/postings/ and an `npm run eval:postings` script reporting against SC-001/SC-002 in functions/ (on-demand, not CI, per plan Complexity Tracking)

**Checkpoint**: User Story 1 fully functional — MVP demoable per quickstart Scenarios 1–3

---

## Phase 4: User Story 2 - Save Postings to a Persistent Library (Priority: P2)

**Goal**: One-click save of an analysis into durable local storage; Saved tab with filter/sort, status, notes, delete, open-original, and JSON export.

**Independent Test**: Quickstart Scenario 4 — save, edit status/notes, filter/sort, restart browser, verify persistence and export download.

### Tests for User Story 2 (write FIRST, confirm they FAIL) ⚠️

- [x] T020 [P] [US2] Write failing unit tests for the job repository: save/get round-trip, `job:index` integrity (atomic update, rebuild from `job:*` on corruption), list with arrangement/status filters and savedAt sort, update patches touch `updatedAt`, remove, `exportAll` JSON shape, 1,000-record soft cap prompt path, quota-exceeded error in extension/tests/jobStorage.test.ts

### Implementation for User Story 2

- [x] T021 [US2] Implement the `JobRepository` interface and `chrome.storage.local` implementation (`job:{sha256}` keys + `job:index`, `schemaVersion: 1`, soft cap, quota handling) in extension/services/jobStorage.ts until T020 passes
- [x] T022 [US2] Wire the Save action into the ThisPage tab (default status `interested`, canonical URL from T005, saved confirmation, quota-failure message offering export + prune archived) in extension/components/JobPanel/ThisPageTab.tsx
- [x] T023 [P] [US2] Create the saved-list row component: status select (`interested`/`applied`/`interviewing`/`rejected`/`ghosted`/`archived`), inline notes editing with immediate persist, open-original-URL, delete — all with accessible labels in extension/components/JobPanel/SavedJobRow.tsx
- [x] T024 [US2] Create the Saved tab: list from `jobStorage.list`, filter by arrangement and status, sort by saved date, Export button producing a single JSON download (FR-017) in extension/components/JobPanel/SavedTab.tsx and un-stub the tab in extension/components/JobPanel/JobPanel.tsx

**Checkpoint**: User Stories 1 AND 2 both work independently — library replaces the tracking spreadsheet

---

## Phase 5: User Story 3 - Revisit Detection and Analysis Caching (Priority: P3)

**Goal**: Saved postings render instantly as "Already saved" on revisit (even via tracking-param URLs); unsaved recent analyses come from a session cache; Re-analyze forces a fresh call.

**Independent Test**: Quickstart Scenario 5 — revisit a saved posting via a `utm_`-laden URL with zero `/api/analyze-job` network calls; Re-analyze triggers exactly one.

### Tests for User Story 3 (write FIRST, confirm they FAIL) ⚠️

- [x] T025 [P] [US3] Write failing unit tests for the analysis cache: keyed by canonical hash, LRU eviction at 200 entries, 14-day TTL expiry, `lastAccess` update on hit in extension/tests/jobAnalysisCache.test.ts
- [x] T026 [P] [US3] Write failing integration test for the lookup order (saved → cached → backend) and tracking-param dedup (same canonical key ⇒ no backend call) in extension/tests/revisitFlow.test.ts

### Implementation for User Story 3

- [x] T027 [US3] Implement the `chrome.storage.session` LRU cache mirroring the existing sessionCache.ts pattern in extension/services/jobAnalysisCache.ts until T025 passes
- [x] T028 [US3] Implement the lookup order in the job-mode orchestration (`jobStorage.get` → "Already saved" state; `jobAnalysisCache` hit → cached render; miss → backend + cache write) in extension/entrypoints/background.ts until T026 passes
- [x] T029 [US3] Add the "Already saved" state (stored analysis + status + notes) and the Re-analyze action (bypasses cache, replaces snapshot, updates `updatedAt`) in extension/components/JobPanel/ThisPageTab.tsx

**Checkpoint**: Revisit path renders with zero redundant backend calls (SC-006)

---

## Phase 6: User Story 4 - Fit Score Against a Candidate Profile (Priority: P3)

**Goal**: Options-page profile editor; analyses include a 0–100 fit score with rationale; violated dealbreakers cap the score at ≤ 20; empty state prompts profile configuration.

**Independent Test**: Quickstart Scenario 6 — no profile ⇒ configure prompt; dealbreaker-violating posting ⇒ score ≤ 20 naming the dealbreaker.

### Tests for User Story 4 (write FIRST, confirm they FAIL) ⚠️

- [x] T030 [P] [US4] Write failing unit tests for profile storage: single `storage.local` key round-trip, 4,000-char limit enforcement, `updatedAt` touch in extension/tests/profileStorage.test.ts
- [x] T031 [P] [US4] Extend backend orchestrator tests with failing fit-scoring cases: fit `null` without profile (server gating), dealbreaker match caps score ≤ 20 and names it in the rationale, rationale ≤ 400 chars in functions/test/jobExtractionOrchestrator.test.ts

### Implementation for User Story 4

- [x] T032 [US4] Implement `CandidateProfile` persistence (get/set, char limit) in extension/services/profileStorage.ts until T030 passes
- [x] T033 [US4] Build the options-page profile editor (free-text profile + optional structured dealbreakers list, save feedback, accessible form labels) in extension/entrypoints/options/
- [x] T034 [US4] Add fit-scoring to the orchestrator prompt (compare vs profile, dealbreaker hard-cap rule) and `fit: null` request gating in functions/src/services/jobExtractionOrchestrator.ts until T031 passes
- [x] T035 [US4] Include the stored profile in analysis requests (only with requests, never elsewhere — FR-007) in extension/services/jobAnalysisClient.ts and extension/entrypoints/background.ts
- [x] T036 [P] [US4] Create the fit-score component (score + rationale display, "configure your profile" empty state linking to the options page) in extension/components/JobPanel/FitScore.tsx and mount it in extension/components/JobPanel/ThisPageTab.tsx

**Checkpoint**: All user stories independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Constitution quality gates, accuracy validation, release readiness

- [x] T037 [P] Run the accuracy eval (`npm run eval:postings`) and iterate the system prompt until SC-001 (≥ 90% arrangement accuracy, zero stated-arrangement contradictions) and SC-002 (hybrid days wherever stated) pass; record results in specs/001-job-posting-analyzer/quickstart.md notes
- [x] T038 [P] UX consistency pass per constitution Principle III: progress indicators on every > 300 ms operation, plain-language error copy with next actions, stable terminology (analysis/posting/arrangement/fit score), accessible labels and WCAG 2.1 AA contrast across extension/components/JobPanel/ and extension/entrypoints/options/
- [x] T039 Verify coverage ≥ 80% on all changed modules (codecov/CI) and that the full regression suite from T002 still passes unchanged (`cd extension && npm test`, `cd functions && npm test`) — FR-016/SC-005 gate
- [ ] T040 Execute all quickstart.md scenarios end-to-end against the local backend and record P50 side-panel-open → rendered-analysis latency vs the ≤ 8 s target (SC-003)
- [x] T041 [P] Update docs/README for the new mode and prepare release notes calling out the new `activeTab`/`scripting` permissions; version bump + tag per the existing release process (plan Rollout step 5)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories (T005 depends on T004; T003 parallel)
- **User Stories (Phase 3–6)**: All depend on Foundational completion
- **Polish (Phase 7)**: Depends on all desired user stories being complete (T037 needs only US1)

### User Story Dependencies

- **US1 (P1)**: Only Foundational. Fully independent — the MVP.
- **US2 (P2)**: Foundational + touches US1's ThisPageTab for the Save button (T022); repository itself (T020–T021) is independent of US1.
- **US3 (P3)**: Foundational + US2's `jobStorage` for the "Already saved" path (T028); the cache-only path (T025/T027) is testable without US2.
- **US4 (P3)**: Foundational + US1's orchestrator/client/ThisPageTab as integration points (T034–T036); profile storage + options page (T030/T032/T033) are independent.

### Within Each User Story

- Tests MUST be written and confirmed FAILING before their implementation task
- Types → lib → services → entrypoints → components
- Same-file tasks are sequential (e.g., T016 → T017 → T022 → T029 all touch ThisPage/JobPanel surfaces; T010 → T034 touch the orchestrator)

### Parallel Opportunities

- Phase 2: T003 ∥ T004
- US1 tests: T006 ∥ T007 ∥ T008 ∥ T019 (four different files, two packages)
- US1 impl: T009 ∥ T010 (extension lib vs backend service); T015 ∥ T018 alongside panel work
- Cross-story (after Phase 2, with multiple developers): US1 backend track (T007→T010→T011→T018) ∥ US1 extension track (T006→T009, T008→T012) ∥ US2 repository track (T020→T021) ∥ US4 profile track (T030→T032→T033)
- Polish: T037 ∥ T038 ∥ T041

---

## Parallel Example: User Story 1

```bash
# Launch all US1 test-writing tasks together (different files):
Task: "T006 jsdom unit tests in extension/tests/pageExtractor.test.ts"
Task: "T007 orchestrator unit tests in functions/test/jobExtractionOrchestrator.test.ts"
Task: "T008 msw contract tests in extension/tests/jobAnalysisClient.test.ts"
Task: "T019 failing Playwright E2E in extension/tests/e2e/jobAnalyzer.spec.ts"

# Then implement extractor and orchestrator in parallel (different packages):
Task: "T009 injectable extractor in extension/lib/pageExtractor.ts"
Task: "T010 structured-output orchestrator in functions/src/services/jobExtractionOrchestrator.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003–T005) — CRITICAL, blocks all stories
3. Complete Phase 3: US1 (T006–T019)
4. **STOP and VALIDATE**: quickstart Scenarios 1–3; run T037's eval early if accuracy risk is a concern
5. Demo: on-page analysis with evidence quotes, no library yet

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate → demo (MVP: analysis on any posting)
3. US2 → validate (persistence across restart) → demo (library + export)
4. US3 → validate (zero-call revisits) → demo
5. US4 → validate (dealbreaker cap) → demo
6. Polish gates (T037–T041) → version bump + tagged release

This ordering matches the plan's 4-PR rollout: PR 1 ≈ T001–T005 + T030/T032/T033, PR 2 ≈ T007/T010/T011/T018, PR 3 ≈ T006/T008/T009/T012–T019, PR 4 ≈ T020–T029; the mapping is advisory — story order above is the source of truth.

### Parallel Team Strategy

With two developers after Phase 2: Developer A takes the backend track (US1 orchestrator/endpoint/eval, later US4 fit scoring); Developer B takes the extension track (US1 extraction/routing/panel, then US2 library). US3 lands last since it stitches storage + cache + panel together.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing (constitution Principle II — strictly enforced)
- Commit after each task or logical group; every PR needs review (constitution Development Workflow)
- Stop at any checkpoint to validate the story independently
