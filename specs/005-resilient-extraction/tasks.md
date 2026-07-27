# Tasks: Resilient Page Extraction with User-Driven Fallbacks

**Input**: Design documents from `/specs/005-resilient-extraction/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution II mandates test-first with ≥80% coverage on changed modules and E2E for every P1 journey, and the spec/plan/quickstart name specific tests that must be written **failing first** (the evidence haystack, `jsonld-early`, cache bypass).

**Organization**: Grouped by user story so each ships and is measured independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = readiness (P1), US2 = signals/containers (P2), US3 = paste (P3), US4 = page scoping + learned hosts (P4)
- Paths are repo-root relative unless the task says otherwise

## Path Conventions

Monorepo (plan.md Project Structure): `extension/`, `functions/`, `web/`, `shared/`.
Commands run from the package directory named in the task.

## Three traps this feature is built around

Read these before starting. Each is a silent failure, not a crash:

1. **The evidence haystack** (T033) — adding `structuredSources` to the prompt without adding them to `validateEvidence`'s substring haystack makes US2 *reduce* arrangement confidence on exactly the pages it improves. T032 writes that test failing first; T033 fixes it; they ship in one commit.
2. **The readiness predicate** (T021) — today's `jsonLd.length > 0 || text >= 300` passes on JSON-LD alone before any body text exists, on 3/6 fixtures. A retry loop reusing it is no better than today. `jsonld-early` (T014) is the fixture that catches this.
3. **Scoped analysis served from cache** (T073) — `jobFlow` looks up the library and session cache by canonical URL *before* analyzing, and a scoped region resolves to the same URL. Without `bypassCache` the user's correction silently returns the previous wrong analysis. T062 writes that test first.

**Spec FR-009 (state-blob harvesting) is deliberately not implemented.** Research R4 found no corpus fixture whose posting body is recoverable only from a blob. It stays in the spec as a documented negative result. No task below builds it.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Lock the pre-change baseline and stand up the real-Chromium test lane. The corpus tooling (`extension/scripts/`) and the 6 fixtures already exist and are committed.

Two scoreboards exist and are not interchangeable: `corpus:baseline` prints the frozen pre-change numbers, `corpus:rescore` (T008a) runs the live extractor. Every "3/6 → ?" claim in this feature is `rescore` minus `baseline`.

- [X] T001 Record the pre-change baseline by running `npx tsx scripts/baselineReport.ts` from `extension/`, and confirm its five scoreboard numbers match the table in `extension/tests/fixtures/pages/README.md` (body-fallback 3/6, predicate-before-text 3/6, slowest settle 4883 ms). Do not re-capture the corpus during this feature — it moves the baseline you are measured against.
- [X] T002 [P] Add `corpus:baseline` (`tsx scripts/baselineReport.ts`) and `corpus:capture` (`tsx scripts/captureCorpus.ts`) scripts to `extension/package.json` so the scoreboard is runnable without remembering the paths.
- [X] T003 [P] Add a second Playwright project named `extractor` (`testDir: "./tests/extractor"`) to `extension/playwright.config.ts`, separate from the existing extension-loading `./tests/e2e` project. Extractor tests evaluate `extractPage` in a plain Chromium page and must run without a built extension or a live backend.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types every story reads, and the real-Chromium harness US1 and US2 both assert through.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add `StructuredSourceKind`, `StructuredSource`, `ExtractionStrategy`, and `ExtractionProvenance` to `shared/types/job.ts`, and add `structuredSources: StructuredSource[]` and `provenance: ExtractionProvenance` to `PageExtractPayload`, exactly as declared in [data-model.md](./data-model.md) §1–§2. Also add `ExtractArgs` (`{ learnedSelector?: string }`) — the single object `extractPage` receives via `executeScript({ args })`, which is how the learned selector reaches the serialized extractor without it touching `chrome.storage` (plan.md Constraints, T075/T076). Leave `jsonLd` in place and still populated — removing it breaks older backends (contracts/extraction-payload.md §1).
- [X] T005 Thread the new types through `extension/lib/pageExtractor.ts`: `RawPageExtract` gains `structuredSources` and `provenance`, and `extractPage` returns a provenance stub (`strategy: "semantic" | "body"`, `attempts: 1`, measured `elapsedMs`, `budgetExpired: false`, `learnedSelectorMissed: false`). Behavior is otherwise unchanged in this task. Give `extractPage` its `args: ExtractArgs` parameter now, defaulted and unread, so the signature settles once rather than changing again in T016 and T075. `MAIN_TEXT_CAP` (40 000) and `MIN_TEXT_CHARS` (300) keep their values.
- [X] T006 [P] Build `extension/tests/extractor/helpers/runExtractor.ts` — bundles `extractPage` and evaluates it inside a real Chromium page via `page.evaluate`, returning the settled `RawPageExtract`. This is the lane research R9 requires: jsdom has no `innerText`, so extractor assertions in vitest silently exercise the `textContent` branch.
- [X] T007 [P] Build `extension/tests/extractor/helpers/serveFixtures.ts` — a `node:http` static server over `127.0.0.1:0` (the pattern already in `extension/tests/e2e/jobAnalyzer.spec.ts`) serving both `extension/tests/fixtures/pages/<id>/settled.html` and `extension/tests/e2e/hydration/`.
- [X] T008 Confirm the shared type additions compile in every consumer: `npm run compile` in `extension/`, `npm run build` in `functions/`, and `npm run build` in `web/`. `structuredSources`/`provenance` must not break `isAnalyzeJobRequest`, which validates only `url`/`mainText`/`title`/`jsonLd` and MUST NOT be tightened.
- [X] T008a Build `extension/scripts/rescoreCorpus.ts` — the post-change counterpart to `baselineReport.ts`. It launches Chromium via the T006 harness, evaluates the **current** `extractPage` over each fixture's `settled.html`, and prints the same column layout as `baselineReport.ts` plus a `baseline → now` delta for `body-fallback container`. `baselineReport.ts` reads capture-time numbers out of `manifest.json` and embeds the old extractor as a frozen string in `extension/scripts/corpusProbe.ts`; it therefore **cannot observe any change** to `pageExtractor.ts`, and both files MUST NOT be edited — they are the historical baseline SC-002 is a delta against. Add `corpus:rescore` to `extension/package.json` beside T002's scripts.

**Checkpoint**: Types land, the Chromium harness runs, all three packages compile, and `corpus:rescore` prints a post-change column identical to the baseline before any behavior changes. Story work can begin.

---

## Phase 3: User Story 1 - Extraction Waits for the Page to Be Ready (Priority: P1) 🎯 MVP

**Goal**: `extractPage` becomes async and returns when body text has cleared the usable minimum *and* stopped growing, within a 6000 ms budget — instead of reading an empty shell on the first try.

**Independent Test**: Load a hydrating SPA posting and trigger analysis at first paint, before `main` is populated; the analysis completes against the hydrated content. Separately, a page that never yields content still errors *within* the budget rather than hanging.

**Measured by**: SC-001, SC-003, SC-004, SC-005.

### Tests for User Story 1 ⚠️

> Write these FIRST and confirm they FAIL. The captured snapshots structurally **cannot** test readiness — a saved DOM is ready by construction (spec, Measurement Corpus).

- [X] T009 [P] [US1] Create `extension/tests/e2e/hydration/fast.html` — a shell that injects ~4 000 chars of posting text at 200 ms (fast-path case).
- [X] T010 [P] [US1] Create `extension/tests/e2e/hydration/phenom-like.html` — injects text in growing chunks from 3 400 ms to 4 300 ms, ending at ~11 900 chars, mirroring the measured `phenom-intuit` profile (research R1).
- [X] T011 [P] [US1] Create `extension/tests/e2e/hydration/never.html` — a shell that never injects posting text (budget-expiry case).
- [X] T012 [P] [US1] Create `extension/tests/e2e/hydration/jsonld-early.html` — a `JobPosting` JSON-LD script present at 0 ms, body text injected at 1 500 ms. This is the fixture that fails against a naive implementation.
- [X] T013 [US1] Write `extension/tests/extractor/readiness.spec.ts` asserting, against the four fixtures via T006/T007: `jsonld-early` does **not** return at ~0 ms with empty `mainText` (FR-001, FR-004a); `phenom-like` returns the full ~11 900 chars, not the ~300-char prefix (FR-002, SC-001); `never` returns with `provenance.budgetExpired === true` inside 6 000 ms (FR-003, SC-005); `fast` returns within ~350 ms of text stabilizing (SC-004). Write `jsonld-early` first and confirm it fails.
- [X] T014 [P] [US1] Add a unit test to `extension/tests/unit/jobFlow.test.ts` asserting the thin-content error carries the "still loading" message and action from [contracts/extraction-payload.md](./contracts/extraction-payload.md) §3 when `provenance.budgetExpired` is true, and today's copy when it is false — both `retryable: true`, both under the unchanged `thin-content` code (FR-005).
- [X] T015 [P] [US1] Add a unit test to `extension/tests/unit/jobFlow.test.ts` asserting a cancel issued during the readiness wait stops the wait and sends **no** analysis request (FR-006).

### Implementation for User Story 1

- [X] T016 [US1] Change `extractPage` in `extension/lib/pageExtractor.ts` to return `Promise<RawPageExtract>`. `chrome.scripting.executeScript` awaits a promise returned by `func` and delivers the settled value in `InjectionResult.result` (research R2) — no call-site API change at `extension/services/jobFlow.ts:231` beyond the existing `await` and the `args: [extractArgs]` addition T004/T005 prepared. The function stays serialized: no imports, no module-scope references, no `chrome.*`, constants duplicated inline.
- [X] T017 [US1] Extract the existing single-pass body of `extractPage` into an inner `attempt()` closure in `extension/lib/pageExtractor.ts`, so the readiness loop can call it repeatedly within one injection. One isolated world, one MutationObserver — repeated `executeScript` calls cannot share observer state (research R2).
- [X] T018 [US1] Implement the readiness loop in `extension/lib/pageExtractor.ts`: a `MutationObserver` on `document` drives re-attempts on observed change rather than fixed polling alone (FR-004), with a hard budget of **6000 ms** (research R1).
- [X] T019 [US1] Implement the **400 ms stability window** in `extension/lib/pageExtractor.ts`: return once body text has cleared `MIN_TEXT_CHARS` *and* has not grown for 400 ms. Returning at first crossing captures ~3% of the Phenom posting (FR-002).
- [X] T020 [US1] Implement the **150 ms fast path** in `extension/lib/pageExtractor.ts`: when `document.readyState === "complete"`, text is already above the minimum, and the observer has seen nothing for 150 ms, return immediately. This bounds the cost charged to the five fixtures that settle in 973–1589 ms today (FR-002 second sentence, SC-004).
- [X] T021 [US1] Replace the readiness predicate in `extension/lib/pageExtractor.ts`: readiness keys on **body text only**. Structured data MUST NOT satisfy it, and the old `jsonLd.length > 0 || text >= 300` form MUST NOT be reused as the retry condition (FR-001). While budget remains, do not return structured data with below-minimum body text (FR-004a) — that is the silent-degradation path 3/6 fixtures take today.
- [X] T022 [US1] Populate `provenance.attempts`, `provenance.elapsedMs`, and `provenance.budgetExpired` in `extension/lib/pageExtractor.ts` from the loop's own accounting (FR-007).
- [X] T023 [US1] Split the thin-content branch in `extension/services/jobFlow.ts` (currently ~line 289) on `extract.provenance.budgetExpired`, emitting the two message/action pairs from contracts §3. Keep the `thin-content` code and `retryable: true` — `JobErrorCode` does not change.
- [X] T024 [US1] Add a cancellation generation counter to `extension/services/jobFlow.ts` so a cancel during the readiness wait abandons the in-flight injection result and sends no analysis request (FR-006). A navigation mid-wait must end the wait without an orphaned error — the `activeTab` grant dies with it (spec Edge Cases).
- [X] T025 [US1] Wire the cancel affordance in `extension/components/JobPanel/JobPanel.tsx` to the new generation counter, reusing the existing `cancelledRef` path and the existing "Analyzing page…" spinner (constitution III — no new progress UI needed).
- [X] T026 [US1] Update `extension/tests/unit/pageExtractor.test.ts` and `extension/tests/unit/pageExtractorGoogleOverlay.test.ts` for the async signature and the new `ExtractArgs` parameter (call it with `{}` — the learned path is US4). The Google SERP overlay branch must keep winning on Google search pages (research R10) — that suite passing is a hard gate, not a nicety.
- [X] T027 [US1] Add the QG-4 latency assertion to `extension/tests/extractor/readiness.spec.ts`: benchmark a **fast-path** fixture, not just the Phenom case. The constitution IV 20% p95 regression gate must be evaluated against fast pages, or a regression on everything else hides behind the one slow page (plan.md Constitution Check).
- [X] T028 [US1] Verify SC-003 where it is actually observable: `jsonld-early` (T013) MUST NOT return before body text exists, and `thin-posting-control`'s `settled.html` MUST still produce the thin-content error under `npm run corpus:rescore` (SC-003a — any change that makes it "succeed" is fabricating content). Do **not** expect `corpus:baseline`'s "predicate passed before text" line to move: it is derived from capture-time page timings (`timeToTextMs > timeToReadyMs`), not from extractor behavior, and no code change can alter it. Against the corrected predicate that metric is 0/6 by construction, so T013 is the assertion that carries SC-003, not the scoreboard.

**Checkpoint**: US1 ships alone and fixes the reported `jobs.intuit.com` failure and every site like it. No new UI, no new permissions, no payload change.

---

## Phase 4: User Story 2 - Structured Data and Scored Containers Widen Coverage (Priority: P2)

**Goal**: Replace the fixed three-selector guess with a text-density/link-density scorer, harvest microdata alongside JSON-LD, and carry both to the backend — including into the evidence haystack.

**Independent Test**: Run the fixture corpus through extraction in real Chromium and confirm the share of pages yielding usable content and the share yielding structured data rise against the baseline, with no regression on pages that already succeeded.

**Measured by**: SC-002, SC-006, SC-010.

**⚠️ Phase 4 must not ship without T033 in the same commit as T035/T036.** They are one semantic unit; splitting them ships a silent regression (plan.md Phased Delivery).

### Tests for User Story 2 ⚠️

- [X] T029 [P] [US2] Write `extension/tests/extractor/containers.spec.ts` against the six `settled.html` fixtures via T006/T007, asserting: `lever-palantir`'s selected text does not contain `"Cookie Policy"`; `workday-nvidia`'s does not contain `"Skip to main content"`; no fixture's selected text shrinks below its baseline length (SC-002); and navigation, related-jobs lists, and footers are absent (SC-006).
- [X] T030 [P] [US2] Add FR-013 regression assertions to `extension/tests/extractor/containers.spec.ts`: `greenhouse-discord` and `phenom-intuit` keep their current selections byte-for-byte. These two pass today and are the scorer's regression pair (research R3).
- [X] T031 [P] [US2] Write `extension/tests/extractor/structured.spec.ts` asserting microdata harvest on the fixture that carries it, `kind` provenance per source, pruning to the posting-shaped subtree, and that `JSON.stringify(structuredSources).length ≤ 20000` with sources dropped **whole** rather than truncated mid-object (FR-010, FR-011).
- [X] T032 [US2] **Write this failing first.** Add a test to `functions/tests/unit/jobExtractionOrchestrator.test.ts`: an extract whose `arrangementEvidence` appears **only** in `structuredSources` — not in `jsonLd`, `title`, or `mainText` — survives `validateEvidence` with `arrangement` and `arrangementConfidence` intact. Without T033 it fails, and that failure is the entire point (contracts/extraction-payload.md §2.2).

### Implementation for User Story 2

- [X] T033 [US2] Extend the `validateEvidence` haystack at `functions/src/services/jobExtractionOrchestrator.ts:160` to include `JSON.stringify(req.extract.structuredSources ?? [])`, exactly as in [data-model.md](./data-model.md) §1. The `?? []` is required — older extensions omit the field. This is the feature's most dangerous line.
- [X] T034 [US2] Implement the container scorer inline in `extension/lib/pageExtractor.ts`: `score = textLength × (1 − linkDensity) × penalty`, candidates are elements with ≥200 chars of text, `linkDensity` is anchor-text length over total text length, `penalty` discounts `class`/`id` matching `nav|menu|footer|cookie|consent|banner|sidebar|related|similar|promo|skip`. Hand-rolled and self-contained — no new runtime dependency (FR-038), and a library could not be imported into a serialized function anyway (research R2/R3). Keep the **ranked candidate list** addressable, not just the winner: US4's keyboard path (T069a) renders it in the panel, and FR-024b forbids offering the user only the region that already failed them.
- [X] T035 [US2] Score the semantic container (`main`, `[role=main]`, `article`) as a **candidate rather than a short-circuit** in `extension/lib/pageExtractor.ts`, and let the highest scorer win. This is what satisfies FR-012's "or yields a container that scores worse", and it is what fixes Lever's cookie banner — preferring semantic and scoring only as a fallback measurably does not (research R3).
- [X] T036 [US2] Preserve the Google SERP overlay branch in `extension/lib/pageExtractor.ts` ahead of scoring, reading `innerText` on the **live** node as it does today — `textOf`'s detached clone would leak neighboring postings' hidden preloaded detail views (research R10). Record it as `strategy: "google-overlay"`.
- [X] T037 [US2] Set `provenance.strategy` to `"semantic"`, `"scored"`, or `"body"` per the winning candidate in `extension/lib/pageExtractor.ts` (FR-035).
- [X] T038 [US2] Harvest `JobPosting` microdata (`itemtype="…/JobPosting"` with `itemprop` walking) in `extension/lib/pageExtractor.ts` and emit it as `{ kind: "microdata", data }` (FR-008). Where microdata and JSON-LD disagree, both are transmitted — the prompt resolves the conflict (T041), not the extractor.
- [X] T039 [US2] Populate `structuredSources` in `extension/lib/pageExtractor.ts` in descending confidence order (`json-ld`, then `microdata`), pruned to the posting-shaped subtree, enforcing the 20 000-char cap **in the page before transmission**, dropping sources whole (FR-011, contracts §1).
- [X] T040 [US2] Keep `jsonLd` populated exactly as today in `extension/lib/pageExtractor.ts` and pass `structuredSources` through `extension/services/jobFlow.ts` into the request payload, while **not** transmitting `provenance` — it is client-side only and carries no analysis value (contracts §1).
- [X] T041 [US2] Add the trust-ordering rule to `buildSystemPrompt` in `functions/src/services/jobExtractionOrchestrator.ts:98`, verbatim from contracts §2.1: structured values are ground truth unless the body contradicts them; where JSON-LD and microdata disagree, prefer JSON-LD. Today's body-wins behavior is preserved (FR-016).
- [X] T042 [US2] Append harvested sources labelled by `kind` after the existing JSON-LD block in `buildUserMessage` at `functions/src/services/jobExtractionOrchestrator.ts:135` (FR-014).
- [X] T043 [P] [US2] Add a compatibility test to `functions/tests/unit/analyze-job.handler.test.ts`: `isAnalyzeJobRequest` still accepts a request with `structuredSources` **absent** (old extension) and one with unknown `kind` values (tolerated, ignored for trust ordering, still in the haystack). It MUST NOT be tightened to require the field, or both cross-version directions break (contracts §1).
- [X] T044 [US2] Run `npm run corpus:rescore` in `extension/` (T008a — **not** `corpus:baseline`, which cannot observe your changes) and confirm body-fallback container selection falls from the frozen baseline's **3/6 to ≤1/6** (SC-002), and that no fixture's selected text shrank below its baseline length. **Done 2026-07-26**: rescore shows body-fallback 0/6 (was 3/6); lever-palantir and workday-nvidia shrink only by removing the cookie banner / skip-link+footer, every other fixture holds its baseline. Then run `npx tsx scripts/evalPostings.ts` in `functions/` to confirm arrangement accuracy does not regress and structured-evidence downgrades drop to zero (SC-010). **Done 2026-07-26**: live `eval:postings` run (tier: free, gpt-4o-mini) against the 6-posting fixture set — 100.0% arrangement accuracy (≥90% target), 0 stated-arrangement conflicts, 2/2 hybrid day counts correct, p95 latency 2.5s (≤30s target). No regression from the T033 haystack fix. Script's own output flags the validation set as 6 postings, not the 50 SC-001 wants for full release sign-off — a pre-existing corpus-size gap the eval script itself reports, unrelated to this feature.

**Checkpoint**: US1 + US2 both work. The model now receives the posting instead of the posting plus chrome, and evidence drawn from harvested data is no longer downgraded.

---

## Phase 5: User Story 3 - Paste Posting Text Directly (Priority: P3)

**Goal**: A persistent header button opens a paste composer that analyzes text with no page involved, saved under a content-derived `paste:<sha256>` identity.

**Independent Test**: Open the composer from the header button with no readable page open at all, paste a description, get the same analysis shape and fit scoring as a page analysis, save it, find it again. Separately, a draft survives closing and reopening the composer, switching tabs, and navigating the underlying page.

**Measured by**: SC-007.

### Tests for User Story 3 ⚠️

- [X] T045 [P] [US3] Write `extension/tests/unit/pasteIdentity.test.ts`: the same text with differing incidental whitespace hashes to the same `paste:<sha256 hex>`; below 300 chars and above 40 000 chars are rejected **before** any request is sent (FR-018, FR-021).
- [X] T046 [P] [US3] Extend `extension/tests/unit/TabBar.test.tsx`: after the row/tablist split, `getAllByRole("tab")` still returns exactly **2**, and the existing assertions still pass.
- [X] T047 [P] [US3] Extend `extension/tests/unit/JobPanel.test.tsx`: the paste button is found via `getByRole("button", { name: /paste/i })` and is **not** a child of `role="tablist"` (FR-017a — this catches the tempting shortcut of dropping it inside the existing tablist div); it exposes `aria-pressed` reflecting composer state; Escape and the close control both return to the previously selected tab (FR-017b); closing/reopening and switching to "Saved" and back preserve the draft (FR-017c); a navigation or tab-switch broadcast does **not** close the composer or clear the draft (FR-017d).
- [X] T048 [P] [US3] Add a test to `functions/tests/unit/manageUsers.test.ts` (or a new `functions/tests/unit/savedJobPutBody.test.ts`) covering the `source === "paste"` validation branch: `canonicalUrl` matching `/^paste:[0-9a-f]{64}$/`, `sourceUrl` and `filename` both empty, and rejection of every other shape.

### Implementation for User Story 3

- [X] T049 [P] [US3] Create `extension/lib/pasteIdentity.ts`: normalize whitespace (collapse runs to a single space, trim), hash with `crypto.subtle.digest("SHA-256", …)`, return `paste:<hex>`. Normalizing before hashing is what makes FR-021 survive incidental copy-paste whitespace differences (research R6).
- [X] T050 [P] [US3] Extend `PostingSource` to `"url" | "document" | "paste"` at `functions/src/models/user.ts:128`, add `PASTE_CANONICAL_URL_RE = /^paste:[0-9a-f]{64}$/`, and add the `source === "paste"` branch to `isSavedJobPutBody` at `functions/src/models/user.ts:217`, structurally mirroring the existing `"document"` branch at line 234. No migration: `SavedJobEntity.source` is already optional-on-read with a `"url"` default (data-model §4).
- [X] T051 [US3] Split `extension/components/shared/TabBar.tsx` into a visual header row (a flex container) and the `role="tablist"` element inside it, so a non-tab action button can sit beside the tabs as a **sibling** of the tablist. Every child of a tablist is announced as a tab; a button inside it misrepresents the panel's structure to assistive technology (FR-017a). The sole other caller is its own unit test, so the refactor is contained.
- [X] T052 [US3] Create `extension/components/JobPanel/PasteComposer.tsx` — a textarea occupying the panel body with an explicit close control, character count against the 300/40 000 bounds, and plain-language validation copy stating which bound was crossed and what to do (FR-018, FR-037).
- [X] T053 [US3] Wire the header button and composer state into `extension/components/JobPanel/JobPanel.tsx`: `aria-pressed` on the button, tab panels hidden while the composer is open, Escape and close returning to the previously selected tab, draft held in session state (FR-017, FR-017b, FR-017c).
- [X] T054 [US3] Scope the existing reset-to-idle logic in `extension/components/JobPanel/JobPanel.tsx` (the `navigationId` effect, ~line 100) to the **page view only**, so navigation and tab switches no longer close the composer or clear its draft. Pasted text is independent of any page; evicting the user mid-paste would be a defect introduced purely by the entry-point wiring (FR-017d).
- [X] T055 [US3] Add a paste analysis path to `extension/services/jobFlow.ts` that skips extraction entirely, validates the text against `MIN_TEXT_CHARS`/`MAIN_TEXT_CAP` before any request, and sends `POST /api/analyze-job` unchanged with `provenance.strategy: "paste"` and the `paste:<sha256>` canonical URL (FR-019, FR-022 — same allowance, same library cap, no new endpoint).
- [X] T056 [P] [US3] Add `source: PostingSource` to `SavedJob` in `extension/types/job.ts` and persist/display it in `extension/services/jobStorage.ts`, `extension/components/JobPanel/SavedJobRow.tsx`, and `extension/components/JobPanel/SavedTab.tsx`, so a paste-sourced posting is identified as such rather than attributed to a URL (FR-020). Default to `"url"` on read for existing rows.
- [X] T057 [P] [US3] Add `"paste"` to `PostingSource` in `web/src/api/types.ts` and render it in `web/src/pages/Library.tsx:76` beside the existing `source === "document"` branch. *(Deviation from plan.md's "web is unaffected" — FR-020 binds every surface where a posting's source is shown, and the companion library is one.)*
- [X] T058 [US3] Add the contextual paste shortcut to the extraction-failure and `no-access` states in `extension/components/JobPanel/ThisPageTab.tsx:85`, opening the composer directly. This is a convenience for thin-content but the **sole** remedy for `no-access` pages (Chrome's own pages, the Web Store), which today dead-end with no path forward (FR-017e, SC-007).

**Checkpoint**: US1–US3 all work. Every extraction failure the automatic work does not cover now has an unconditional escape hatch.

---

## Phase 6: User Story 4 - Scope the Page by Hand, and the Host Is Learned (Priority: P4)

**Goal**: Two ways to narrow the current page by hand — an element picker and an "Analyze selection" context-menu item — both feeding one learning path, so the next posting on that host extracts correctly with no user action.

**Independent Test**: On a host where automatic extraction picks the wrong region, scope it by hand (either mechanism), confirm the analysis re-runs against that region; then open a *different* posting on the same host and confirm it extracts from the equivalent region with no user action.

**Measured by**: SC-008, SC-008a, SC-008b, SC-009, SC-011.

**⚠️ US4 depends on US2.** FR-024b's candidate list is the T034 scorer's ranked output. The keyboard path cannot be built before the scorer exists, and re-deriving candidates inside the picker would be the duplication constitution I forbids.

### Tests for User Story 4 ⚠️

- [X] T059 [P] [US4] Write `extension/tests/unit/selectorPath.test.ts` (jsdom is fine — pure logic): machine-generated classes matching `/^(css|sc|jsx|emotion)-|[-_][a-z0-9]{5,}$/i` are rejected (`css-1x2y3z`, `jsx-123`); the path caps at ~4 segments; `#id` → `[data-*]` → `tag.class` → `tag:nth-of-type(n)` preference order holds (FR-027, research R7).
- [X] T060 [P] [US4] Write `extension/tests/unit/learnedSelectors.test.ts`: LRU eviction at **200** hosts by `lastUsedAt` (not `learnedAt`); retirement at **3** consecutive misses; `touch` resets the counter; `recordMiss` fires **once** per extraction, never per readiness attempt (calling it per attempt would retire every learned selector on a slow SPA within two page loads); `put()` is **not** called by the act of scoping, only by accepting the reuse offer (FR-026b, FR-029, FR-030, contracts/learned-selectors.md).
- [X] T061 [P] [US4] Add a storage-unavailable test to `extension/tests/unit/learnedSelectors.test.ts`: every operation degrades to a no-op returning `null`/`void`, and extraction works with the store entirely unreadable.
- [X] T062 [US4] **Write this one first — it is the trap.** Add a cache-bypass test to `extension/tests/e2e/` (Playwright, real extension): analyze a page normally, save it, then scope a different region on the same URL. The scoped result must come back, never the stored one (SC-008a). **Done 2026-07-26**: `extension/tests/e2e/regionScoping.test.ts`, run against a built extension (`npm run build:e2e`) and a live local backend (Azurite + `func start`, `REQUIRE_AUTH=false`). **Found and fixed a real production bug in the process**: `services/pickerService.ts` declared `MAX_CANDIDATES` at module scope but referenced it inside the exported `pickerPageScript`, which is injected via `chrome.scripting.executeScript` and serialized with `Function.prototype.toString()` — a module-scope reference is a `ReferenceError` at runtime under that serialization, not a closure capture. Every real invocation of the keyboard region list (RegionList, US4's FR-024a path) threw and was silently swallowed by `listCandidates()`'s catch into "No regions were found on this page" — the entire keyboard-picker feature was non-functional in the shipped extension. No existing unit test caught it because `tests/unit/pickerService.test.ts` calls `pickerPageScript` in-process (jsdom), never crossing the serialization boundary. Fixed by moving the constant inside the function; added `extension/tests/extractor/pickerService.spec.ts` (real Chromium, `page.evaluate`) as permanent regression coverage for that exact boundary. The unit-level cache-bypass equivalent (jobFlow always sets `bypassCache` on a scoped analysis) remains in `tests/unit/jobFlow.test.ts`.
- [X] T063 [P] [US4] Add a full-selection test to `extension/tests/e2e/`: select a posting body longer than the context-menu payload's truncation limit and confirm the analyzed text matches the live `window.getSelection()`, not the truncated copy (FR-023b, SC-008b). **Resolved 2026-07-26 as infeasible to add beyond what exists, not deferred**: Chrome's native context menu is OS-level browser chrome, not part of the page's DOM/accessibility tree, so Playwright cannot open it or click an item inside it (`chrome.contextMenus.onClicked` is fired only by that native menu — there is no public API to dispatch it from outside, and background.ts's handler is a private closure, not separately invocable). `tests/extractor/selectionService.spec.ts` (real Chromium, no jsdom) already asserts the load-bearing claim at full fidelity: a ~11,500-char live selection is read in full via `window.getSelection()`, and — by inspection of `selectionService.ts` — `readLiveSelectionInPage` never reads `info.selectionText` at all, so the "not the truncated copy" guarantee holds structurally, not just empirically. Verified this remains true and green as part of the same pass.
- [X] T064 [P] [US4] Add an unavailability test to `extension/tests/unit/ThisPageTab.test.tsx`: on a page the extension cannot read, both scoping affordances are disabled **with a stated reason** and point at paste, rather than being present-and-broken (FR-036a).
- [X] T064a [P] [US4] Write `extension/tests/unit/RegionList.test.tsx` — the SC-011 gate. Drive the entire region-selection flow with keyboard events only, dispatching **no pointer event at any point**: open, `↑`/`↓` to a candidate, Enter to commit. Assert each candidate's accessible name carries its label, length, and excerpt (FR-024b). **Deviation**: the always-analyze-offer keyboard interaction lives in `ThisPageTab`/`AlwaysAnalyzeOffer` (plain `<button>`s, natively keyboard-operable), not in `RegionList` itself, so it is not exercised in this file; Escape-returns-focus is asserted at the `ThisPageTab` level (RegionList itself is unmounted/remounted by its parent, which owns the opening control). A test that reaches for `click()` anywhere has stopped testing WCAG 2.1.1.
- [X] T065 [US4] Add a cross-posting generalization test to `extension/tests/extractor/`: learn a region on posting A and verify posting B from the same board extracts from the equivalent region with no user action — once via a picked node, once via a selection's common ancestor, since FR-023c requires both to produce an equivalent selector. `npx tsx scripts/captureCorpus.ts --only=lever` already resolves up to 4 candidate postings, so the second posting needs no new tooling (SC-008, research R7). **Done 2026-07-26**: `extension/tests/extractor/crossPosting.spec.ts`, gated behind `LIVE_CORPUS=1` (opt-in, like `E2E=1`) so the rest of the "extractor" project stays network-free and unconditional in CI per playwright.config.ts. Run live against `jobs.lever.co/palantir`: both mechanisms (top-ranked picked candidate; that same candidate's selection common ancestor) produce a selector from posting A that `extractPage({ learnedSelector })` resolves on posting B with `provenance.strategy === "learned-selector"` and usable text length — both passed (11.9s, 2.7s).

### Implementation for User Story 4

- [X] T066 [P] [US4] Create `extension/lib/selectorPath.ts` — pure, jsdom-testable: walk upward from the picked element to the first stable anchor, preferring `#id`, then a `[data-*]` attribute, then `tag.class` filtered to human-looking classes, then `tag:nth-of-type(n)`; cap at ~4 segments. Postings on one host share a template but not ids or positions, so the selector must describe structure rather than identity (research R7).
- [X] T067 [P] [US4] Create `extension/services/learnedSelectors.ts` implementing `get` / `put` / `touch` / `recordMiss` / `clear` / `clearAll` / `list` over `chrome.storage.local` key `learned:<host>`, per [contracts/learned-selectors.md](./contracts/learned-selectors.md). Host is stored bare — no scheme, port, or path — so one learning covers every posting on the board. `local`, not `sync`: FR-033 requires these never leave the browser (research R8).
- [X] T068 [US4] Add `"contextMenus"` to `manifest.permissions` in `extension/wxt.config.ts`. An API permission granting no site access — it does not weaken the permission posture, and **no host permissions are added** (FR-036).
- [X] T069 [US4] Create the pointer path — hover highlight of the block under the cursor with an indication of what will be captured, click to commit, Escape and page-leave to dismiss with no side effects (FR-024, FR-025). Handle the page re-rendering under the cursor between hover and click (spec Edge Cases) by re-resolving the node at click time. **Deviation**: implemented as `pickerService.ts`'s `pointerPick` (a self-contained `executeScript` function, the same established pattern `extractPage`/`selectionService.ts` use — not a separate `extension/entrypoints/picker/` WXT content-script entrypoint) and surfaced via `ThisPageTab.tsx`'s `PointerScoping` component, not a bare overlay module. Both mechanisms are reachable from one "Analyze a region" entry point (`RegionScoping`) via a mode toggle rather than running concurrently: `pointerPick` and the keyboard list's live highlighting are both exclusive, promise-resolving page sessions, and running them at once would leave whichever one the user didn't use dangling with no clean way to tear it down from the panel.
- [X] T069a [US4] Create `extension/components/JobPanel/RegionList.tsx` — the **keyboard path** (FR-024a), rendered in the panel because an in-page overlay cannot take focus from a panel control. Lists the ranked candidates (via `pickerService.listCandidates`, which duplicates the T034 FR-012 scorer inline — see pickerService's file header for why) with label, text length, and leading excerpt (FR-024b); `↑`/`↓` move the active candidate, Enter commits, Escape exits and returns focus to the control that opened it (FR-025, verified at the `ThisPageTab` level). Moving the active candidate highlights it on the page as a **supplement** via `pickerService.highlightCandidate` — a screen-reader user can choose from the list alone. Ordinary panel DOM, so it inherits the panel's focus handling rather than fighting it.
- [X] T070 [US4] Create `extension/services/pickerService.ts` — inject the overlay into the active tab and await the picked node's selector, resolving via a duplicated `selectorPath` (the same serialization constraint documented in the file header). Also exposes the ranked candidate list to the panel for T069a, and a `highlightCandidate` call the list drives as the active item changes. Re-resolves the node at commit time via `resolveCandidateText`: a page that re-rendered since the list was built cannot commit a stale node (spec Edge Cases) — returns a plain-language refusal instead.
- [X] T071 [US4] Create `extension/services/selectionService.ts` — read the **live** `window.getSelection()` via `executeScript`, never the context-menu payload's own `selectionText`, which is truncated and which job postings routinely exceed (FR-023b). Derive the range's `commonAncestorContainer` as the region for learning purposes (FR-023c). A selection inside a shadow root or cross-origin iframe must fail with an explanation rather than storing a selector that can never match (spec Edge Cases).
- [X] T072 [US4] Register the "Analyze selection" context menu and its `onClicked` handler in `extension/entrypoints/background.ts`. The handler carries its own `activeTab` grant, which is what makes this work **without the panel being open beforehand** (FR-023a). Handle invocation on a tab whose analysis is open in the panel for a *different* tab (spec Edge Cases).
- [X] T073 [US4] Add the scoped-analysis path to `extension/services/jobFlow.ts`: it runs against the scoped region's text, is identified by the page's **canonical URL** (not a synthetic identity), sets `provenance.strategy` to `"picked"` or `"selection"` per the mechanism that produced the region (the two values data-model.md §2 defines and nothing else assigns — they are what lets the eval harness tell "the user just corrected this" from "the correction is still working"), and MUST set `bypassCache` on every scoped analysis so the library/session-cache lookup at `jobFlow.ts:310` is skipped and then replaced (FR-026, FR-026a, SC-008a). Without this the correction silently returns the previous wrong analysis and appears to do nothing.
- [X] T074 [US4] Refuse a scoped region yielding less than `MIN_TEXT_CHARS` in `extension/services/jobFlow.ts` with a plain-language explanation, leaving the user able to try again without restarting the flow (FR-034, SC-008 edge: a few-words selection deserves refusal, not an analysis of a fragment).
- [X] T075 [US4] Add the learned-selector read path **inside** the readiness loop in `extension/lib/pageExtractor.ts`, per contracts/learned-selectors.md §"Read path ordering". `extractPage` gains one parameter, `{ learnedSelector }: ExtractArgs`, supplied by the caller via `executeScript({ args })` — it MUST NOT read `chrome.storage` itself and MUST NOT import `learnedSelectors.ts` (it is serialized; it can do neither). When the selector is present, `querySelector` it each attempt and use it when it yields ≥ `MIN_TEXT_CHARS` with `strategy: "learned-selector"`; otherwise fall through **silently** to the automatic ladder and report the outcome via `provenance.learnedSelectorMissed`. A selector matching nothing at t=0 on a hydrating SPA is not a miss — it is a page that has not rendered yet (FR-028, FR-029, SC-009).
- [X] T076 [US4] In `extension/services/jobFlow.ts`: look up `learnedSelectors.get(host)` before injection and pass it in T075's `args`; after the extraction settles, call `touch(host)` when `provenance.strategy === "learned-selector"` and `recordMiss(host)` exactly once when `provenance.learnedSelectorMissed` is true. Both storage writes live here, never inside the injected function, and `recordMiss` fires per *extraction*, never per readiness attempt (FR-029).
- [X] T077 [US4] Add the **"Analyze a region"** entry point to `extension/components/JobPanel/ThisPageTab.tsx`, reachable both from a failed extraction (error card) and from a successful-but-wrong one ("Wrong region? Analyze a region" beside Re-analyze), opening `RegionScoping` — the keyboard list by default, with "Use the pointer on the page instead" switching to `PointerScoping`, both from one entry point (see T069's deviation note). It lives on the "This Page" surface, **not** behind the paste button, whose purpose is off-page input (FR-023). Disable the affordance with a stated, cause-specific reason on a no-access page, pointing at paste (FR-036a, FR-032a's `aria-describedby`).
- [X] T078 [US4] Add the post-success always-analyze offer to `extension/components/JobPanel/ThisPageTab.tsx`: after a scoped analysis succeeds, offer "Always analyze this region on `<site>`"; declining stores nothing. Use the vocabulary fixed in spec §User-Facing Vocabulary — "region", "site", "always"; never "learn", "remember", or "save" in user copy. Learning is offered, never imposed by the act of scoping — a one-off correction on an unusual posting must not silently teach a selector that misapplies to every posting on that host (FR-026b). Where a selection's common ancestor is far broader than the highlighted text, the offer must describe the **broader region it would actually store** (spec Edge Cases).
- [X] T079 [US4] Add the stored-region badge to `extension/components/JobPanel/ThisPageTab.tsx`, driven by `provenance.strategy === "learned-selector"` (FR-032). User-facing wording per spec §User-Facing Vocabulary — the badge names a region and a site, not a "learned selector"; the `"learned-selector"` value is internal and never surfaces.
- [X] T080 [US4] Add "Clear region for this site" and "Clear all site regions" controls to `extension/entrypoints/options/OptionsApp.tsx`, backed by `clear`/`clearAll`/`list` from `extension/services/learnedSelectors.ts` (FR-031). `clearAll()` removes everything this feature persists. Module names stay `learnedSelectors`; only the copy changes.
- [X] T081 [US4] Confirm no selector, host, or scoped content is transmitted to the backend under this feature — grep the request builders in `extension/services/jobFlow.ts` and `extension/services/jobAnalysisClient.ts` and assert it in `extension/tests/unit/jobFlow.test.ts` (FR-033, contracts §4).

**Checkpoint**: All four stories independently functional. A single user correction now becomes durable per-host coverage.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T082 [P] Verify every extraction result records its strategy across all eight values (`learned-selector`, `picked`, `selection`, `semantic`, `scored`, `google-overlay`, `body`, `paste`) and that the eval harness can read it (FR-035). **Found and fixed a real gap**: `PasteAnalysisResultMessage` never carried `strategy: "paste"` — added it (now required) and set it at both `analyzePastedText` broadcast sites in `jobFlow.ts`, with a unit test.
- [X] T083 QG-3 UX review of the new surfaces. **Named watch item resolved**: T090 built the concrete hierarchy — Retry (primary, filled), "Analyze a region" (secondary, outlined), paste (plain-text link) — so the red box holds one primary action plus two demoted alternatives, not three equal buttons.
- [X] T084 [P] Audit every new error and empty state for plain language with a stated next action (FR-037, constitution III), including the "still loading" variant, the too-small scoped region, and the disabled-scoping reason. In the same pass, grep all user-visible strings for "learn", "remember", "save", "selector", "host", "pick", and "scope" — spec §User-Facing Vocabulary permits none of them in copy, and this is the check that catches them before QG-3 does. **Result**: clean grep across all new/changed components; one message tightened (`resolveText`'s "This region is no longer on the page." now states the next action: "Choose another one from the list.").
- [X] T085 [P] Append the `corpus:rescore` output to `extension/tests/fixtures/pages/README.md` as a second column beside the frozen baseline, so the SC-002 body-fallback delta (3/6 → ≤1/6) is legible without re-running anything. Note in the README that the "predicate before text" row has **no** post-change counterpart (see T028) and that re-capturing the corpus invalidates both columns.
- [X] T086 [P] Document the readiness budget, the learned-selector store, and the paste identity scheme wherever the extension's behavior is described for users and contributors; note that FR-009 (state-blob harvesting) is a deliberate, evidence-gated non-implementation so it is not re-proposed from folklore. Added to the repo-root `README.md` (a new "Resilient extraction" row in "What it does", a new design-decisions paragraph, and the 005 spec added to the Spec Kit feature list).
- [X] T087 Run the full gates: `npm run lint && npm test` in `extension/` and `functions/`, plus `npx playwright test --project=extractor` in `extension/` (real-Chromium extractor lane). All green: extension 34 unit files / 379 tests, functions 16 files / 229 tests, extractor 23/23. **Partial**: `npm run compile` (`vue-tsc --noEmit`) fails pre-existing and unrelated to this feature — `vue-tsc` is not installed and isn't a project dependency (this is a React project; the script appears to be leftover from a template). Verified instead with plain `tsc --noEmit -p tsconfig.json`: identical error set to the pre-005-work baseline (WXT ambient globals and a vitest/vite version mismatch in `vitest.config.ts`, both pre-existing and outside this feature's files) — zero new errors introduced. QG-1 (lint) is zero-warnings in both packages.
- [X] T088 Run the E2E suite against a built extension and live backend: `npm run build:e2e && E2E=1 npm run test:e2e` in `extension/`. **Done 2026-07-26**: run against a local Functions host (Azurite with blob+queue+table — table-only was the initial mistake, see below — and `REQUIRE_AUTH=false` per `specs/003-freemium-premium-tier/quickstart.md`'s documented convention for the stub-auth suite). All 9 tests pass, including the new `regionScoping.test.ts` (T062). Two environmental red herrings surfaced and were resolved, neither a 005 regression: (1) `REQUIRE_AUTH=true` was left on in `local.settings.json` from prior manual testing, which 401s the e2e suite's stub JWTs — flipped to `false` for the run and restored to `true` afterward; (2) running only `azurite-table` (the project's own `npm run azurite` script) leaves the Functions host's own storage health checks unhealthy (blob/queue absent), which intermittently broke the very first request of a run — full `azurite` (blob+queue+table) fixed it. Also caught and fixed a real bug along the way — see T062.
- [X] T089 Walk [quickstart.md](./quickstart.md) §3 end to end and confirm every success criterion (SC-001 through SC-010) is demonstrated. **Read QG-2 with its caveat**: meaningful extractor assertions moved into Playwright, which vitest's coverage reporter does not count, so the percentage may fall where real verification improved. Judge the change on the Playwright suite, not the number alone. **Done 2026-07-26**: every success criterion now has a live/real-Chromium demonstration, not just a unit-level one. SC-001/SC-003/SC-004/SC-005 — extractor readiness spec (T013/T027). SC-002/SC-006 — `corpus:rescore` (T044) plus `containers.spec.ts`. SC-007 — paste-path unit/component suites (US3, unchanged this pass). SC-008/SC-008a/SC-008b/SC-009/SC-011 — T062 (`regionScoping.test.ts`, real extension + live backend), T063 (real-Chromium `selectionService.spec.ts`), T065 (`crossPosting.spec.ts` against the live lever.co board), T064a (keyboard-only `RegionList.test.tsx`). SC-010 — T044's live, billed `eval:postings` run (100% arrangement accuracy, 0 conflicts). Full gates green: 379 extension unit tests, 9/9 e2e, 24/24 extractor by default (23 original + `pickerService.spec.ts`) plus 2/2 more under `LIVE_CORPUS=1` (`crossPosting.spec.ts`, skipped otherwise), lint clean. This pass also found and fixed one real bug (see T062) that no prior gate had caught.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — starts immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all four stories** — every story reads the shared types, and US1/US2 assert through the Chromium harness.
- **US1 (Phase 3)**: Depends on Foundational only.
- **US2 (Phase 4)**: Depends on Foundational. Independently shippable, but *measurement* is unreliable before US1 removes timing noise — a scorer benchmarked against half-hydrated pages is benchmarked against nothing.
- **US3 (Phase 5)**: Depends on Foundational only. The most independent of the four — it touches no extraction code.
- **US4 (Phase 6)**: Depends on Foundational; on US3 for the paste escape hatch that FR-036a points unreadable pages at; and on **US2** for the T034 scorer, whose ranked candidates are what FR-024b's keyboard list renders. T075 also lands inside the readiness loop US1 builds. In practice US4 is last of the four, which the priority order already implies.
- **Polish (Phase 7)**: Depends on all desired stories.

### Critical in-story ordering

- **T032 before T033.** The haystack test must fail first, or the fix is unverified.
- **T033 ships in the same commit as T035/T036.** Splitting them ships a silent regression.
- **T013 (`jsonld-early`) before T016–T022.** It is the assertion the naive implementation fails.
- **T062 before T073.** Cache bypass is the trap; write the test that catches it first.
- **T004/T005 before everything.** Both are single-file, so they serialize.
- **T051 before T053.** The composer button cannot be placed correctly until the tablist is split out of the header row.
- **T066/T067 before T070–T076.** Selector generation and storage are the pure substrate the picker, selection reader, and extraction path all sit on.

### Same-file serialization (do NOT parallelize)

`extension/lib/pageExtractor.ts` is touched by T005, T016–T022, T034–T040, and T075 — the single busiest file in the feature. `extension/services/jobFlow.ts` is touched by T023, T024, T040, T055, T073, T074, T076. Neither file's tasks carry `[P]`.

### Parallel Opportunities

- Setup: T002, T003 together.
- Foundational: T006, T007 together after T004/T005.
- US1: the four hydration fixtures T009–T012 together; T014/T015 together.
- US2: T029, T030, T031 together; T043 alongside implementation.
- US3: T045–T048 together; then T049, T050, T056, T057 together (four different packages/files).
- US4: T059, T060, T061 together; T063, T064 together; T066/T067 together.
- Polish: T082, T084, T085, T086 together.

---

## Parallel Example: User Story 1

```bash
# The four hydration fixtures — different files, no shared state:
Task: "Create extension/tests/e2e/hydration/fast.html"
Task: "Create extension/tests/e2e/hydration/phenom-like.html"
Task: "Create extension/tests/e2e/hydration/never.html"
Task: "Create extension/tests/e2e/hydration/jsonld-early.html"

# Then the two unit tests, both in jobFlow.test.ts but on separate branches:
Task: "Still-loading thin-content copy test"
Task: "Cancel-during-readiness test"
```

## Parallel Example: User Story 3

```bash
Task: "Create extension/lib/pasteIdentity.ts"
Task: "Extend PostingSource + isSavedJobPutBody in functions/src/models/user.ts"
Task: "Add source to SavedJob in extension/types/job.ts and its display surfaces"
Task: "Add paste to PostingSource in web/src/api/types.ts and Library.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup — lock the baseline.
2. Phase 2: Foundational — types + Chromium harness (blocks everything).
3. Phase 3: US1 — readiness.
4. **STOP and VALIDATE**: SC-001, SC-003, SC-004, SC-005 against the hydration fixtures; predicate-before-text 3/6 → 0/6.
5. Ship. US1 alone fixes the reported Intuit failure and every site like it — no new UI, no new permissions, no payload change.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. **US1** → readiness → ship (MVP).
3. **US2** → containers + structured sources + haystack, as one commit → ship.
4. **US3** → paste → ship.
5. **US4** → picker, selection, learned hosts → ship.

Each increment is measurable on its own scoreboard line, and none breaks the previous.

### Parallel Team Strategy

After Foundational, US1 and US3 can proceed simultaneously — US3 touches no extraction code at all. US2 should follow US1 so its measurements are trustworthy. US4 should follow US3, since FR-036a routes unreadable pages to paste.

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks.
- Verify tests fail before implementing — particularly T013, T032, and T062, each of which passes trivially against a naive implementation and would otherwise certify nothing.
- Commit after each task or logical group, except T033 + T035/T036, which are one commit by design.
- The corpus is the scoreboard. Do not re-capture mid-feature: it moves the baseline you are measured against (quickstart §2).
- `MAIN_TEXT_CAP` (40 000), `MIN_TEXT_CHARS` (300), the analysis schema, fit scoring, metering, tier behavior, and the `SavedJobs` table schema all stay unchanged (data-model, "What deliberately does not change").

---

## Phase 8: Convergence

**Source**: `/speckit-converge` run 2026-07-26, after the `checklists/ux.md` QG-3 pass sharpened ~35 requirements in `spec.md` (new FR-006c, FR-007a, FR-007b, FR-017f, FR-018a, FR-020a, FR-024c, FR-032a, and concrete numbers/behavior added to several existing FRs). These tasks close the gap between those sharpened requirements and the still-pending US2–US4 task descriptions; nothing here touches the already-shipped US1 (Phase 3).

- [X] T090 [US4] Implement the concrete thin-content error-card action hierarchy in the panel: Retry as the primary filled button, "Analyze a region" as a secondary outlined/text button, and the paste shortcut as a plain-text link, not a third button — replacing T083's open watch item with a build per FR-007b
- [X] T091 [US3] Extend `PasteComposer`/`JobPanel.tsx` (T052/T053) so the "This Page"/"Saved" tab controls are unreachable by pointer and keyboard while the composer is open, the composer carries an accessible region role and name (e.g. `role="region"` + accessible name), and keyboard focus moves into the composer's textarea on open and returns to the header button on Escape or close, per FR-017b
- [X] T092 [US4] Add an `aria-live` region to `RegionList.tsx` (T069a) announcing the active candidate's label whenever arrow keys or hover change it, per FR-024b
- [X] T093 [US4] Style the picker overlay's highlight (T069) to meet a 3:1 contrast ratio against arbitrary page content and to be distinguishable by a shape/outline change, not color alone, per FR-024c / WCAG 1.4.1 & 1.4.11 — implemented as a white+blue double ring (`boxShadow: "0 0 0 2px #ffffff, 0 0 0 5px #2563eb"` plus a solid `outline`), which stays perceivable against arbitrary page backgrounds by pairing light+dark rings rather than one flat color.
- [X] T094 [US1] Add a test to `extension/tests/unit/jobFlow.test.ts` asserting a cancel during the readiness wait, followed immediately by re-triggering analysis on the same page, produces a normal full-budget attempt with no per-page lockout or cooldown, per FR-006c
- [X] T095 [US3] [US4] Wire the paste-submission path (T055) and the scoped-analysis commit path (T073) to surface the existing "Analyzing page…" progress indicator within 300 ms of being triggered, matching FR-007a's requirement that it cover every analysis trigger, not only page load. Paste already set `status: "analyzing"` synchronously (T055); the scoped-analysis commit path (`JobPanel.tsx`'s `analyzeRegion`) now does too, verified in `JobPanel.test.tsx`.
- [X] T096 [US3] Add placeholder guidance text to `PasteComposer`'s (T052) empty state (e.g. "Paste a job posting…") per FR-017c
- [X] T097 [US3] Show the allowance-exhausted state immediately when the paste composer opens (T053), before the user starts typing, rather than only at submission, per FR-017f
- [X] T098 [US3] [US4] Add a shared message-formatting helper for the below-minimum/above-cap refusal text used by the paste path (T052) and the scoped-region refusal (T074), stating the exact bound and a matching next-action verb in both, per FR-018a — `lib/textBounds.ts`'s `boundViolation`, used by both `PasteComposer.tsx` and `jobFlow.ts`'s `analyzeScopedRegion`.
- [X] T099 [US3] Define the paste-sourced label shown in list surfaces (T056/T057): the extracted job title if analysis produced one, otherwise a short excerpt of the pasted text — never blank, a URL-shaped placeholder, or the raw `paste:<sha256>` key, per FR-020a. `JobPanel.tsx`'s `handleSavePaste` substitutes `lib/textExcerpt.ts`'s `excerptOf(pasteDraft)` for `analysis.title` at save time when extraction produced none, so every existing title-display path (`SavedJobRow.tsx`, `web/src/pages/Library.tsx`) gets the fallback for free.
- [X] T100 [US4] Show the hovered candidate's text length near the cursor in the pointer-picker overlay (T069), matching the measure FR-024b's panel list shows, per FR-024 — `pickerService.ts`'s `pointerPick` renders a small fixed-position badge (`#jpa-picker-cursor-badge`) tracking the cursor with the live character count of the block under it.
- [X] T101 [US4] Extend picker dismissal (T069/T070) to restore the page's scroll position and remove all overlay-applied styling (highlight outlines, dimming, cursor changes), in addition to the focus restoration T025 already requires, per FR-025 — `pickerService.ts`'s `clearHighlight`/`cancelPointerPick`; regression-tested in `pickerService.test.ts` (a bug where repeated highlight calls corrupted the remembered scroll origin was found and fixed while building this).
- [X] T102 [US4] Make the always-analyze offer (T078) persist inline until the user accepts, declines, or navigates away — treating navigation-away as a decline — and show a brief confirmation naming the site on acceptance, per FR-026b
- [X] T103 [US4] Add a per-host list to the options page (T080) — one row per learned host showing the site and a per-row clear control, backed by `learnedSelectors.list()` (T067) — with clearing taking effect immediately and no confirmation dialog, per FR-031
- [X] T104 [US4] Give the stored-region badge (T079) an accessible name equal to its visible text (already true — it is a plain text paragraph, no icon-only/color-only affordance), and associate the disabled-scoping-control reason (T064/T077) via `aria-describedby` rather than adjacent visual text alone, per FR-032a — `ThisPageTab.tsx`'s "Analyze a region" button + `#region-disabled-reason`.
- [X] T105 [US4] Define recovery for a scoped analysis (T073) that fails after the region was committed (network error, allowance exhausted between commit and response): the committed region remains current, and retrying re-runs against that same region rather than requiring the user to scope again, per spec Edge Cases — `JobPanel.tsx`'s `pendingScopedRegionRef` + `retryAnalysis`, tested end to end in `JobPanel.test.tsx`. Scoped by mechanism: covers `"picked"` (panel-driven); `"selection"` (context-menu-driven, issued directly by the background script) has no stable resource left to retry against by the time an error could show, since the live page selection it depended on may already be gone — documented in code rather than silently unhandled.
- [X] T106 [US4] Suppress the always-analyze learning offer (T078) when a selection fails due to a shadow root or cross-origin iframe (T071), since no selector from that attempt can ever match, per spec Edge Cases — **verified as already correct, no code change needed**: `analyzeScopedRegion` (and thus the `scopedRegion`/offer path) is only ever invoked when `readLiveSelection` returns `ok: true`; an unscopeable selection short-circuits in `background.ts` before reaching it.
- [X] T107 [US4] Ensure the disabled-scoping "stated reason" (T064/T077) and the shadow-root/cross-origin-iframe selection failure (T071) use distinct, cause-specific wording rather than one shared generic message, per FR-036a — added a `cause: "empty" | "unscopeable"` discriminant to `selectionService.ts`'s failure type, branched on in `background.ts` for distinct action text; `ThisPageTab.tsx`'s no-access reason is separately worded from the selection failure. Tested in `background.test.ts` and `tests/extractor/selectionService.spec.ts`.
