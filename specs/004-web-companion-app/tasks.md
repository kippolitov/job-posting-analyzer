---
description: "Task list for Companion Web Application with Document-Upload Analysis"
---

# Tasks: Companion Web Application with Document-Upload Analysis

**Input**: Design documents from `/specs/004-web-companion-app/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (analyze-document.md, web-auth.md, consumed-endpoints.md), quickstart.md

**Tests**: INCLUDED — the constitution mandates test-first (Red-Green-Refactor) and the plan requests Vitest + Azurite integration + MSW contract tests. Write each story's tests first and confirm they fail before implementing.

**Organization**: Grouped by user story (P1→P5) for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1..US5 (from spec.md); Setup/Foundational/Polish carry no story label

## Path Conventions

Three-package monorepo: `web/` (new Vite SPA), `functions/` (Azure Functions), `extension/` (WXT), plus new `shared/` (types + design tokens). Paths below are repo-root-relative per plan.md.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the `shared/` single-source-of-truth package, scaffold `web/`, and add the two new extraction dependencies.

- [X] T001 Create `shared/` package (`shared/package.json`, `shared/tsconfig.json`) with `types/` and `tokens/` subdirs per plan.md Project Structure.
- [X] T002 [P] Extract shared analysis/job types into `shared/types/` (Arrangement, ArrangementConfidence, Seniority, SalaryPeriod, Salary, Fit, JobStatus, JOB_STATUSES, ARRANGEMENTS, JobAnalysisPayload, JobAnalysisResponse, MAIN_TEXT_CAP) as the single definition — identical shapes moved from `functions/src/models/job.ts` and `extension/types/job.ts` (data-model.md §1).
- [X] T003 [P] Extract the extension's design tokens into `shared/tokens/` for consumption by both `extension/tailwind.config.cjs` and the new `web/` Tailwind config.
- [X] T004 Re-export shared types from `functions/src/models/job.ts` (repoint to `shared/types/`) and confirm `cd functions && npm run build` + `npm test` still pass (no shape change).
- [X] T005 Repoint `extension/types/job.ts` to re-export from `shared/types/` and confirm `cd extension && npm run lint && npm test && npm run build` pass (no behavior change).
- [X] T006 Scaffold `web/` — Vite + React 18 + TypeScript 5 (strict) + Tailwind + react-router (HashRouter) + msw (dev/test) in `web/package.json`, `web/vite.config.ts` (`base: "/app/"`), `web/tsconfig.json` (strict, path alias to `shared/`), `web/tailwind.config.cjs` (imports `shared/tokens`), `web/index.html`.
- [X] T007 [P] Configure `web/` lint + format (ESLint + Prettier mirroring `functions`/`extension` configs) with `npm run lint` (max-warnings 0) and `npm test`/`npm run coverage` scripts.
- [X] T008 [P] Add `mammoth` and `unpdf` as `functions/` runtime dependencies (isolated dep-bump per constitution Development Workflow; the only new runtime deps — research.md R6), update `functions/package-lock.json`.

**Checkpoint**: `shared/` compiles and is imported by `functions/` + `extension/` with green builds; `web/` scaffold runs `npm run dev`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend auth delta + the `web/` auth/token/api/app-shell every story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T009 [P] Functions unit tests (test-first) for the audience set in `functions/tests/unit/auth.aud.test.ts`: a token minted for the web client ID verifies, one for the extension client ID still verifies, an unknown-aud token → 401; signature/iss/exp/email_verified unchanged (contracts/web-auth.md).
- [X] T010 [P] Functions unit tests (test-first) for the CORS allowlist in `functions/tests/unit/http.cors.test.ts`: allowed `Origin` echoed + `Vary: Origin`; absent/unmatched Origin preserves current behavior (contracts/web-auth.md).
- [X] T011 Widen the audience check in `functions/src/services/auth.ts` — parse `GOOGLE_OAUTH_CLIENT_IDS` (comma-separated; fall back to `GOOGLE_OAUTH_CLIENT_ID`) and pass the array to `verifySignedJwtWithCertsAsync`; leave all other verification untouched (makes T009 pass).
- [X] T012 Add the `ALLOWED_ORIGINS` CORS allowlist to the shared helper in `functions/src/services/http.ts` (echo matching Origin + `Vary: Origin`, wildcard fallback for extension/no-Origin) (makes T010 pass).
- [X] T013 [P] Web auth module in `web/src/auth/` — GIS init with the web OAuth client ID, **in-memory-only** token store (no localStorage), silent `auto_select` re-issue ~1 min before `exp`, prompt fallback (research.md R2, contracts/web-auth.md), with unit tests in `web/tests/unit/authStore.test.ts`.
- [X] T014 [P] Web API client in `web/src/api/` — `Authorization: Bearer` on every call, `VITE_API_BASE_URL` base, one silent re-auth + retry on 401, and error→state mapping (403/413/415/422/429/409) per contracts/consumed-endpoints.md.
- [X] T015 App shell + HashRouter + route guard in `web/src/main.tsx` and `web/src/pages/` — signed-out routes reach only the public landing; any account route requires a token (foundation for FR-002/SC-010).

**Checkpoint**: Backend accepts web-client tokens with the Pages origin allowlisted; `web/` can authenticate and call the API behind a signed-in guard.

---

## Phase 3: User Story 1 - Sign In on the Web and See the Same Data (Priority: P1) 🎯 MVP

**Goal**: A signed-in user sees the same shared library (each posting's full stored analysis) and profile; a signed-out visitor sees only the public landing page and can reach no account data.

**Independent Test**: Sign in with a Google account that has extension data → same postings + profile appear; signed-out load shows landing with zero account API calls.

### Tests for User Story 1

- [X] T016 [P] [US1] MSW contract test in `web/tests/contract/auth.test.ts`: `401 UNAUTHENTICATED` → sign-in prompt; `403 NOT_AUTHORIZED` (unverified email) → plain-language verify-email message; signed-out fires no `/api/jobs` or `/api/profile` call.
- [X] T017 [P] [US1] Integration test in `web/tests/contract/library-view.test.ts`: `GET /api/jobs` list renders postings and a posting detail shows every stored field (fit matching/missing/desired + strengths/weaknesses, arrangement+evidence+confidence, salary, seniority, techStack, status, notes).
- [X] T017a [US1] **End-to-end test** for the P1 journey in `web/tests/e2e/signin-shared-data.spec.ts` (Playwright, mirroring `extension/tests/e2e`): signed-out load shows only the landing with zero account API calls; with a browser-boundary-stubbed Google ID token, signed-in load renders the shared library + profile. Stub the token at the browser boundary, **not** the API, so the real API client/auth/route-guard path runs (constitution II — E2E MUST cover every P1 journey).

### Implementation for User Story 1

- [X] T018 [P] [US1] Public landing page in `web/src/pages/Landing.tsx` — explains the product, routes to sign-in, fetches nothing (FR-002).
- [X] T019 [US1] Library list view in `web/src/pages/Library.tsx` consuming `GET /api/jobs` (fetch full list once), rendering URL-source link vs document-source filename (FR-007, consumed-endpoints.md).
- [X] T020 [P] [US1] Posting detail view in `web/src/pages/PostingDetail.tsx` + `web/src/components/AnalysisView.tsx` rendering the full stored analysis (FR-008, spec US1 scenario 2).
- [X] T021 [P] [US1] Read-only profile view in `web/src/pages/Profile.tsx` consuming `GET /api/profile` (FR-014 view half; edit is US3).
- [X] T022 [US1] Wire signed-out gate end-to-end so no account data loads without a verified token (FR-001/FR-002/SC-010), and confirm a change made in the extension appears on web refresh (FR-005, US1 scenario 3).

**Checkpoint**: MVP — signed-in users get a full-screen read view of their shared library + profile; signed-out users are gated.

---

## Phase 4: User Story 2 - Search, Filter, Sort, and Compare the Library (Priority: P2)

**Goal**: Client-side search, multi-criteria filter (status, arrangement, seniority, fit-score range), sort, and side-by-side comparison over the fetched library.

**Independent Test**: On a multi-posting library, each search/filter/sort narrows/reorders correctly; several postings compare side by side; no-match shows an empty state.

### Tests for User Story 2

- [X] T023 [P] [US2] Unit tests in `web/tests/unit/libraryQuery.test.ts` for search + filter (status, arrangement, seniority, fit-min/max) + sort over a `SavedJobPayload[]` fixture (FR-010/FR-011/FR-012).
- [X] T024 [P] [US2] UI test in `web/tests/contract/filters.test.ts`: applied filters are visible + removable; empty result → empty-state message, not blank (FR-013, US2 scenario 5).

### Implementation for User Story 2

- [X] T025 [P] [US2] `LibraryQuery` state + pure search/filter/sort functions in `web/src/lib/libraryQuery.ts` (data-model.md §4).
- [X] T026 [US2] Filter + sort controls in `web/src/components/LibraryControls.tsx` wired into `Library.tsx` (visible, removable filters).
- [X] T027 [P] [US2] Side-by-side compare grid in `web/src/components/CompareGrid.tsx` (small fixed max selection; larger-screen layout, FR-009, US2 scenario 4).
- [X] T028 [US2] Empty-state handling in `Library.tsx` for no-match search/filter combos (FR-013).

**Checkpoint**: US1 + US2 work independently; the library is fully navigable on the larger screen.

---

## Phase 5: User Story 3 - View and Edit the Candidate Profile on the Web (Priority: P3)

**Goal**: Edit the one shared profile (20,000-char limit) so changes appear in the extension; see plan, monthly usage, and renewal state.

**Independent Test**: Edit profile on web → same text in extension and next analysis scores against it; >20,000 chars blocked; account view matches `GET /api/account`.

### Tests for User Story 3

- [X] T029 [P] [US3] MSW contract test in `web/tests/contract/profile-account.test.ts`: `PUT /api/profile` over-limit → server `400` surfaced as the plain-language 20k message; `GET /api/account` renders plan/usage/renewal.

### Implementation for User Story 3

- [X] T030 [US3] Profile editor in `web/src/pages/Profile.tsx` — full-width edit, client-side 20,000-char enforcement mirroring the server, `PUT /api/profile` on save (FR-014/FR-015, US3 scenarios 2–3).
- [X] T031 [P] [US3] Account view in `web/src/pages/Account.tsx` + `web/src/components/UsagePlanBanner.tsx` from `GET /api/account` (current plan, analyses used vs cap, renewal state — FR-016).

**Checkpoint**: US1–US3 independently functional; two-way profile sync demonstrated.

---

## Phase 6: User Story 4 - Analyze an Uploaded Document (Priority: P4)

**Goal**: New `POST /api/analyze-document` endpoint extracts text from a `.docx`/`.pdf`, validates before metering, reuses meteringService + orchestrator, and returns the same analysis shape with a document source; web upload UI drives it with the shared exhaustion/error states.

**Independent Test**: Valid `.docx`/`.pdf` → same-shape analysis sourced as the document; each invalid file rejected with a specific reason and zero allowance consumed; at-cap upload → the "allowance used, resets on <date>" state.

### Tests for User Story 4 (write first, confirm fail)

- [X] T032 [P] [US4] Create document fixtures in `functions/tests/fixtures/documents/` — valid `.docx` + valid `.pdf`, `encrypted.pdf`/`encrypted.docx`, `image-only.pdf`, `oversized.pdf` (>10 MB), `mislabeled.pdf` (non-PDF bytes) (quickstart.md US4).
- [X] T033 [P] [US4] Functions unit tests in `functions/tests/unit/documentExtraction.test.ts`: magic-byte sniff accepts real pdf/docx, rejects mislabeled (415); 10 MB boundary (413); mammoth/unpdf extraction; encrypted→password-protected, image-only→no-text, corrupt→unreadable (contracts/analyze-document.md steps 1–3).
- [X] T034 [US4] Functions integration test (Azurite) in `functions/tests/integration/analyze-document.metering.test.ts`: rejected files consume **zero** allowance (reject-before-increment, SC-005); 20 parallel valid uploads at 1-remaining → exactly 1 success (SC-006); system 5xx triggers best-effort refund (contracts/analyze-document.md R7).
- [X] T035 [P] [US4] MSW contract tests in `web/tests/contract/upload.test.ts`: `413`/`415`/`422` each render their plain-language upload-error state with accepted formats/size; `429 USAGE_LIMIT_REACHED` renders the reset-date exhaustion state + upgrade path.

### Implementation for User Story 4

- [X] T036 [P] [US4] `functions/src/services/documentExtraction.ts` — inline magic-byte sniff (PDF `%PDF`, DOCX `PK␃␄`), 10 MB boundary check, `mammoth` (.docx) + `unpdf` (.pdf) extraction, encrypted/image-only/corrupt detection returning typed rejections (makes T033 pass; research.md R4/R6).
- [X] T037 [US4] `functions/src/analyze-document/index.ts` endpoint — `request.formData()` multipart, ordered pipeline (size → sniff → extract → **then** `checkAndIncrement` → synthetic `AnalyzeJobRequest` (title=filename, mainText=extracted capped at MAIN_TEXT_CAP) → `orchestrateJobAnalysis` → `refundOnSystemFailure` on 5xx), response `{analysis, source:"document", filename, saveKey, usage}`, plus anonymous `OPTIONS` preflight (contracts/analyze-document.md, research.md R7/R8; makes T034 pass).
- [X] T038 [US4] Upload dropzone in `web/src/components/UploadDropzone.tsx` with client-side type/size hints (server remains source of truth) and progress indicator >300 ms (constitution III).
- [X] T039 [US4] Analyze flow in `web/src/pages/Upload.tsx` — `POST /api/analyze-document` multipart with the `profile` field, renders the result via `AnalysisView` with the document filename as source (FR-017/FR-018/FR-019).
- [X] T040 [P] [US4] Upload error + exhaustion states in `web/src/components/UploadErrors.tsx` — map 413/415/422 to plain-language messages and 429 to the reset-date exhaustion state with an upgrade path (FR-020/FR-023, SC-005/SC-007).

**Checkpoint**: Document analysis works end-to-end; caps and rejections behave exactly like the extension path; no uploaded bytes persist.

---

## Phase 7: User Story 5 - Save a Document-Sourced Analysis to the Library (Priority: P5)

**Goal**: Save a document-sourced analysis into the shared library (source discriminator + filename + content-hash key), enforcing the same cap/at-cap refusal, with the original file never retained.

**Independent Test**: Save a doc analysis → appears on web + extension with filename source; library at cap → `409` at-cap message; saved doc posting offers no file download.

### Tests for User Story 5 (write first, confirm fail)

- [X] T041 [P] [US5] Functions unit tests in `functions/tests/unit/savedJobs.document.test.ts`: `isSavedJobPutBody` document branch (`canonicalUrl` matches `^doc:[0-9a-f]{64}$`, non-empty `filename`, empty `sourceUrl` allowed); `saveJob` verifies `sha256(canonicalUrl)===key`; back-compat defaults `source:"url"`/`filename:""` on legacy rows (data-model.md §2).
- [X] T042 [US5] Functions integration test in `functions/tests/integration/savedJobs.document-cap.test.ts`: saving a doc-sourced row at the tier cap → `LibraryCapError` 409; over-cap library stays read-only-for-additions, nothing truncated (FR-024, US5 scenario 2).
- [X] T043 [P] [US5] MSW contract test in `web/tests/contract/save-document.test.ts`: `PUT /api/jobs/{saveKey}` `409` → at-cap refusal message; saved doc posting renders no download affordance (US5 scenarios 2–3).

### Implementation for User Story 5

- [X] T044 [P] [US5] Extend `functions/src/models/user.ts` — add `source: "url" | "document"` and `filename` to `SavedJobEntity`/`SavedJobPayload`, discriminated `isSavedJobPutBody`, back-compat read defaults (data-model.md §2; makes T041 pass).
- [X] T045 [US5] Extend `functions/src/services/savedJobsRepository.ts` — persist `source`/`filename`, accept the `doc:<hash>` canonicalUrl key path unchanged through `sha256Hex` verification, cap/over-cap semantics untouched (makes T042 pass).
- [X] T046 [US5] Web save action in `web/src/pages/Upload.tsx` — `PUT /api/jobs/{saveKey}` from the document result (source="document", filename), success reflects into the library; saved doc posting view exposes no original-file download (FR-025, SC-009).

**Checkpoint**: All five stories independently functional; document analyses become durable, cross-surface library entries.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: CI/CD wiring, deployment, docs, a11y/mobile, performance, and full validation.

- [X] T047 [P] Extend `.github/workflows/ci.yml` with a `web-ci` job (install, lint max-warnings 0, test, build) and enforce the ≥80% changed-module coverage gate for `web/` (constitution QG-1/QG-2).
- [X] T048 ~~Extend `.github/workflows/cd.yml` `publish-coverage` (Pages) job to ship `web/dist` under `<pages-origin>/app/` with no new Azure resource~~ — **superseded 2026-07-21**: `web/` now deploys to a dedicated Azure Static Web Apps (Free tier) resource via a new `deploy-web` job (constitution Principle V, plan.md Constraints). `publish-coverage` no longer bundles `web-dist`; GitHub Pages keeps only the marketing landing page, legal pages, and coverage reports.
- [X] T049 [P] Docs: note the `web/` package + the `mammoth`/`unpdf` zero-new-deps exception in `README.md`/`CONTEXT.md`; document `GOOGLE_OAUTH_CLIENT_IDS` and `ALLOWED_ORIGINS` env vars (constitution Development Workflow docs rule).
- [X] T050 [P] Accessibility + mobile-viewport pass on landing, library, upload (WCAG 2.1 AA labels/contrast; fully usable on mobile — constitution III, spec landing/library mobile requirement).
- [X] T051 **Automated latency benchmark in CI** for the document path (constitution IV, QG-4): extend the existing functions latency benchmark to cover the `analyze-document` scenario — assert ≤ 8 s p50 / 30 s ceiling with sub-second extraction budget at the 10 MB cap and no analyze-latency regression — and wire it into the CI workflow (alongside T047) so it runs on every change, not as a manual check.
- [X] T052 Run `quickstart.md` validation end-to-end across US1–US5, including the zero-retained-bytes storage assertion (SC-008) and signed-out zero-data assertion (SC-010).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T004/T005 depend on T002; T006 depends on T001–T003.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories.** T011→T009, T012→T010 (impl makes tests pass); T013–T015 depend on T006.
- **User Stories (Phase 3–7)**: All depend on Foundational. US1 is the MVP. US2/US3 depend only on US1's library/profile views existing. US4 depends on Foundational (metering/auth) only. US5 depends on US4 (needs the `saveKey` from analyze-document) and on US1's library.
- **Polish (Phase 8)**: Depends on the desired stories being complete (T048 after web builds; T052 after US1–US5).

### User Story Dependencies

- **US1 (P1)**: Foundational only — no other story.
- **US2 (P2)**: Builds on US1's fetched library (independently testable with a list fixture).
- **US3 (P3)**: Foundational + US1 profile/route shell.
- **US4 (P4)**: Foundational only (auth + metering + orchestrator). Independent of US1–US3.
- **US5 (P5)**: US4 (consumes `saveKey`) + US1 (library render).

### Within Each User Story

- Tests written first and failing → models → services → endpoints → UI → integration.
- Backend model (T044) before repository (T045) before web save (T046).

### Parallel Opportunities

- Setup: T002, T003 in parallel; T007, T008 in parallel.
- Foundational: T009, T010 in parallel (tests); T013, T014 in parallel (different `web/` dirs).
- US1: T016, T017 (tests) in parallel; T018, T020, T021 in parallel (different files).
- US4: T032, T033, T035 in parallel (fixtures/unit/web-contract); T036 then T037; T040 parallel with T038/T039 wiring.
- Across teams: once Foundational lands, US4 (backend-heavy) and US1–US3 (frontend-heavy) can proceed in parallel.

---

## Parallel Example: User Story 4

```bash
# Tests first (parallel — different files):
Task: "Create document fixtures in functions/tests/fixtures/documents/"          # T032
Task: "Functions unit tests in functions/tests/unit/documentExtraction.test.ts"  # T033
Task: "MSW contract tests in web/tests/contract/upload.test.ts"                   # T035

# Then implementation (service before endpoint):
Task: "functions/src/services/documentExtraction.ts"                             # T036
# (T037 endpoint depends on T036)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & validate** signed-in shared-data view + signed-out gate → deploy `/app/` MVP.

### Incremental Delivery

Foundation → US1 (MVP: read the shared library on the web) → US2 (rich search/compare) → US3 (profile edit + account) → US4 (document analysis — the new capability) → US5 (save doc analyses). Each ships independently without breaking prior stories.

### Parallel Team Strategy

After Foundational: Developer A drives US4/US5 (backend `analyze-document` + SavedJobs extension), Developer B drives US1→US3 (web views), converging at US5 (web save consuming the endpoint).

---

## Notes

- [P] = different files, no incomplete-task dependency; [USn] maps each task to its story for traceability.
- Confirm each story's tests fail before implementing (Red-Green-Refactor, constitution II).
- `meteringService.ts` and `jobExtractionOrchestrator.ts` are reused **unchanged** — do not edit them.
- Uploaded document bytes must never be written to storage (SC-008); assert this in T034/T052.
- Commit after each task or logical group; the git auto-commit hook runs after this command.
