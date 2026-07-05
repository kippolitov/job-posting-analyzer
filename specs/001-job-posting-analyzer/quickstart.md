# Quickstart: Job Posting Analyzer — Validation Guide

**Feature**: `001-job-posting-analyzer` | **Date**: 2026-07-04

Runnable scenarios proving the feature end-to-end. Contracts: [contracts/analyze-job.md](./contracts/analyze-job.md); entities: [data-model.md](./data-model.md).

## Prerequisites

- Node 20, npm
- Azure Functions Core Tools v4 (`func`) for local backend
- `functions/local.settings.json` with working `AZURE_OPENAI_*` values (same as existing video flow; optional `AZURE_OPENAI_JOB_DEPLOYMENT` override)
- Chrome (extension loads unpacked via WXT dev)

## Setup

```bash
# Backend (terminal 1)
cd functions && npm install && npm start          # serves http://localhost:7071

# Extension (terminal 2)
cd extension && npm install && npm run dev        # WXT builds + opens Chrome with the extension
```

## Scenario 1 — P1: Analyze a job posting (US1)

1. Navigate to any real job posting (e.g., a LinkedIn `…/jobs/view/…` page or a Greenhouse posting).
2. Open the side panel.
3. **Expected**: Job Analyzer mode renders (not the video panel); a progress indicator appears; within ~8 s the analysis shows title, company, location, arrangement badge, salary, seniority, tech stack.
4. If the posting states hybrid days ("3 days in office"): **Expected**: badge shows `hybrid · 3 days office`, evidence quote is displayed verbatim, confidence label is `explicit` or `inferred`.
5. On a posting that never mentions arrangement: **Expected**: badge shows **Unspecified** — never a guessed value.

## Scenario 2 — Non-job page and error paths (US1)

1. Open the side panel on a news article.
   **Expected**: "This doesn't look like a job posting" + "Analyze anyway" action; forcing it re-runs analysis with `assumeJobPosting: true`.
2. Stop the local backend (`Ctrl-C` in terminal 1) and trigger analysis on a posting that has JSON-LD.
   **Expected**: plain-language error banner with Retry; title/company/salary derived from JSON-LD still render client-side.

## Scenario 3 — YouTube regression gate (FR-016 / SC-005)

1. Open a `youtube.com/watch` page and open the side panel.
   **Expected**: existing Video Knowledge Panel, pixel-for-pixel the current behavior; no Job Analyzer UI.
2. Run the existing suites unchanged:

```bash
cd extension && npm test
cd ../functions && npm test
```

**Expected**: all pre-existing tests pass without modification.

## Scenario 4 — Save, library, persistence (US2)

1. Analyze a posting, click **Save**.
   **Expected**: saved confirmation; status defaults to `interested`.
2. Open the **Saved** tab: change status to `applied`, add a note, filter by arrangement and by status, sort by date.
   **Expected**: every change persists immediately; filters/sort behave; entry links back to the posting URL.
3. Quit and relaunch Chrome; reopen the Saved tab.
   **Expected**: the posting, status, and notes survive the restart.
4. Click **Export**.
   **Expected**: a single JSON file downloads containing all saved postings.

## Scenario 5 — Revisit + cache (US3)

1. With a posting saved, revisit its URL **with tracking params appended** (e.g., `?utm_source=x&trk=y`) and open the panel.
   **Expected**: "Already saved" with stored analysis/status/notes; DevTools Network shows **no** `/api/analyze-job` call.
2. Click **Re-analyze**.
   **Expected**: exactly one fresh backend call; result replaces the display.
3. Analyze (don't save) a different posting, close and reopen the panel on it.
   **Expected**: cached result renders, no backend call.

## Scenario 6 — Fit score + profile (US4)

1. With no profile configured, analyze a posting.
   **Expected**: fields render; fit section shows a "configure your profile" prompt linking to options.
2. Open extension options, enter a profile with a dealbreaker (e.g., "no fully on-site roles"), save.
3. Analyze a fully on-site posting.
   **Expected**: fit score ≤ 20 and the rationale names the dealbreaker.
4. Analyze a well-matching remote posting.
   **Expected**: plausibly high score with a one-to-two-sentence rationale.

## Scenario 7 — Accuracy eval (SC-001 / SC-002, on-demand)

```bash
cd functions && npm run eval:postings
```

**Expected**: report over the 50-posting fixture set: arrangement accuracy ≥ 90%, zero stated-arrangement contradictions, hybrid day counts extracted wherever stated. Run before release tagging (not part of CI).

> **Result 2026-07-04** (implementation run, live `gpt-4o-mini`): 6-posting seed set —
> arrangement accuracy **100%**, stated-arrangement contradictions **0**, hybrid day
> counts **2/2**. The set must grow to 50 labeled postings before release sign-off
> (see `functions/tests/fixtures/postings/README.md`).

## Unit / contract test entry points

```bash
cd extension && npx vitest run tests/canonicalUrl.test.ts     # board-fixture table tests
cd extension && npx vitest run tests/pageExtractor.test.ts    # JSON-LD variants, jsdom
cd extension && npx vitest run tests/jobStorage.test.ts       # round-trip, index integrity
cd extension && npx vitest run tests/jobAnalysisClient.test.ts # msw contract cases
cd functions && npx vitest run test/jobExtractionOrchestrator.test.ts # evidence-downgrade path
```
