# Implementation Plan: Job Posting Analyzer

**Branch**: `001-job-posting-analyzer` | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-job-posting-analyzer/spec.md` (technical approach adopted from the pre-existing draft plan `docs/jobposting/plan.md`)

## Summary

Add a second operating mode to the existing Chrome extension: when the side panel opens on any non-YouTube `http(s)` page, the page is analyzed as a potential job posting and structured, decision-relevant fields (work arrangement + evidence, salary, seniority, tech stack, fit score) are rendered, with a durable saved-postings library on top. Technically: on-demand page extraction via `chrome.scripting.executeScript` under the `activeTab` permission (no broad host permissions), a new non-streaming Azure Functions endpoint `POST /api/analyze-job` using Azure OpenAI structured outputs (`json_schema`, `strict: true`), `chrome.storage.local` behind a `JobRepository` interface for saved jobs, `chrome.storage.session` LRU cache for analyses, and a new options page for the candidate profile. The YouTube flow is untouched; mode selection happens in `background.ts` by tab URL.

## Technical Context

**Language/Version**: TypeScript 5 (extension + backend), Node 20 (Azure Functions v4)

**Primary Dependencies**: WXT (MV3), React 18, Tailwind CSS (extension); Azure Functions v4, Azure OpenAI `gpt-4o-mini` with structured outputs (backend). No new third-party runtime dependencies planned (no Readability in v1).

**Storage**: `chrome.storage.local` — saved jobs (one key per job + index key) and candidate profile; `chrome.storage.session` — analysis cache (LRU 200 entries, 14-day TTL). Repository interface designed for a future Azure Table Storage swap.

**Testing**: Vitest + jsdom (extension unit), msw (contract tests), Vitest (backend unit), Playwright (E2E, existing config), scripted eval harness `npm run eval:postings` against a 50-posting fixture set (on-demand, not CI).

**Target Platform**: Chrome MV3 (side panel + options page); Azure Functions backend (existing deployment pipeline).

**Project Type**: Web extension + serverless backend (existing two-package repo: `extension/`, `functions/`).

**Performance Goals**: Side-panel open → rendered analysis ≤ 8 s P50 (SC-003); revisit path renders with zero backend calls (SC-006); UI remains interactive during analysis.

**Constraints**: No AI provider keys in the extension (FR-015); no passive background crawling — extraction only on user gesture (FR-002); page text capped at 40,000 chars before transmission; extension package gains only `activeTab` + `scripting` permissions (no `<all_urls>`); zero YouTube-flow regressions (FR-016).

**Scale/Scope**: Single-user local library, soft cap 1,000 saved jobs (~10 MB `storage.local` quota); ~9 new extension modules, 1 new options entrypoint, 1 new backend endpoint + orchestrator; 4-PR rollout.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Assessment |
|------|-----------|------------|
| ✅ PASS | I. Code Quality | New code is split into single-responsibility modules (`pageExtractor`, `canonicalUrl`, `jobStorage`, `jobAnalysisClient`, `jobAnalysisCache`, `profileStorage`, orchestrator); storage is behind an interface; 4-PR rollout keeps reviews small. No dead code introduced; existing modules reused where they fit (`sessionCache.ts` pattern). |
| ✅ PASS | II. Testing Standards | Test-first per module (unit tables for `canonicalUrl`, jsdom fixtures for `pageExtractor`, round-trip tests for `jobStorage`); msw contract tests for the client (recorded-fixture style, no hollow mocks); backend orchestrator unit tests incl. the evidence-substring downgrade path; Playwright E2E covers the P1 journey (open panel on posting → rendered analysis); ≥ 80% coverage on changed modules enforced by existing CI/codecov. Exception (documented): the 50-posting accuracy eval runs on-demand, not in CI, due to model-call cost — see Complexity Tracking. |
| ✅ PASS | III. UX Consistency | Analysis shows a progress indicator with cancel affordance (> 300 ms operation); every error state in the Error Handling table has plain-language copy + a next action (Retry, Analyze anyway, export/prune); stable vocabulary: "analysis", "posting", "arrangement", "fit score"; all interactive elements (status select, filters, save/delete) get accessible labels; badge colors meet WCAG 2.1 AA contrast. |
| ✅ PASS | IV. Performance | Analysis is a single non-streaming completion, asynchronous — panel stays interactive; ≤ 8 s P50 target is well under the 30 s constitutional ceiling; cache + revisit detection eliminate repeat latency; no new memory-heavy dependencies (no Readability). The existing YouTube latency benchmark is unaffected (no shared code paths changed). |

**Post-Phase-1 re-check**: PASS — design artifacts (data model, contract, quickstart) introduce no new violations; the single documented exception (eval cost) stands.

## Project Structure

### Documentation (this feature)

```text
specs/001-job-posting-analyzer/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── analyze-job.md   # POST /api/analyze-job request/response contract + JSON schema
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
extension/
├── entrypoints/
│   ├── background.ts                # MODIFIED — tab-URL mode routing, job analysis orchestration
│   ├── options/                     # NEW — candidate profile editor (React)
│   └── sidepanel/                   # MODIFIED — mode switch: VideoKnowledgePanel | JobPanel
├── components/
│   └── JobPanel/                    # NEW
│       ├── JobPanel.tsx             # tabs: ThisPage | Saved
│       ├── ThisPageTab.tsx          # analysis result, evidence quotes, fit score, Save
│       ├── SavedTab.tsx             # filterable/sortable saved list
│       ├── SavedJobRow.tsx          # status select, notes, open, delete
│       ├── ArrangementBadge.tsx     # remote/hybrid(+days)/onsite/unspecified
│       └── FitScore.tsx             # score + rationale, "configure profile" empty state
├── lib/                             # NEW directory
│   ├── pageExtractor.ts             # NEW — injected function: JSON-LD scan + main-text heuristic
│   └── canonicalUrl.ts              # NEW — tracking-param strip + board-specific rules
├── services/
│   ├── jobAnalysisClient.ts         # NEW — POST /api/analyze-job
│   ├── jobAnalysisCache.ts          # NEW — storage.session LRU keyed by canonical URL
│   ├── jobStorage.ts                # NEW — SavedJob repository (interface + local impl)
│   └── profileStorage.ts            # NEW — CandidateProfile in storage.local
├── types/
│   └── job.ts                       # NEW — JobAnalysis, SavedJob, PageExtract, CandidateProfile
└── tests/                           # NEW unit/contract tests alongside existing suites

functions/src/
├── analyze-job/
│   └── index.ts                     # NEW — HTTP trigger, function-key auth (same as /api/analyze)
├── services/
│   └── jobExtractionOrchestrator.ts # NEW — prompt build + structured output call + evidence validation
└── (analyze/, chat/, existing services untouched)

functions/test/fixtures/postings/    # NEW — 50 redacted posting texts + expected labels (eval harness)
```

**Structure Decision**: Keep the existing two-package layout (`extension/` + `functions/`). All job-analyzer extension code lives in new files (plus two modified entrypoints); all backend code is a new folder picked up by the existing build. This satisfies the "Explicitly Not Changing" list below.

## Architecture

```
Any web page                  Extension                         Azure backend
────────────                  ─────────                         ─────────────
User opens side panel ──► background.ts inspects tab URL
                              │
                ┌─────────────┴─────────────┐
                │ YouTube watch page?       │
                ▼                           ▼
        Existing video flow          Job Analyzer flow
        (unchanged)                        │
                              chrome.scripting.executeScript
                              (activeTab) injects extractor
                                           │
                              PageExtract {canonicalUrl,
                                jsonLd[], mainText, title}
                                           │
                              jobStorage.get(canonicalUrl)? ──► render saved
                              jobAnalysisCache hit?         ──► render cached
                                           │ miss
                                           ▼
                              POST /api/analyze-job  ─────────► analyze-job/index.ts
                                {extract, profile}              │ jsonLd merge +
                                           │                    │ structured output
                              JobAnalysis JSON ◄────────────────┘ (JSON schema mode)
                                           │
                              Side panel renders JobPanel
                              [This Page] [Saved]
                                           │ Save
                              jobStorage.save() → chrome.storage.local
```

**Key decision**: extraction runs via `chrome.scripting.executeScript` on user gesture with the `activeTab` permission, instead of an `<all_urls>` registered content script. Zero broad host permissions, no injection until the user acts, and no manifest warning wall. (Rationale in [research.md](./research.md) R1.)

### Manifest / WXT config

- Add permissions: `activeTab`, `scripting` (`storage` already present); keep existing YouTube host permissions.
- Register options page entrypoint (`entrypoints/options/`) for the candidate profile editor.
- Side panel enabled for all tabs; `background.ts` decides which mode to render via a message to the panel.

### Page extraction (`lib/pageExtractor.ts`)

Runs inside the page via `chrome.scripting.executeScript({ func })` — must be self-contained (no imports). Steps:

1. Collect every `<script type="application/ld+json">`, parse defensively (arrays, `@graph`), filter to `@type` including `JobPosting`.
2. Main-text heuristic: prefer `<main>`, `[role=main]`, `article`, then largest text-density block; fall back to `document.body.innerText`. Strip `nav`, `header`, `footer`, `aside`, `script`, `style`.
3. Cap text at 40,000 characters (job postings are short; the 80k video cap is unnecessary here).
4. Return `PageExtract { url, title, jsonLd, mainText, extractedAt }`.

No Readability dependency in v1 — the heuristic plus the LLM's noise tolerance is sufficient; revisit if extraction quality on messy boards demands it (research.md R2).

### Canonical URL (`lib/canonicalUrl.ts`)

- Strip query params matching: `utm_*`, `ref`, `refid`, `trk`, `trackingid`, `gh_src`, `lever-origin`, `src`, `source`, `mkt_tok`, `fbclid`, `gclid`.
- Board-specific normalizers (table-driven): LinkedIn `…/jobs/view/{id}` → keep id only; Indeed `viewjob?jk={id}` → keep `jk`; Greenhouse/Lever/Ashby paths kept as-is minus params.
- Lowercase host, drop trailing slash, drop fragment. SHA-256 of the result = storage key.

### Storage design

`jobStorage.ts` exposes an interface so the backing store can later swap to an Azure Table Storage client without touching UI code (see [data-model.md](./data-model.md) for entities):

```ts
interface JobRepository {
  get(canonicalUrl: string): Promise<SavedJob | null>;
  list(filter?: { arrangement?: Arrangement; status?: JobStatus }): Promise<SavedJob[]>;
  save(job: SavedJob): Promise<void>;
  update(key: string, patch: Partial<SavedJob>): Promise<void>;
  remove(key: string): Promise<void>;
  exportAll(): Promise<string>; // JSON blob for FR-017
}
```

- v1 implementation: `chrome.storage.local`, one key per job (`job:{sha256}`) plus an index key (`job:index`) for cheap listing. 10 MB quota ≈ thousands of postings; enforce soft cap at 1,000 with oldest-`archived` eviction prompt.
- `jobAnalysisCache`: `chrome.storage.session`, LRU 200 entries / 14-day TTL, mirroring the existing `sessionCache.ts` pattern.
- `profileStorage`: single `storage.local` key; profile text ≤ 4,000 chars.

### Mode routing

`background.ts` on side-panel open / tab activation: if `url.host` ends with `youtube.com` and path is `/watch` → post `{mode: 'video'}` to panel (existing flow untouched); else → `{mode: 'job', tabId}`. The panel root becomes a two-branch switch; **no shared state** between modes beyond the panel shell.

## Backend Changes (`functions/`)

### New endpoint: `POST /api/analyze-job`

HTTP trigger with function-key auth (same as `/api/analyze`). Non-streaming — a single structured completion; SSE is unnecessary for a form-shaped result (research.md R3). Request/response contract and the authoritative JSON schema live in [contracts/analyze-job.md](./contracts/analyze-job.md).

### Prompt strategy (`jobExtractionOrchestrator.ts`)

- System prompt: extraction rules — JSON-LD values are trusted ground truth for title/company/salary unless the body contradicts them; **never invent** arrangement or day counts; `unspecified` is the correct answer when unstated; evidence quotes must be verbatim substrings of the input; `jobLocationType: "TELECOMMUTE"` in JSON-LD ⇒ `remote`/`explicit`.
- Fit scoring (only when `profile` present): compare against profile; dealbreaker match caps score at ≤ 20 and names the dealbreaker in the rationale.
- User message: serialized JSON-LD (if any) + `mainText`.
- Server-side validation after parse: if `arrangement != unspecified` and `arrangementEvidence` is not a substring of the input (whitespace-normalized), downgrade to `unspecified`/`none` and log — the anti-hallucination backstop (research.md R4).
- Config: reuse `AZURE_OPENAI_*` settings; optional `AZURE_OPENAI_JOB_DEPLOYMENT` override, defaulting to the existing deployment.

## Error Handling

| Failure | Behavior |
| --- | --- |
| No JSON-LD, thin text (< 300 chars) | Skip backend call; panel: "Not enough page content to analyze." |
| Backend 4xx/5xx or timeout (30 s) | Show JSON-LD-derived fields client-side (title/company/salary/remote flag) + error banner + Retry (spec US1 scenario 6) |
| Schema parse failure server-side | One retry with repair instruction, then 502 with typed error body |
| `isJobPosting: false` | Info state + "Analyze anyway" (forces `assumeJobPosting: true` flag in request) |
| `storage.local` quota exceeded | Save fails with actionable message; offer export + prune archived |

## Testing Strategy

- **Unit (Vitest)**: `canonicalUrl` table tests (LinkedIn/Indeed/Greenhouse/Lever fixtures); `pageExtractor` against fixture DOMs (jsdom) — JSON-LD variants: single object, array, `@graph`, malformed JSON; `jobStorage` round-trip + index integrity + filter/sort.
- **Contract (msw)**: `jobAnalysisClient` happy path, timeout, 4xx, schema-invalid response.
- **Backend unit**: orchestrator prompt assembly; evidence-substring validation (hallucinated-quote downgrade path); JSON-LD contradiction case.
- **E2E (Playwright)**: P1 journey — open side panel on a fixture posting page → analysis renders with arrangement badge and evidence (constitution Principle II: E2E for every P1 journey).
- **Validation set**: `functions/test/fixtures/postings/` — 50 real posting texts (redacted), each with expected `arrangement`/`daysInOffice`; a scripted eval (`npm run eval:postings`) reports accuracy against the spec's ≥ 90% success criterion (SC-001/SC-002). Run manually/on-demand, not in CI (cost — see Complexity Tracking).
- **Regression**: existing YouTube suites must pass untouched (FR-016, SC-005).

## Rollout

1. **PR 1** — types, `canonicalUrl`, `jobStorage`, options page + profile storage (no UI surface change).
2. **PR 2** — backend `/api/analyze-job` + orchestrator + eval harness.
3. **PR 3** — extraction injection, mode routing, JobPanel ThisPage tab.
4. **PR 4** — Saved tab, revisit detection, export.
5. Version bump + tag per existing release process; extension package now requests `activeTab`/`scripting` (release notes must call this out).

## Risks & Mitigations

- **SPA content staleness** (LinkedIn swaps postings in place): extraction is tied to explicit user action; the ThisPage tab shows the extracted title so a mismatch is visible; Re-analyze is one click.
- **Evidence-quote hallucination**: substring validation backstop makes fabricated quotes structurally impossible to surface.
- **gpt-4o-mini misreading dense postings**: eval harness quantifies it; deployment override env var allows a model upgrade without code change.
- **Future Table Storage migration**: `JobRepository` interface + `exportAll` keep the path open; SavedJob records carry a `schemaVersion` field from day one.

## Explicitly Not Changing

- `/api/analyze`, `/api/chat`, all Video Knowledge Panel components, chat cache, session cache semantics for video data, CI/CD workflows (beyond the new function folder being picked up by the existing build).

## Complexity Tracking

> Constitution Check passed with one documented exception, justified here per the Quality Gates exception process.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 50-posting accuracy eval (QG-2 adjacent) runs on-demand, not in CI | Each eval run makes 50 live model calls; running per-PR is costly and rate-limited, and accuracy drift is a model property, not a code property | Running it in CI on every PR would add cost and flakiness without catching code regressions; deterministic unit/contract tests remain in CI, and the eval is required before release tagging |
