# PR2 handoff: where implementation stopped

> **Update 2026-10-30 (T088 in progress)**: read section 7 ("T088 state") first. The gate checks and the old-extension compatibility smoke pass. Left: the web half of the smoke, QG-3 review, and the PR (ask before pushing or opening it).

> **Update 2026-10-29 (T087 done, gate PASSES)**: after attempt 3 the judge was reworked (per-dealbreaker checks by number, three-way verdict, reading rules), and the product owner approved new metrics: SC-004 per-run agreement; SC-002 identical fit input plus ≥ 75% recall; SC-008 0 trap false plus ≤ 2% misreadings. The final run (`eval-runs/pr2.json`) passes on both configurations; see the eval-models.md "Final run" section and spec.md Clarifications. Left: T088 (lint/tests/coverage, perf, compatibility smoke, QG-3 review, PR; ask before pushing or opening the PR). Section 6 below is history.

> **Update 2026-10-29 (T087 eval, gate FAILED)**: T060/T078 are done and every free gate
> check passes (lint, tests, coverage, perf). T087 ran three times and SC-004 (verdict
> stability >= 90%) and SC-002 score independence (>= 90%) still fail; SC-008 (0 false
> dealbreakers) and SC-002 (0 missed) are also nonzero. Nothing is pushed and there is no PR.
> Read the "T087 failed gate" section at the end of this file before doing anything else.

> **Update 2026-10-29 (T060/T078 done)**: the extension E2E `profileFreshness.spec.ts` now passes against a local Functions host (`REQUIRE_AUTH=false func start` + Azurite). `regionScoping.test.ts` fails on `main` too (pre-existing). Left: T087 (live eval, ask first) and T088 (gate, QG-3, PR, ask first). Earlier note follows.
>
> **Update 2026-10-29 (later session)**: everything below marked ⏳ is now implemented
> and green (functions 507, extension 472, web 123 unit/contract tests; web E2E 4/4; lint
> clean) **except**: T060 (extension E2E `profileFreshness.spec.ts` is written but not
> run — it needs a live backend baked into the build, like `savedJobs.test.ts`), T078
> (blocked on T060), T087 (live eval, costs money, ask first) and T088 (QG-3 review,
> compatibility smoke, perf check against T001, then the PR; ask first). Nothing is
> committed since `db868b2`. Both client Options/Profile hints that said "capped at a
> fit score of 20" were reworded (the score is no longer capped).


**Branch**: `006-freshness-verdict` (cut from `main` at `4d4e9d9`). Not pushed, no PR yet.
**Date**: 2026-10-29. **Scope of PR2**: tasks T028–T088 in [tasks.md](./tasks.md) (US1 + US2).

Read this file, then [tasks.md](./tasks.md) Phases 4–5, then continue with `/speckit-implement`.
`check-prerequisites.ps1` refuses non-numbered branches; skip it and use
`specs/006-profile-match-ux/` as the feature directory.

## 1. Status

| Area | Tasks | State |
|---|---|---|
| Groundwork (Phase 3) | T028–T042 | ✅ done, tests green |
| US1 backend | T043–T051, T062–T069, T075 | ✅ done, tests green |
| US1 shared fixtures | T052 | ✅ tests written, **failing on purpose** (T070 implements them) |
| US1 extension | T053–T056, T060, T071–T074 | ⏳ not started |
| US1 web | T055 (web half), T057–T059, T061, T076–T077 | ⏳ not started |
| US1 E2E run | T078 | ⏳ |
| US2 (rubric, verdict) | T079–T088 | ⏳ not started. T087 is a **live eval** (costs money) and T088 opens the PR |

Commits on the branch, in order (test-first is respected per area):

```text
120305d test: groundwork (T028-T034)
d5c3420 feat: groundwork (T035-T042)
f3e8994 test: backend US1 (T043-T051, T075)
f620dc1 feat: backend US1 (T062-T069, T075)
a8a5ce7 test: fitView freshness/rescore/cost-line tables + fake storage API (T052)
```

Test counts at the last green run: functions 502, extension 386 (plus 24 new
fitView cases failing until T070), web 55 (plus the same new cases failing).

## 2. What exists now (implementation notes the spec docs don't hold)

### Shared
- `shared/types/profile.ts`: `ScoringProfile`, `profileToPromptText` (output
  byte-identical, pinned by `functions/tests/unit/profileSerialization.test.ts`),
  `dealbreakerLinesFromPrompt` (reads the **last** `Dealbreakers:` heading,
  stops at the first line not starting with `- `).
- `shared/types/job.ts`: `Fit.dealbreakersViolated?`, `Fit.profileFingerprint?`,
  `EvidenceItem`/`FitEvidence` types (PR3 uses them; `Fit` has **no** `evidence`
  field yet), `AnalyzeJobRequest.profileData?`/`rescore?`, `isScoringProfile`,
  `isPriorFingerprint`, `MIN_TEXT_CHARS = 300` (moved here; the extension's
  `lib/pageExtractor.ts` re-exports it).
- `shared/pasteIdentity.ts`: moved from `extension/lib/` (git mv), uses
  `globalThis.crypto.subtle`. Test vector:
  `"We are hiring a Software Engineer in Austin."` →
  `paste:40df62e8a3fe15f0cdb143b8d4b12916c1d73bf84d9338f66ab219b5f04e1564`.
- `shared/fitView.ts`: only `normalizeFit`, `NormalizedFit`, `Verdict`,
  `Freshness` so far. **T070 must add** `freshness`, `rescoreAction`,
  `rescoreCostLine` and the types the fixtures import: `RescoreAction`,
  `RescoreCostUsage`, `RescoreJob`, `RescoreSurface`.
- `shared/fitView.fixtures.ts`: `NORMALIZE_CASES`, `FRESHNESS_CASES`,
  `RESCORE_ACTION_CASES`, `COST_LINE_CASES`. The signatures they imply:

```ts
type RescoreSurface = "panel" | "list";       // panel = extension panel on the posting's own page
interface RescoreJob { source?: "url" | "document" | "paste"; sourceUrl: string; saveKey: string; unavailableAt?: string | null }
type RescoreAction =
  | { kind: "none" }
  | { kind: "rescore-here"; label: "Rescore" }
  | { kind: "open-posting" | "upload-again" | "paste-again"; label: string; href: string };
interface RescoreCostUsage { rescoresUsed: number; rescoresLimit: number; count: number; limit: number }

freshness(fit, current): Freshness            // null fit -> "unknown"; current undefined -> "unknown"
rescoreAction(job, freshness, surface): RescoreAction
rescoreCostLine(usage): string
```

  Decisions baked into the fixtures: only `out-of-date` and `version-unknown`
  get an action (`profile-deleted` → none); `source` absent means `url`;
  `unavailableAt` does **not** suppress the action (the page may come back; the
  note is shown separately); URL on `panel` → "Rescore", on `list` →
  "Open posting to rescore" with `href: sourceUrl`; document →
  `/upload?rescore=<key>`; paste → "Paste again to rescore",
  `/upload?mode=paste&rescore=<key>` on **both** surfaces. Exhausted cost line
  copy (not in the spec, chosen here): "No free rescores or analyses left this month".

### Backend (functions/)
- `services/profileFingerprint.ts`: `profileFingerprint`, `resolveScoringProfile`
  (profileData wins; empty string means no profile), `fingerprintForRequest`.
- `services/profileRepository.ts`: merge PUT, ETag-conditional
  (`updateEntity(..., "Replace", {etag})` with the full merged row, or
  `createEntity`), retries 412/409 up to 4 times; `fingerprintHistory` capped at
  20; new `getFingerprintHistory(sub)`. GET/PUT return `fingerprint`, plus
  `preferences`/`confirmedSkills` when present.
- `services/rescoreEligibility.ts`: pure `decideRescoreCharge` (no tier input).
- `services/meteringService.ts`: every write is `Merge` + ETag. New
  `chargeAnalysis(sub, tier, "rescore"|"analysis")`, `refundCharge`,
  `grantUnavailableRefund`, `peekUsage` (now returns `rescoresUsed`,
  `rescoresLimit`). `checkAndIncrement` and `refundOnSystemFailure` are kept as
  thin delegates because existing tests and billing use them.
- **New** `services/analysisMetering.ts` (not named in tasks.md): the metering
  half shared by both analyze handlers: `chargeForAnalysis` (lookups, decision,
  charge, 429/503 responses, `METERING_ENFORCED=false` shadow mode only when
  `allowShadowMode`), `settleCharge` (posting-unavailable refund),
  `refundAfterFailure`, `usageEcho`.
- `analyze-job/index.ts`: `withUsageMetering` **deleted**; route is
  `withRateLimit(withAuth(handler))`; order validate → charge → model.
- `analyze-document/index.ts`: parts `file` xor `text`, `profileData` (JSON,
  400 if malformed), `rescore=true`, `priorFingerprint`. Paste: 300..40,000
  chars else `400 TEXT_TOO_SHORT` / `413 TEXT_TOO_LONG`, empty title,
  `source: "paste"`, no `filename`.
- Orchestrator: schema has `fit.dealbreakersViolated` (required, maxItems 10);
  cap-at-20 prompt line removed; `resolveDealbreakers` (exported) runs after
  `enforceConsistency`; `fit.profileFingerprint` stamped. **Rubric bands
  (T083) and `tier` stamping are not done yet** — they're US2.
- Saved jobs: `unavailableAt` column; stored as `""` when cleared; a PUT or a
  PATCH with `analysis` clears it; PATCH validates ISO date.
- `/api/account` usage gains `rescoresUsed`, `rescoresLimit`.
- Recorded fixtures: `dealbreaker-onsite.json`, `dealbreaker-paraphrased.json`;
  `with-fit.json` gained `"dealbreakersViolated": []`; README lists what each proves.

### Clients so far
- Extension: `AccountBar.tsx` labelled "Web app" button (FR-028); the `sr-only`
  description span is a **sibling** of the link (inside it, it would join the
  accessible name). `CandidateProfile.fingerprint?`, `SavedJob.unavailableAt?`.
- Web: `ProfilePayload.fingerprint?`, `SavedJobPayload.unavailableAt?`,
  `AccountPayload.usage.rescoresUsed?/rescoresLimit?`, `UsageEcho.charged?` etc.,
  `DocumentAnalysisResult.source: "document" | "paste"`, `filename?`,
  `postingUnavailable?`. `Upload.tsx` uses `result.filename ?? ""` as a stopgap.
- Extension test fake `tests/unit/helpers/mswStorageServer.ts`: profile
  responses include `fingerprint` (exported `fakeFingerprint()`), `/account`
  usage has rescore counts plus `setAccountUsage()`, PATCH handles
  `unavailableAt` per the contract.

## 3. Planned design for the next tasks (worked out, not yet coded)

**T071 profileStorage**: `getProfile()` writes `chrome.storage.session`
`profile:fingerprint = { value, fetchedAt }` (`null` on 404 or empty text;
untouched when the fetch throws). `setProfile()` writes it too. Export
`getCachedFingerprint(): Promise<string | null | undefined>` and
`toScoringProfile(profile) => { text, dealbreakers }`.

**T072 jobAnalysisClient**: request `{ extract, profileData?, profile?, assumeJobPosting?, rescore? }`;
returns `{ analysis, usage?, postingUnavailable }`. Strip `usage` and
`postingUnavailable` out of the response before it becomes the stored
`analysis` (today the whole body, including `usage`, is stored as the analysis).
Update every caller in `jobFlow.ts`.

**T073 jobFlow + messages**:
- Delete `needsFitRefresh` and its auto-refresh branches; the existing
  revisitFlow tests "re-analyzes a cached posting whose fit is missing…" and
  "upgrades a pre-breakdown fit snapshot…" must be **rewritten** to expect no
  request (T053 says so).
- Result messages (`JOB_ANALYSIS_RESULT`, `PASTE_ANALYSIS_RESULT`) gain
  `currentProfileFingerprint?: string | null` (undefined = unknown),
  `profileUnavailable?: true`, `postingUnavailable?: boolean`, and
  `rescoreError?: JobPanelError` (a failed rescore broadcasts the **stored**
  analysis plus the error, so the panel keeps the old score marked out of date;
  `usage-limit-reached` there renders `UsageExhausted`).
- New `RESCORE_JOB_PAGE { tabId, priorFingerprint }` → `rescoreJobPage()`
  runs the page flow with `bypassCache` and `rescore`. Route it in
  `entrypoints/background.ts`.
- Paste rescore: `AnalyzePastedTextMessage.rescore?` bypasses the stored lookup.
  The composer's "Paste again to rescore" re-sends its current text with it.
- Thin content: look up the stored entry **before** the thin-content error. Saved
  entry + normal analyze → broadcast stored with `postingUnavailable: false`, no
  request. Saved entry + rescore → `jobStorage.update(url, { unavailableAt: now })`,
  broadcast stored with `postingUnavailable: true`, no request.
- `postingUnavailable: true` response → keep the stored analysis, PATCH
  `unavailableAt`, don't overwrite cache.
- Every flow sends `profileData` = stored profile and
  `profile = profileToPromptText(profileData)` (T055), and sets
  `profileUnavailable: true` when `getProfile` throws.

**T074 UI**: `FitScore` gains props for freshness, rescore action, cost line,
`onRescore`, unavailable note, profile-unavailable state. The panel gets usage
from `accountService.fetchAccount()` (extend its type with rescore counts).
`ThisPageTab` listens to `chrome.storage.onChanged` for `profile:fingerprint`
and shows the FR-007 offer without auto-running. `SavedJobRow` uses
`rescoreAction(..., "list")`; for `upload-again`/`paste-again` prefix the href
with `WXT_WEB_APP_URL`. `OptionsApp` gets the key for free through `setProfile`.
Keep `scoreStyle` until T085 deletes it (US2).

**Web (T076/T077)**: `endpoints.ts` `analyzeDocument({ file } | { text }, { profileData, rescore, priorFingerprint })`
and a new `patchJob`. Upload page: wait for the profile request to settle;
`?rescore=<key>` PATCHes in place only when `result.saveKey === key`, otherwise
"Save to library" plus "This didn't match the saved posting, so it was analyzed
as a new one."; `?mode=paste` radio group; heading "Analyze a posting"; nav
"Analyze posting" in `AppShell.tsx`. New `components/PastePosting.tsx`.

## 4. Gotchas

- **Prettier**: the repo's code is *not* formatted to its own `.prettierrc`
  (width 80) and CI doesn't run prettier. Running `prettier --write` on an
  existing file reformats unrelated lines. Only format new files, or not at all.
- **Functions lint locally**: `npm run lint` fails on the untracked `coverage/`
  folder. Use `npx eslint . --max-warnings 0 --ignore-pattern coverage`.
- **Extension `tsc --noEmit`** has ~50 pre-existing errors (WXT globals,
  `tests/setup.ts` `vi`, vitest config). Not a gate; check only that touched
  files add none. Lint and vitest are the real gates.
- Functions unit tests use Azurite (globalSetup starts it). Use a unique `sub`
  per test: handlers now meter, so a fixed sub accumulates usage across runs.
- The ETag retry budget (4) only guarantees 5 concurrent writers; the parallel
  rescore test uses 5 for that reason.
- One pre-existing unit test pinned `"Replace"` for Usage writes; it now pins
  `"Merge"` (that was trap 1).
- `perf.test.ts` now measures `withAuth` + `chargeForAnalysis` (the deleted
  wrapper's replacement).

## 5. Open items to carry into the PR

- T041: the 360 px-width check of the account bar with the Premium fixture
  hasn't been done visually yet.
- T088 needs coverage ≥ 80% on the listed modules. `shared/fitView.ts` isn't in
  either client's coverage `include` yet; add `../shared/fitView.ts` there.
- T087 is a live eval (money), and T088 asks the user for a QG-3 review and
  then opens the PR. Ask the user before both.
- After PR2 merges: PR3–PR6 each get their own branch from `main`
  (`006-evidence`, `006-profile-setup`, `006-confirm-skills`, `006-triage-compare`).


## 6. T087 failed gate: what was tried and what is open

Branch `006-freshness-verdict`, last commit `a4092e0`. Eval: `cd functions && npm run eval:postings --
--configs=scripts/evalConfigs.chosen.json --runs=5 --out=../specs/006-profile-match-ux/eval-runs/<name>.json`
(live, ~$ cents, about 25 min for both configs; free = `gpt-6-luna`/`none`, Premium =
`gpt-6-luna-premium`/`low`). Tables are in `eval-models.md` ("PR2 — rubric and dealbreakers…").
Raw runs: `eval-runs/pr2-attempt1.json`, `pr2-attempt2.json`, `pr2-attempt3.json`; the final run (attempt 4) is `pr2.json`.

| Attempt | Change | Free: false / missed / indep / stability | Premium: false / missed / indep / stability |
|---|---|---|---|
| 1 | single call, model lists `dealbreakersViolated` | 31 / 5 / 66.7 / 77.3 | 9 / 7 / 66.7 / 75.0 |
| 2 | + required verbatim quote per violation, server drops unquoted | 26 / 18 / 75.0 / 63.6 | 2 / 16 / 66.7 / 72.7 |
| 3 | fit call never sees dealbreakers; separate parallel judge call with quotes (R8 fallback) | 18 / 11 / 83.3 / 79.5 | 10 / 20 / 75.0 / 63.6 |

Findings:
- In attempt 3 the with/without-dealbreakers pair gets **identical** input to the fit call, so the
  remaining score-independence gap is pure run-to-run score noise near band edges (85/65/40). The
  same noise caps verdict stability. Prompt wording cannot fix it; `gpt-6-luna` takes no
  temperature (reasoning-effort models), so the score can't be pinned that way.
- Dealbreaker detection itself is still unreliable (tens of false/missed cases). Worst offenders
  (free): "Minimum salary 120000 USD" and "Remote only" flagged where the posting is silent or
  uses another currency; "EU timezones only" missed on `phenom-intuit`. See the labelling notes in
  `functions/tests/fixtures/profiles/pairs.json` (`_labelling`), which defines ground truth.
- Premium cost shows $0 because `functions/scripts/modelPrices.json` has no `gpt-6-luna-premium`.
- Code state: the orchestrator (`functions/src/services/jobExtractionOrchestrator.ts`) runs the
  judge call only when the profile has dealbreaker lines; judge failure returns none + warning.

Ideas not yet tried, roughly by promise:
1. Make the **metric** match the product: band edges make a hard-band stability target very strict.
   Candidates: score-median per pair across runs, a tolerance (adjacent band counts as stable),
   or measuring the score spread (e.g. stdev <= 5 points). Needs the user's sign-off (spec change).
2. Reduce score noise: a deployment that accepts `temperature: 0` (earlier eval had
   `premium-5.4-mini-t0`, `free-4o-mini-t0` in `evalConfigs.json`), a seed, averaging 2-3 fit calls,
   or asking for sub-scores (skills/seniority/level) that the server sums and rounds deterministically.
3. Deterministic checks for the structured dealbreakers (salary min vs extracted `salary`
   min/max/currency; remote-only vs `arrangement`), model judge only for free-text ones.
4. Judge with a stronger model/effort only for dealbreakers; or per-dealbreaker calls.

Do not open the PR until the user decides; they previously approved opening it, but the task
(T087) says stop and report when SC-004 or independence is below 90%. The recommended fallback if
the metric can't be met: open PR2 as not-ready-to-merge, ship US1 (freshness/rescore) separately.

## 7. T088 state (2026-10-30)

Branch `006-freshness-verdict`, not pushed, no PR. Commits since `e351db2` are split so each
`test:` commit comes before its `feat:` commit (each test commit was checked red, then green).
The unsplit history is kept on local branch `006-freshness-verdict-presplit` (same final tree).
Delete it once the PR is open.

**Done:**

- **T087**: gate passes under targets the user approved (spec.md Clarifications; eval-models.md
  "Final run"). Raw run: `eval-runs/pr2.json`.
- **Lint**: functions, extension and web are clean. `functions/.eslintrc.cjs` now ignores `coverage/`.
- **Tests**: functions unit 411 and integration 111, extension 472, web 123.
- **Coverage**: at least 80% on every module T088 lists. `shared/fitView.ts`: 100% lines.
- **Perf (QG-4)**: matches the T001 baseline. Analyze path p95 2.5–2.8 ms (baseline 2.79). Under
  parallel integration files it measured 111–134 ms from Azurite contention alone, not code
  (`main` measured 3.1 ms sequentially). `test:integration` and `coverage` now use
  `--fileParallelism=false`; CI and CD run `test:integration`, so this matters there too.
- **auth.test.ts**: the two signup tests now use a unique `sub`. The fixed default sub let them
  exhaust one shared monthly allowance in a persistent Azurite (429 after 50 runs).
- **Compatibility smoke, extension half**: the published v0.0.36 extension, built with
  `npm run build:e2e` against a local host on :7072 running this branch (`REQUIRE_AUTH=false`),
  passed 5/5. That covers v0.0.36's own `jobAnalyzer`, `savedJobs` and `migration` E2E plus
  [`compat-smoke/pr2-old-extension.spec.ts`](./compat-smoke/pr2-old-extension.spec.ts):
  - an old options-page save keeps `preferences` and `confirmedSkills`;
  - an old analyze and save stores a PR2-shaped fit (`dealbreakersViolated`, `profileFingerprint`);
  - the fit renders after a reload, with no page errors.
- **Compatibility gap found and fixed (user-approved)**: v0.0.36 ignores `dealbreakersViolated`,
  so a violating posting showed a plain high score. Requests without `profileData` now get
  "Violates your dealbreaker(s): …" appended to the rationale (commit `63d7b10`; contract
  analyze-api §5; research R8 "Superseded" step 5). The smoke asserts the note is shown.
  The v0.0.36 options page still says "capped at a fit score of 20". Only an extension release
  fixes that.

**Left:**

1. **Web half of the smoke**: open the web library and posting detail for the saved posting,
   against the same backend.
2. **QG-3 review request** to the user: score header, dealbreaker banner, cost line.
3. **PR description**: eval-models.md sign-off, the four spec changes in Clarifications, the
   legacy rationale note, and the perf/CI change. Then push and open PR2. Ask first.

**Running the smoke again:**

- Start a fresh Azurite (`npx azurite-table --location .azurite`).
- In a worktree of this branch: `npm run build`, then
  `REQUIRE_AUTH=false func start --port 7072`.
- In a worktree at `v0.0.36`: point `extension/.env.local` at :7072, run
  `npm run build:e2e`, copy the spec into `tests/e2e/`, then
  `E2E=1 E2E_HEADLESS=1 npx playwright test --project=e2e`.
- Wait until `curl localhost:7072/api/profile` returns HTTP 200 before the first test. A test
  started earlier fails with "Could not reach the analysis service" (cold start).

**Not cleaned up**: a `func start` on :7071, started at 17:42 on 2026-10-29 from `functions/`
by an earlier session, is still running on old code. This session was not allowed to stop it.
Stop it by hand if you don't need it.

