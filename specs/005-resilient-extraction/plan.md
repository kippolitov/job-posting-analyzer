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
4. **Page scoping with learned hosts (P4)** — two ways to narrow the current page
   by hand, an element picker and an "Analyze selection" context-menu item, both
   feeding one learning path. These scope *the current page*: their results carry
   the page's canonical URL and supersede its stored analysis, which is what
   separates them from paste and why they live on "This Page" rather than behind
   the paste button.

The backend delta is small but contains the feature's most dangerous line:
`validateEvidence`'s substring haystack must grow to include the new structured
sources, or Story 2 will *reduce* arrangement confidence on exactly the pages it
improves. No new Azure resources, no new runtime dependencies, no new host
permissions — one new API permission (`contextMenus`), which grants no site
access.

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
*next* toolbar click. `contextMenus` is added as an API permission (spec FR-036);
its `onClicked` handler carries its own `activeTab` grant, which is what makes
"Analyze selection" work without the panel being open. Learned selectors never
leave the browser (spec FR-033).

The learned selector reaches the extractor as an **argument**, not by reading
storage from inside it: `jobFlow` calls `learnedSelectors.get(host)` and passes
the result via `chrome.scripting.executeScript({ func: extractPage, args: [{
learnedSelector }] })` (the call site at `jobFlow.ts:231` passes no `args`
today). `extractPage` therefore stays free of `chrome.*` and of a second copy of
the store's semantics, and `touch` / `recordMiss` stay in `learnedSelectors.ts`
where they are testable in jsdom.

**Scale/Scope**: 6 corpus fixtures (2 platform gaps accepted: iCIMS, and
SmartRecruiters beyond a stub). ~200 learned hosts per user. One new panel
surface (paste composer), one new in-page overlay (picker), one context-menu item.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Derived from `.specify/memory/constitution.md` v1.2.0:

| Principle | Gate | Status |
|-----------|------|--------|
| **I. Code Quality** | Meaningful naming, no dead code, single responsibility, review before merge. | ✅ PASS — the scorer, readiness loop, and picker are separable units. One knowing exception: `extension/scripts/corpusProbe.ts` **duplicates** the extractor's container logic as a string, because the extractor is serialized and cannot be imported by a Node script. Confined to one file, documented in-file, and load-bearing only for measurement. |
| **II. Testing Standards** | Test-first; ≥80% coverage on changed modules; real fixtures not hollow mocks; E2E for every P1 journey. | ✅ PASS — the corpus is real captured pages, not mocks; the readiness fixture is synthetic **by necessity** (a saved DOM is ready by construction), which is the honest form of the "recorded fixture" rule here. P1 (readiness) gets an E2E path. See the QG-2 note below. |
| **III. UX Consistency** | Progress indicator > 300 ms; plain-language errors + next action; stable terminology; WCAG 2.1 AA. | ✅ PASS — the existing "Analyzing page…" spinner already covers the readiness wait; thin-content copy gains a "still loading" variant with a retry; region selection needs a **keyboard path in the panel**, not just Escape-to-dismiss on the overlay — the panel and page are separate browsing contexts, so an in-page overlay cannot take focus from a panel control, and a pointer-only picker fails WCAG 2.1.1 outright (spec FR-024a/FR-024b, SC-011); the paste button must not sit inside `role="tablist"` (spec FR-017a); "Analyze selection" must refuse a too-short selection with a reason rather than analyzing a fragment. **Watch item**: the thin-content error card now hosts Retry, "Analyze a region", and a paste shortcut — three actions in one red box is a QG-3 review target, and may argue for demoting one to a quieter link. |
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

**Development Workflow**: Feature branch `005-resilient-extraction` (created; the
spec, plan, and corpus are committed on it). No dependency additions — one
manifest permission addition, noted above. Docs updated in-PR.

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
├── wxt.config.ts               # MODIFIED — add the "contextMenus" permission
├── lib/
│   ├── pageExtractor.ts        # MODIFIED — async readiness loop, scorer, microdata
│   ├── selectorPath.ts         # NEW — pick → stable selector (pure, jsdom-testable)
│   └── pasteIdentity.ts        # NEW — normalize + sha256 → paste:<hex>
├── services/
│   ├── jobFlow.ts              # MODIFIED — cancellation generation, learned lookup,
│                               #   bypassCache on every scoped analysis (see Risks)
│   ├── learnedSelectors.ts     # NEW — storage.local CRUD, LRU, miss counting
│   ├── pickerService.ts        # NEW — inject overlay, await pick
│   └── selectionService.ts     # NEW — read the LIVE selection via executeScript,
│                               #   never the context-menu payload's own copy
│                               #   (truncated); derive the range's common ancestor
├── entrypoints/
│   ├── background.ts           # MODIFIED — contextMenus registration + onClicked
│   └── picker/                 # NEW — injected overlay (hover highlight, Escape)
├── components/shared/
│   └── TabBar.tsx              # MODIFIED — separate the visual header row from the
│                               #   role="tablist" element so a non-tab action button
│                               #   can sit beside the tabs without being announced as
│                               #   one (spec FR-017a). Sole other caller is its own
│                               #   unit test, so the refactor is contained.
├── components/JobPanel/
│   ├── JobPanel.tsx            # MODIFIED — header row, composer open state, draft state
│   ├── ThisPageTab.tsx         # MODIFIED — picker entry, learned badge, paste shortcut
│   └── PasteComposer.tsx       # NEW — opened by the header button (spec FR-017)
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
| 3 | Paste (P3) | `PostingSource: "paste"`, persistent **header action button** + paste composer (FR-017a: a sibling of the tablist, never a tab), draft retention | SC-007 |
| 4 | Page scoping + learned hosts (P4) | Picker overlay, `contextMenus` + selection reader, shared selector generation, storage, options controls | SC-008, SC-008a, SC-008b, SC-009 |

Phase 2 must not ship without the evidence-haystack change in the same commit —
they are a single semantic unit, and splitting them ships a silent regression.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Evidence haystack missed** → Story 2 downgrades arrangements it should improve | High if not tested first | Write the failing test before touching the prompt (research R5); Phase 2 is one commit |
| Scorer regresses `greenhouse-discord` / `phenom-intuit`, which pass today | Medium | Both are explicit FR-013 regression fixtures; scorer treats the semantic container as a candidate so it can still win |
| Stability window adds perceptible latency to the 5 fast fixtures | Medium | Fast path (150 ms) for complete-and-unmutated documents; QG-4 must benchmark a fast fixture, not just Phenom |
| **Scoped analysis served from cache** → the user's correction appears to do nothing | **High if not tested** | `jobFlow.ts` looks up the library and session cache by canonical URL *before* analyzing; a scoped region resolves to the same URL. Every scoped analysis must set `bypassCache` (spec FR-026a, SC-008a). Silent and maddening to diagnose |
| Learned selector matches a *different* posting's region on a shared template | Medium | Validate on a second posting from the same board (research R7); 3-miss retirement |
| **Pointer-only picker ships** → WCAG 2.1.1 failure on a core function | **High if not specified** | The panel/page focus barrier makes this the *default* outcome, not an oversight: adding key handlers to the overlay does not help, because focus never reaches it. FR-024a puts the keyboard path in the panel; T064a is a pointer-event-free test |
| Selection truncated by the context-menu payload → partial posting analyzed | Medium | Never read the payload's own selection text; `executeScript` the live `window.getSelection()` (spec FR-023b, SC-008b) |
| One-off selection silently teaches a bad host-wide selector | Medium | Learning is offered after success, never implied by the act of scoping (spec FR-026b) |
| `contextMenus` permission slows Web Store review | Low | API permission, no site access; no host permissions added |
| Corpus rots as postings expire | Certain over time | Capture resolves from listing pages, not hard-coded URLs; stub-posting rejection built in |
| jsdom coverage masks untested extractor paths | Already true today | Relocate assertions to Playwright; state the QG-2 caveat rather than chase the number |

## Deviations from the standard workflow

Recorded because they will otherwise look like mistakes:

1. **The corpus was built before planning, not during implementation.** Spec
   SC-002/SC-003 are defined as deltas against a baseline; without the baseline
   they were unmeasurable, and three spec assumptions turned out to be wrong.
   The capture tooling (`extension/scripts/`) and fixtures are already committed
   as part of this feature's groundwork.

2. **`.specify/scripts/powershell/setup-plan.ps1` originally resolved to
   `004-web-companion-app`, not this feature.** `.specify/feature.json` pinned
   `feature_directory` to 004 and the working branch was `ci/split-release-jobs`,
   so the script would have overwritten 004's plan; this plan was therefore
   written to `specs/005-resilient-extraction/` directly. **Since resolved**: the
   `005-resilient-extraction` branch exists and the pin has been repointed to
   `specs/005-resilient-extraction`, so `/speckit-tasks` resolves correctly.

3. **Spec FR-009 is deliberately unimplemented.** It is evidence-gated and the
   evidence was not found (research R4). It stays in the spec as a documented
   negative result so the idea is not re-proposed from folklore.
