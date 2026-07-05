# Research: Job Posting Analyzer

**Feature**: `001-job-posting-analyzer` | **Date**: 2026-07-04

All Technical Context entries were resolvable from the existing codebase and the pre-existing draft plan (`docs/jobposting/plan.md`); no NEEDS CLARIFICATION markers remained after spec adoption. This document records the load-bearing technical decisions, their rationale, and the alternatives considered.

## R1 — Page extraction mechanism: `activeTab` + `chrome.scripting.executeScript`

**Decision**: Extract page content by injecting a self-contained function via `chrome.scripting.executeScript({ func })` on user gesture, gated by the `activeTab` + `scripting` permissions.

**Rationale**: `activeTab` grants temporary access to the current tab only after a user gesture — which exactly matches FR-002 (extraction only on explicit user action, never passive crawling). It requires no host permissions in the manifest, so the extension avoids the "read and change all your data on all websites" install warning and Chrome Web Store review friction. The injected function runs in the page's DOM context, so JSON-LD `<script>` tags and rendered text (including SPA-rendered content) are both reachable.

**Alternatives considered**:
- **Registered content script with `<all_urls>`**: always injected, works without gesture — rejected: broad host permission warning, passive presence on every page contradicts FR-002 and privacy posture.
- **`chrome.tabs` + `fetch` of the page URL from the background**: rejected: misses SPA-rendered content entirely (LinkedIn/Indeed render client-side), loses cookie/auth context for postings behind login.
- **Optional host permissions requested at runtime**: rejected: extra permission prompt per site with no benefit over `activeTab` for a user-triggered flow.

## R2 — Main-content text extraction: heuristic, no Readability

**Decision**: A small self-contained heuristic — prefer `<main>`, `[role=main]`, `article`, then the largest text-density block; strip `nav`/`header`/`footer`/`aside`/`script`/`style`; fall back to `document.body.innerText`; cap at 40,000 characters.

**Rationale**: The injected function must be dependency-free (serialized `func` cannot import). The downstream LLM tolerates noisy input well, so precision-perfect boilerplate removal buys little; the 40k cap (vs the existing 80k video transcript cap) reflects that postings are short. Zero new dependencies keeps the extension bundle and review surface unchanged.

**Alternatives considered**:
- **Mozilla Readability**: best-in-class article extraction — rejected for v1: cannot be used inside a serialized injected function without bundling gymnastics; adds ~85 kB; revisit only if eval-set accuracy shows extraction (not model) failures.
- **Sending full `document.body.innerHTML`**: rejected: token waste, leaks more page content than needed, hurts the 8 s P50 target.

## R3 — Response transport: single non-streaming structured completion

**Decision**: `POST /api/analyze-job` returns one JSON body; no SSE.

**Rationale**: The result is form-shaped (a fixed set of fields rendered at once), not prose read incrementally. Streaming partial JSON adds client parsing complexity for zero perceived-latency benefit; the panel shows a progress indicator instead (constitution Principle III). The existing SSE plumbing remains exclusive to chat.

**Alternatives considered**:
- **SSE like `/api/chat`**: rejected: partial structured JSON is not renderable; complexity without UX gain.

## R4 — Structured output + evidence-substring validation

**Decision**: Use Azure OpenAI `response_format: json_schema` with `strict: true` against an authoritative schema (see [contracts/analyze-job.md](./contracts/analyze-job.md)); after parsing, the server verifies `arrangementEvidence` is a whitespace-normalized substring of the model input, downgrading to `unspecified`/`none` on mismatch.

**Rationale**: Strict schema mode structurally guarantees parseable, complete responses (all fields present, enums valid), eliminating a whole class of client-side defensive code. The substring check is the anti-hallucination backstop for the spec's hardest guarantee — "zero cases of a stated arrangement being contradicted" and mandatory verbatim evidence (FR-004/FR-005): a fabricated quote becomes structurally impossible to surface.

**Alternatives considered**:
- **Prompt-only JSON ("respond with JSON")**: rejected: parse failures and missing fields under load; `gpt-4o-mini` needs the schema constraint.
- **Function-calling/tools mode**: equivalent guarantee, more ceremony for a single-shot extraction — rejected for simplicity.
- **Trusting evidence quotes without validation**: rejected: quote hallucination is a known failure mode and directly violates SC-001's zero-contradiction clause.

## R5 — Saved-jobs storage: `chrome.storage.local` behind a `JobRepository` interface

**Decision**: One `storage.local` key per job (`job:{sha256(canonicalUrl)}`) plus a `job:index` key for listing; all access through a `JobRepository` interface; records carry `schemaVersion` from day one.

**Rationale**: `storage.local` survives browser restarts (FR-009), needs no new permission (already granted), and its ~10 MB quota comfortably holds the 1,000-job soft cap. Per-job keys keep writes small (status/notes updates rewrite one record, not the library). The interface isolates the UI from the store so the planned Azure Table Storage swap (spec Out of Scope, explicitly design-for) touches only the implementation.

**Alternatives considered**:
- **IndexedDB**: larger quota and real queries — rejected: overkill at this scale, verbose API, harder to mirror later with Table Storage semantics.
- **`chrome.storage.sync`**: free cross-device sync — rejected: 100 kB total / 8 kB per-item quotas are far too small for JobAnalysis snapshots.
- **Single blob key holding all jobs**: rejected: every note keystroke would rewrite the whole library; race-prone.

## R6 — URL canonicalization: strip-list + table-driven board normalizers

**Decision**: Strip known tracking params (`utm_*`, `ref`, `refid`, `trk`, `trackingid`, `gh_src`, `lever-origin`, `src`, `source`, `mkt_tok`, `fbclid`, `gclid`), apply per-board normalizers (LinkedIn `/jobs/view/{id}`, Indeed `viewjob?jk={id}`, Greenhouse/Lever/Ashby path passthrough), lowercase host, drop trailing slash and fragment; SHA-256 of the result is the dedup/storage key.

**Rationale**: FR-010's dedup requirement fails exactly on campaign-link noise; a table-driven normalizer list is trivially extensible per board and trivially unit-testable (fixture table per board). Hashing gives fixed-length storage keys.

**Alternatives considered**:
- **Whitelist approach (keep only known-significant params)**: safer dedup but risks merging genuinely distinct postings on unknown boards — rejected as the default; board table can adopt whitelisting per-host where proven.
- **Fuzzy content-based dedup (title+company match)**: rejected for v1: false-merge risk across reposts; URL identity is predictable and explainable.

## R7 — Model & deployment: reuse `gpt-4o-mini`, env-var override

**Decision**: Reuse the existing Azure OpenAI deployment and `AZURE_OPENAI_*` config; add optional `AZURE_OPENAI_JOB_DEPLOYMENT` to override the model for this endpoint only.

**Rationale**: Zero new infrastructure or secrets; `gpt-4o-mini` supports strict structured outputs and is cheap enough for per-page analysis. The override turns a potential model-quality problem (dense postings misread) into a config change, measured by the eval harness rather than guessed.

**Alternatives considered**:
- **Larger model by default**: rejected until the eval set proves `gpt-4o-mini` misses the ≥ 90% bar; cost discipline first.
- **Client-side heuristic extraction only (no LLM)**: rejected: arrangement inference from prose ("3 days in office") is precisely the LLM-shaped part of the problem.

## R8 — Analysis cache: `chrome.storage.session`, LRU 200 / 14-day TTL

**Decision**: Cache `JobAnalysis` per canonical URL in `chrome.storage.session` with LRU eviction at 200 entries and a 14-day TTL, mirroring the existing `sessionCache.ts` pattern.

**Rationale**: Satisfies FR-012 (no repeat backend calls within cache lifetime) with the same pattern already proven for video analyses — consistent codebase idiom (constitution Principle I). Session scope means a browser restart clears the cache, which is acceptable because *saved* jobs (the durable path) live in `storage.local` and are checked first.

**Alternatives considered**:
- **`storage.local` cache**: survives restarts but requires manual GC and competes with the saved-jobs quota — rejected: revisit-after-restart of an unsaved posting is cheap to re-analyze and rare.
- **In-memory (background service worker) cache**: rejected: MV3 service workers are evicted aggressively; cache would rarely survive minutes.

## R9 — Options page for candidate profile

**Decision**: New WXT options entrypoint (`entrypoints/options/`) hosting a React editor for a free-text profile (≤ 4,000 chars) plus optional structured dealbreakers, persisted via `profileStorage.ts` to a single `storage.local` key, transmitted only within analysis requests (FR-007).

**Rationale**: The options surface is the Chrome-conventional home for rarely-edited configuration; keeping the profile out of the side panel keeps the analysis flow uncluttered. Single-key storage suffices for one small document.

**Alternatives considered**:
- **Profile editor inside the side panel**: rejected: crowds the P1 flow; options page is discoverable via the fit-score empty-state link.
- **Server-side profile storage**: rejected: unnecessary PII persistence server-side; contradicts local-first posture and adds auth scope.
