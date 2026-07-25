# Implementation Plan: Resilient Page Extraction with User-Driven Fallbacks

**Branch**: `005-resilient-extraction` | **Date**: 2026-07-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-resilient-extraction/spec.md`

## Summary

Extraction today is one synchronous pass that reads JSON-LD and takes the longest
text among `main`, `[role=main]`, and `article`. A corpus of six live postings
(`extension/tests/fixtures/pages/`) was captured **before** planning and measured
against the shipped extractor; its baseline drives every decision here and
overturned three assumptions in the spec's first draft.

Four changes, in the order they should ship:

1. **Readiness (P1)** — `extractPage` becomes async and waits for the posting to
   render, keyed on *body text stability* rather than the current predicate.
   The current predicate is not merely absent, it is **wrong**: `jsonLd.length > 0
   || text >= 300` passes on JSON-LD alone, before any body text exists, on 3 of 6
   fixtures. A retry loop built on it would return instantly with an empty
   `mainText`. Budget 6000 ms, from a measured worst case of 4883 ms.
2. **Container scoring (P2)** — replace the fixed three-selector guess with a
   text-density/link-density scorer, hand-rolled inline because the extractor is
   serialized into the page and cannot import anything. **3 of 6 fixtures fall
   through to `document.body` today**, admitting cookie banners and skip-links
   into the model input. This is the feature's highest-value automatic change.
   Microdata joins JSON-LD as a harvested structured source; **state-blob
   harvesting is not built** — the measurement does not support it.
3. **Paste (P3)** — the unconditional escape hatch, extending 004's
   `PostingSource` discriminator with `"paste"` and `paste:<sha256>` identity.
4. **Element picker with learned hosts (P4)** — the only path that turns one user
   correction into durable per-host coverage.

The backend delta is small but contains the feature's most dangerous line:
`validateEvidence`'s substring haystack must grow to include the new structured
sources, or Story 2 will *reduce* arrangement confidence on exactly the pages it
improves. No new Azure resources, no new runtime dependencies, no new host
permissions.

## Technical Context

**Language/Version**: TypeScript 5.x (strict); React 18 in `extension/`; Node 20
for Azure Functions.

**Primary Dependencies**: None added. Spec FR-038 forbids a new bundle dependency
for container scoring, and R2/R3 show a library could not be used inside the
serialized extractor anyway. `tsx` is invoked via `npx` for corpus scripts,
matching the existing `functions` convention (`eval:postings`) — not a new
package dependency.

**Storage**: `chrome.storage.local` gains learned selectors (`learned:<host>`,
200-host LRU cap). Azure Table Storage `SavedJobs` gains one `PostingSource`
value (`"paste"`); no new tables, no schema migration — 004 already made `source`
optional-on-read with a `"url"` default.

**Testing**: Vitest (jsdom) for pure logic; **Playwright against real Chromium**
for anything touching `innerText`, layout, or the corpus — jsdom does not
implement `innerText`, so existing extractor unit tests silently exercise the
`textContent` branch (research R9). A synthetic delayed-hydration fixture on the
existing e2e localhost server covers readiness, which the captured snapshots
structurally cannot.

**Target Platform**: Chrome MV3 extension (WXT); Azure Functions (Linux, Node 20).

**Project Type**: Monorepo — `extension/`, `functions/`, `web/`, `shared/`.
This feature touches `extension/` and `functions/`; `web/` is unaffected.

**Performance Goals**: Readiness budget ≤ 6000 ms worst case, inside the 30 s
analysis ceiling (constitution IV). Static pages pay ≤ 150 ms via the fast path.
The five fixtures that settle in 973–1589 ms today must not regress beyond the
stability window.

**Constraints**: `extractPage` is serialized by `chrome.scripting.executeScript`
and must stay self-contained — no imports, no module scope (this is why constants
are duplicated inline today). `activeTab` only: no new host permissions in store
builds, and the grant dies on navigation, so a learned selector applies at the
*next* toolbar click. Learned selectors never leave the browser (spec FR-033).

**Scale/Scope**: 6 corpus fixtures (2 platform gaps accepted: iCIMS, and
SmartRecruiters beyond a stub). ~200 learned hosts per user. One new panel
surface (paste), one new in-page overlay (picker).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Derived from `.specify/memory/constitution.md` v1.2.0:

| Principle | Gate | Status |
|-----------|------|--------|
| **I. Code Quality** | Meaningful naming, no dead code, single responsibility, review before merge. | ✅ PASS — the scorer, readiness loop, and picker are separable units. One knowing exception: `extension/scripts/corpusProbe.ts` **duplicates** the extractor's container logic as a string, because the extractor is serialized and cannot be imported by a Node script. Confined to one file, documented in-file, and load-bearing only for measurement. |
| **II. Testing Standards** | Test-first; ≥80% coverage on changed modules; real fixtures not hollow mocks; E2E for every P1 journey. | ✅ PASS — the corpus is real captured pages, not mocks; the readiness fixture is synthetic **by necessity** (a saved DOM is ready by construction), which is the honest form of the "recorded fixture" rule here. P1 (readiness) gets an E2E path. See the QG-2 note below. |
| **III. UX Consistency** | Progress indicator > 300 ms; plain-language errors + next action; stable terminology; WCAG 2.1 AA. | ✅ PASS — the existing "Analyzing page…" spinner already covers the readiness wait; thin-content copy gains a "still loading" variant with a retry; picker needs keyboard dismissal (Escape) and an accessible live region announcing what is highlighted. |
| **IV. Performance** | Analysis ≤ 30 s; UI non-blocking; ≤ 512 MB; reject ≥ 20% p95 regression. | ⚠️ **PASS WITH A WATCH ITEM** — 6 s worst-case extraction is new latency *ahead of* the model call. On the 5 fast fixtures the added cost is the stability window, not the budget. The 20% p95 regression gate must be evaluated against the **fast-path** cases, not the Phenom case; measuring only Phenom would hide a regression on everything else. |
| **V. Cost Discipline** | New infrastructure MUST default to a genuinely free tier. | ✅ PASS — no new infrastructure, no new managed resource, no metered anything. Corpus capture runs locally on demand. |

**Quality Gates**: QG-1 (lint zero-warnings — new `extension/scripts/` is already
clean). **QG-2 (≥80% coverage) carries a caveat worth stating rather than
burying**: coverage on the injected extractor is partly illusory today because
jsdom lacks `innerText`. This feature relocates the meaningful assertions into
Playwright, which vitest's coverage reporter does not count. Expect the *number*
to move even where real verification improves; judge the change on the Playwright
suite, not the percentage alone. QG-3 (UX review of picker + paste + new error
copy). QG-4 (latency benchmark — must include a fast-path fixture).

**Development Workflow**: Feature branch `005-resilient-extraction` (**not yet
created** — see Deviations). No dependency additions. Docs updated in-PR.

**Result**: No violations requiring the Complexity Tracking table. Two items are
called out above rather than silently passed: the QG-2 coverage caveat and the
QG-4 measurement target.

## Project Structure

### Documentation (this feature)

```text
specs/005-resilient-extraction/
├── plan.md              # This file
├── spec.md              # Revised against the corpus baseline
├── research.md          # Phase 0 — R1..R10
├── data-model.md        # Phase 1 — entities and storage shapes
├── quickstart.md        # Phase 1 — run/validate guide
└── contracts/
    ├── extraction-payload.md   # PageExtractPayload delta + backend consumption
    └── learned-selectors.md    # chrome.storage.local contract for picker learning
```

### Source Code (repository root)

```text
extension/
├── lib/
│   ├── pageExtractor.ts        # MODIFIED — async readiness loop, scorer, microdata
│   ├── selectorPath.ts         # NEW — pick → stable selector (pure, jsdom-testable)
│   └── pasteIdentity.ts        # NEW — normalize + sha256 → paste:<hex>
├── services/
│   ├── jobFlow.ts              # MODIFIED — cancellation generation, learned lookup
│   ├── learnedSelectors.ts     # NEW — storage.local CRUD, LRU, miss counting
│   └── pickerService.ts        # NEW — inject overlay, await pick
├── entrypoints/
│   └── picker/                 # NEW — injected overlay (hover highlight, Escape)
├── components/JobPanel/
│   ├── ThisPageTab.tsx         # MODIFIED — paste entry, picker entry, learned badge
│   └── PastePanel.tsx          # NEW
├── entrypoints/options/        # MODIFIED — clear learned host(s)
├── scripts/                    # NEW (already built)
│   ├── corpusProbe.ts          # shared page-context probe
│   ├── captureCorpus.ts        # capture fixtures from live boards
│   └── baselineReport.ts       # print the baseline table
└── tests/
    ├── fixtures/pages/         # NEW (already captured) — 6 fixtures + README
    ├── e2e/hydration/          # NEW — synthetic delayed-hydration pages
    └── unit/                   # MODIFIED + NEW

functions/src/
├── services/
│   └── jobExtractionOrchestrator.ts   # MODIFIED — prompt + THE EVIDENCE HAYSTACK
└── models/
    ├── job.ts                  # MODIFIED — structuredSources on the extract payload
    └── user.ts                 # MODIFIED — PostingSource gains "paste"

shared/types/
└── job.ts                      # MODIFIED — PageExtractPayload.structuredSources
```

**Structure Decision**: No new package. The feature is concentrated in
`extension/lib/pageExtractor.ts` (the serialized extractor) with three small new
extension modules pulled out specifically so they are testable *outside* the
serialized function — selector generation, paste identity, and learned-selector
storage are pure logic and belong in jsdom unit tests, while everything inside
`extractPage` must be verified in real Chromium (research R9).

## Phased Delivery

Each story is independently shippable and independently measurable.

| Phase | Story | Ships | Measured by |
|---|---|---|---|
| 1 | Readiness (P1) | Async extractor, corrected predicate, 6 s budget, "still loading" error copy | SC-001, SC-003; synthetic hydration fixtures |
| 2 | Signals + containers (P2) | Scorer, microdata harvest, `structuredSources` wire field, **evidence haystack fix** | SC-002; Playwright over corpus |
| 3 | Paste (P3) | `PostingSource: "paste"`, panel entry | SC-007 |
| 4 | Picker + learned hosts (P4) | Overlay, selector generation, storage, options controls | SC-008, SC-009 |

Phase 2 must not ship without the evidence-haystack change in the same commit —
they are a single semantic unit, and splitting them ships a silent regression.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Evidence haystack missed** → Story 2 downgrades arrangements it should improve | High if not tested first | Write the failing test before touching the prompt (research R5); Phase 2 is one commit |
| Scorer regresses `greenhouse-discord` / `phenom-intuit`, which pass today | Medium | Both are explicit FR-013 regression fixtures; scorer treats the semantic container as a candidate so it can still win |
| Stability window adds perceptible latency to the 5 fast fixtures | Medium | Fast path (150 ms) for complete-and-unmutated documents; QG-4 must benchmark a fast fixture, not just Phenom |
| Learned selector matches a *different* posting's region on a shared template | Medium | Validate on a second posting from the same board (research R7); 3-miss retirement |
| Corpus rots as postings expire | Certain over time | Capture resolves from listing pages, not hard-coded URLs; stub-posting rejection built in |
| jsdom coverage masks untested extractor paths | Already true today | Relocate assertions to Playwright; state the QG-2 caveat rather than chase the number |

## Deviations from the standard workflow

Recorded because they will otherwise look like mistakes:

1. **The corpus was built before planning, not during implementation.** Spec
   SC-002/SC-003 are defined as deltas against a baseline; without the baseline
   they were unmeasurable, and three spec assumptions turned out to be wrong.
   The capture tooling (`extension/scripts/`) and fixtures are already committed
   as part of this feature's groundwork.

2. **`.specify/scripts/powershell/setup-plan.ps1` resolved to `004-web-companion-app`,
   not this feature.** `.specify/feature.json` pins `feature_directory` to 004 and
   the working branch is `ci/split-release-jobs`, so the script would have
   overwritten 004's plan. This plan was written to `specs/005-resilient-extraction/`
   directly. **Before `/speckit-tasks`**, either create the `005-resilient-extraction`
   branch or repoint `.specify/feature.json` — otherwise the same misresolution
   will silently target 004 again.

3. **Spec FR-009 is deliberately unimplemented.** It is evidence-gated and the
   evidence was not found (research R4). It stays in the spec as a documented
   negative result so the idea is not re-proposed from folklore.
