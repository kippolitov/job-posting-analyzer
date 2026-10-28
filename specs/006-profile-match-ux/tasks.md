# Tasks: Trustworthy, Actionable Profile Match

**Input**: Design documents from `/specs/006-profile-match-ux/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution II mandates test-first, ≥ 80% coverage on changed modules, recorded fixtures (no hollow mocks), and E2E for every P1 journey. Every `test:` task below MUST be committed **failing** before the implementation task that turns it green. On each PR, `git log --oneline` should show a `test:` commit ahead of each `feat:` commit.

**Organization**: Phases follow the six-PR sequence in [plan.md](./plan.md#pr-sequence). PR1 (the scoring-model switch) and the PR2 groundwork are foundational and carry no story label. US1 and US2 ship together as PR2. US3 to US6 are PR3 to PR6.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 = freshness and dealbreakers (P1), US2 = verdict and rubric (P2), US3 = evidence (P3), US4 = profile setup (P4), US5 = "I have this" (P5), US6 = triage and compare (P6)
- Paths are repo-root relative. Run commands from the package named in the path (`functions/`, `extension/`, `web/`).

## Rules that apply to every task

1. **Never change prod app settings or Azure resources without asking the user first.** The tasks that need approval are marked **⚠ APPROVAL** and are listed in [plan.md § Changes requiring your approval](./plan.md#changes-requiring-your-approval).
2. **Additive wire and storage shapes only** ([research R4](./research.md#r4--fit-schema-migration-and-version-skew-pr2-pr3-fr-005fr-011)). `fit.matching`, `fit.missing` and `fit.desired` stay `string[]` forever, because the published extension renders them as React children. New fields are optional, and old readers must not see a changed type.
3. **Every PR ends with the compatibility smoke**: build the extension at the last release tag, point it at the PR's backend, analyze a posting, open the Saved tab and the options page, then open the same saved posting on the web. Nothing may throw.
4. **Recorded model fixtures** live in `functions/tests/fixtures/jobAnalysis/`. They are complete, schema-valid payloads, per that folder's README. Orchestrator tests mock `openai` the way `functions/tests/unit/jobExtractionOrchestrator.test.ts` already does.

## Four traps this feature is built around

These are silent failures, not crashes. They were found in existing code during planning.

1. **Usage `Replace` writes erase new columns** (T057). `checkAndIncrement` and `refundOnSystemFailure` use `updateEntity(…, "Replace")`, so the first ordinary analysis after a rescore wipes `rescoresUsed`. T043 writes that test failing first.
2. **An old client's profile PUT erases new fields** (T037). `putProfile` upserts with `"Replace"`, so an older extension saving `{text, dealbreakers}` would drop preferences and confirmed skills. T031 pins merge semantics.
3. **Object-shaped chips crash old clients** (T084). The PR3 model schema uses objects internally, and the server MUST split them back into label strings plus `fit.evidence`. T080 asserts the wire shape.
4. **Removing temperature changes prod behaviour** (T020). Once temperature becomes optional, the deployed tiers would silently move from temperature 0 to the default of 1. T020 sets `…_TEMPERATURE=0` **before** PR1 deploys. It needs approval.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Lock the baselines that later PRs are measured against.

- [ ] T001 Record the QG-4 p95 baseline on `main` by running `npm run test:integration -- perf.test.ts` from `functions/`. Write the p95 and the commit SHA into a new "Baselines" section at the bottom of `specs/006-profile-match-ux/quickstart.md`, so later PRs compare against a fixed number for the 20% regression gate.
- [ ] T002 [P] Record the current six-posting arrangement eval for both tiers in the same "Baselines" section of `specs/006-profile-match-ux/quickstart.md` **(live model calls, about $0.01)**. Run `npm run eval:postings` and `npm run eval:postings -- --tier=premium` from `functions/`, and note the deployment names, accuracy and p95. This is the "current 100%" that SC-008 must keep.
- [ ] T003 [P] Create `specs/006-profile-match-ux/eval-runs/` containing a `.gitkeep`, plus a `README.md` that says raw `--out` JSON files land here and are committed with PR1.

---

## Phase 2: Foundational A — PR1, Scoring-model switch (FR-M01–M05)

**Purpose**: Every rubric, verdict and stability measurement in later PRs must run on the model that will remain. This phase blocks all user stories.

**Independent test**: [quickstart.md § PR1](./quickstart.md#pr1--scoring-model-switch-frm01m05). The eval report shows the chosen free configuration passing SC-002, SC-004, SC-008 and SC-009, and `eval-models.md` is signed off.

### Tests for PR1 (write first, must fail) ⚠️

- [ ] T004 [P] Write `functions/tests/unit/modelConfig.test.ts`, which tests `resolveModelConfig(tier, env)` against [contracts/model-config.md](./contracts/model-config.md). It covers:
  - the free deployment fallback chain (`AZURE_OPENAI_JOB_DEPLOYMENT` → `AZURE_OPENAI_DEPLOYMENT` → `"gpt-4o-mini"`);
  - Premium using its own deployment **and** its own `_PREMIUM` settings when `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` is non-empty;
  - Premium using the free deployment **and the free settings** when it is unset or `""`;
  - empty strings treated as unset;
  - temperature parsing for `"0"`, `"0.7"` and `"2"`, and rejecting `"abc"`, `"-1"`, `"2.5"` and `"NaN"`;
  - `reasoningEffort` accepting `none|low|medium|high|xhigh` and rejecting `minimal` and `max`;
  - `apiVersion` defaulting when unset and being overridden by `AZURE_OPENAI_API_VERSION`;
  - an invalid value throwing `ModelConfigError` whose message names the variable.
- [ ] T005 [P] Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts` with request-shape tests on the mocked `create`:
  - with no temperature set, the request has **no** `temperature` key;
  - with temperature 0 set, it has `temperature: 0`;
  - with reasoning effort `none` set, it has `reasoning_effort: "none"` and no `temperature`;
  - the repair retry (second call) uses identical settings;
  - `max_completion_tokens` is still 3000;
  - `new AzureOpenAI` receives the resolved `apiVersion`.
- [ ] T006 Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts` with `observe`-callback tests:
  - one call per completion attempt, with `attempt: 1` and then `2` on repair;
  - token fields read from the mocked `completion.usage`, including `completion_tokens_details.reasoning_tokens` and `prompt_tokens_details.cached_tokens`, defaulting to 0 when absent;
  - `finishReason` and `deployment` included;
  - `latencyMs` is a non-negative number;
  - omitting `observe` changes nothing.
- [ ] T007 [P] Extend `functions/tests/unit/analyze-job.handler.test.ts` to assert two things:
  - the handler logs exactly one `model.usage` line per completion attempt through `context.log`, with token counts only (assert that no argument contains `mainText` or profile text);
  - a `ModelConfigError` maps to `500 SERVICE_ERROR`, so the existing 5xx refund path runs.
- [ ] T008 [P] Write `functions/tests/unit/evalMetrics.test.ts` for the pure metric helpers that `functions/scripts/evalMetrics.ts` will export. It covers:
  - `bandFor(score, violations)` returning one of the five FR-009 bands;
  - `verdictStability(runsByPair)`, as the share of pairs whose band is identical across runs;
  - `falseDealbreakers(results, pairs)` and `missedDealbreakers(results, pairs)`, using `fit.dealbreakersViolated` when present and otherwise the PR1 proxy of `score ≤ 20` plus a case-insensitive rationale mention (valid only while the PR1 prompt still asks for the cap), and reporting which `detectionMethod` was used;
  - `scoreIndependence(withDealbreakers, withoutDealbreakers)`, as the share of violating pairs whose band, computed **from the score alone**, is the same in both runs (SC-002);
  - `costPerAnalysis(usage, price)`, with cached tokens billed at the cached rate and never assumed cheaper than uncached;
  - `p95` (reusing the existing nearest-rank definition);
  - `truncations`, counting `finishReason === "length"`.

### Implementation for PR1

- [ ] T009 Implement `functions/src/services/modelConfig.ts`, exporting `resolveModelConfig`, `ModelConfig` and `ModelConfigError`, to make T004 pass. Keep it pure: it reads only the `env` argument.
- [ ] T010 Refactor `orchestrateJobAnalysis` in `functions/src/services/jobExtractionOrchestrator.ts` to make T005 and T006 pass:
  - replace the inline deployment selection with `resolveModelConfig(tier, process.env)`;
  - pass `apiVersion` from the config;
  - spread `temperature` and `reasoning_effort` only when defined;
  - add the optional 4th parameter `observe?: (u: ModelUsage) => void`, called after each `create` returns;
  - export the `ModelUsage` type.
- [ ] T011 Wire `observe` in `functions/src/analyze-job/index.ts` and `functions/src/analyze-document/index.ts` so each logs `context.log("model.usage", JSON.stringify(u))`. Map `ModelConfigError` to `500 SERVICE_ERROR` in both. This makes T007 pass.
- [ ] T012 [P] Document the five new variables in `functions/local.settings.json.example`, using the `//NAME` comment-key convention already in that file. The variables are `AZURE_OPENAI_JOB_TEMPERATURE[_PREMIUM]`, `AZURE_OPENAI_JOB_REASONING_EFFORT[_PREMIUM]` and `AZURE_OPENAI_API_VERSION`. Each comment states that the setting is omitted from the request when empty, and that the Premium settings apply only when the Premium deployment is set.
- [ ] T013 Run the live probe from quickstart step P1-2 **(live, a few cents)**:
  1. Write a throwaway script under the session scratchpad (not committed) that calls `orchestrateJobAnalysis` once per deployment with an `env` override: `gpt-4o-mini` at temperature 0, `gpt-5.4-nano` at temperature 0, and `gpt-6-luna` at reasoning effort `none`.
  2. Run it under a candidate `AZURE_OPENAI_API_VERSION`, starting with `2024-12-01-preview` and moving to a newer GA or preview version if that one 400s.
  3. Set the version that passes all three as the default in `functions/src/services/modelConfig.ts`, and update T004's expected default.
  4. Record the version and the three outcomes in a new file, `specs/006-profile-match-ux/eval-models.md`, under "API version probe".
  If no single version passes all three, stop and report to the user.
- [ ] T014 [P] Write `extension/scripts/exportCorpusExtracts.ts`. For each slug in `extension/tests/fixtures/pages/manifest.json`, it serves the fixtures with `serveFixtures()`, opens the corpus page in Chromium, calls `runExtractor(page)`, and writes `functions/tests/fixtures/postings/full/<slug>.json`. Each file contains `{ url, canonicalUrl, title, jsonLd, structuredSources, mainText (sliced to 40,000), extractedAt }`, without `provenance`, plus `expectNotScorable: true` for `thin-posting-control`. Follow `extension/scripts/rescoreCorpus.ts` for the setup and teardown pattern.
- [ ] T015 Run `npx tsx scripts/exportCorpusExtracts.ts` from `extension/` and commit the 6 JSON files under `functions/tests/fixtures/postings/full/`. Add a `README.md` there that says:
  - the files are derived from `extension/tests/fixtures/pages/`, not hand-edited;
  - they are regenerated only when the pages corpus or `pageExtractor.ts` changes;
  - `thin-posting-control` is never scored for fit.
- [ ] T016 [P] Create the four fixture profiles under `functions/tests/fixtures/profiles/`, shaped `{ id, text, dealbreakers, preferences?, confirmedSkills? }`. Each résumé text is realistic, at about 1,500–3,000 characters.
  - `senior-backend.json`: dealbreaker "No fully on-site roles".
  - `mid-frontend.json`: preferences `arrangements: ["remote"]` and `minSalary: { amount: 120000, currency: "USD", period: "year" }`, **also** repeated as the dealbreaker lines "Remote only" and "Minimum salary 120000 USD per year", so PR1 can measure them before PR4.
  - `data-ml.json`: preference `locations: ["EU timezones only"]`, also as the dealbreaker line "EU timezones only".
  - `control.json`: no dealbreakers.
- [ ] T017 Create `functions/tests/fixtures/profiles/pairs.json` with one entry per (posting × profile) pair, using the six `postings/*.txt` ids (file stem) and the five scorable `postings/full/*.json` slugs. Each entry is `{ posting, profile, violations, unstatedFacts, verdictRange? }`.
  - Label `violations` by reading each posting: a dealbreaker counts as violated **only** if the posting states the contradicting fact.
  - `unstatedFacts` lists `"arrangement"`, `"salary"` and/or `"location"` when the posting is silent on them. These pairs are SC-008's false-dealbreaker traps.
  - Exclude `thin-posting-control`.
  - Add a top-level `"_labelling"` note describing the rule above.
- [ ] T018 [P] Create `functions/scripts/modelPrices.json`, keyed by deployment name. Each entry is `{ inputPer1M, cachedInputPer1M, cacheWritePer1M?, outputPer1M, source: "Azure Retail Prices API", asOf: "2026-10-28" }`. Seed it from spec.md's Technical Shape:
  - `gpt-4o-mini` 0.15 / 0.60;
  - `gpt-5.4-nano` 0.20 / 1.25;
  - `gpt-6-luna` 0.10 / 0.50, with a cache write of 0.125;
  - `gpt-5.4-mini` 0.75 / 4.50.
  Look up any cached-input price the spec does not give using the Azure Retail Prices API. If it can't be confirmed, set it equal to the uncached price and say so in a `"note"` field.
- [ ] T019 [P] Create `functions/scripts/evalConfigs.json` with the R2 candidates as `{ label, tier, deployment, temperature?, reasoningEffort?, gate }`:
  - `free-4o-mini-t0` (baseline);
  - `premium-5.4-nano-t0` (baseline);
  - `luna-none`;
  - `luna-low`;
  - `luna-medium`.
  All have `gate: false`. Do not include `gpt-5.4-mini`, which FR-M05 rules out on cost (research R2).
- [ ] T020 **⚠ APPROVAL**: ask the user to approve setting `AZURE_OPENAI_JOB_TEMPERATURE=0` and `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM=0` on Function App `job-posting-analyzer-func` (resource group `job-posting-analyzer-rg`) **before** PR1 merges (research R1, trap 4). After approval, set them with `az functionapp config appsettings set` and confirm by listing the setting **names**. Never print values. Record the date in `eval-models.md`.
- [ ] T021 Implement `functions/scripts/evalMetrics.ts` to make T008 pass. Then extend `functions/scripts/evalPostings.ts` per [contracts/eval-harness.md](./contracts/eval-harness.md):
  - with no `--configs`, keep today's behaviour exactly;
  - add `--configs`, `--runs` (default 5), `--concurrency` (default 2, with exponential backoff on 429 up to 5 retries), `--only` and `--out`;
  - load the full-length postings and profiles;
  - serialize each profile with `profileToPromptText` from `shared/types/profile.ts`;
  - per configuration, set `process.env` overrides, then call `orchestrateJobAnalysis` with an `observe` collector;
  - for SC-002, also score each violating pair with the profile's dealbreakers and preferences stripped, and report `scoreIndependence`;
  - print the per-configuration report block from the contract;
  - exit non-zero only when a `gate: true` configuration misses a target.
- [ ] T022 Run the full eval **(live, about 3 hours at 20K TPM, about $1–3)** with `npm run eval:postings -- --configs=scripts/evalConfigs.json --runs=5 --out=../specs/006-profile-match-ux/eval-runs/pr1.json` from `functions/`. If the rate limit makes a configuration exceed about 90 minutes, rerun that configuration alone with `--concurrency=1`. Do not ask for a TPM increase without approval.
- [ ] T023 Write `specs/006-profile-match-ux/eval-models.md`:
  - one comparison table across configurations from `eval-runs/pr1.json`;
  - the R2 decision rule applied step by step;
  - the chosen free and Premium settings;
  - whether Premium moves off `gpt-5.4-nano` (FR-M02);
  - the TPM implication if Premium moves to `gpt-6-luna`;
  - known corpus gaps (iCIMS, SmartRecruiters stub, 5 full-length postings);
  - the GlobalStandard data-processing note from research R2.
  If no `gpt-6-luna` setting passes, record that and stop. PR1 then merges the plumbing only (research R2).
- [ ] T024 Run the PR1 gate from quickstart's "Gate for every PR" (lint, unit, integration, coverage of at least 80% on `modelConfig.ts`, `jobExtractionOrchestrator.ts` and `evalMetrics.ts`), plus the compatibility smoke (rule 3). Ask the user to sign off `eval-models.md` in the PR description, then open PR1.
- [ ] T025 **⚠ APPROVAL**: after PR1 merges and `eval-models.md` is signed off, confirm the privacy-policy wording covers GlobalStandard processing (research R2), then ask the user to approve the settings switch (research R1 step 4). For free, that is `AZURE_OPENAI_JOB_DEPLOYMENT=gpt-6-luna` and `AZURE_OPENAI_JOB_REASONING_EFFORT=none`, and deleting `AZURE_OPENAI_JOB_TEMPERATURE`. Premium changes per `eval-models.md`. After approval:
  1. apply the switch;
  2. analyze one posting from the published extension;
  3. confirm in Application Insights or log stream that `model.usage` shows the new deployment;
  4. record the date and rollback values in `eval-models.md`.
- [ ] T026 If `eval-models.md` keeps Premium on `gpt-5.4-nano`, open a GitHub issue in `kippolitov/job-posting-analyzer` titled "Migrate Premium off gpt-5.4-nano before 2027-09-21", labelled `needs-triage`, linking `eval-models.md`.

**Checkpoint**: the free tier runs on a model retiring on or after 2028-01-01, and every later PR measures on it.

---

## Phase 3: Foundational B — PR2 groundwork shared by US1 and US2

**Purpose**: the fit schema additions, the shared display module, server-side profile serialization and fingerprinting, and merge-PUT. US1 and US2 both build on these, and they ship in the same PR.

### Tests for the groundwork (write first, must fail) ⚠️

- [ ] T027 [P] Write `shared/fitView.fixtures.ts` exporting `NORMALIZE_CASES` as `[input, expected]` pairs. Cover:
  - `null`;
  - a pre-breakdown fit (`{score, rationale}` only);
  - a 005-era fit with all string arrays and no new fields;
  - a fully populated PR2 fit.
  Each expects absent arrays to become `[]`, `dealbreakersViolated` to default to `[]`, `evidence` to default to `{}`, and `profileFingerprint` to stay `undefined` when absent.
- [ ] T028 [P] Write `extension/tests/unit/fitView.test.ts` and `web/tests/unit/fitView.test.ts`. Each iterates `NORMALIZE_CASES` from `shared/fitView.fixtures.ts` against `normalizeFit` and asserts it never throws. The two suites are deliberately duplicated (research R10, FR-023 guard). They get more fixture tables in later tasks.
- [ ] T029 [P] Write `functions/tests/unit/profileSerialization.test.ts` for `shared/types/profile.ts`:
  - **invariant**: `profileToPromptText({text, dealbreakers})` output is byte-identical to the current implementation for 5 cases (no dealbreakers, one, several, trailing whitespace, unicode). Snapshot the strings literally in the test.
  - `dealbreakerLinesFromPrompt(profileToPromptText(p))` round-trips `p.dealbreakers` for every case.
  - `dealbreakerLinesFromPrompt` on text with no `Dealbreakers:` section returns `[]`.
- [ ] T030 [P] Write `functions/tests/unit/profileFingerprint.test.ts`:
  - `profileFingerprint(s)` is 64 lowercase hex characters;
  - it equals SHA-256 of `s.replace(/\s+/g, " ").trim()`;
  - whitespace-only variants give the same fingerprint (US1 #6);
  - a changed dealbreaker gives a different one;
  - `fingerprintForRequest({ profileData })` equals `fingerprintForRequest({ profile: profileToPromptText(profileData) })`.
- [ ] T031 [P] Extend `functions/tests/unit/profileRepository.test.ts` and `functions/tests/integration/storageApi.test.ts` (Azurite), per [contracts/profile-api.md](./contracts/profile-api.md):
  - GET and PUT responses include `fingerprint`;
  - **merge PUT (trap 2)**: seed a row with `preferences` and `confirmedSkills` columns, PUT `{text, dealbreakers}`, and assert both columns survive;
  - `preferences: null` clears them;
  - `fingerprintHistory` is prepended only when the fingerprint changes, capped at 20, and never returned by GET;
  - a whitespace-only PUT leaves `fingerprint` unchanged and history unchanged.
- [ ] T032 [P] Write `functions/tests/unit/analyzeRequest.test.ts` for the request guard and profile resolution in [contracts/analyze-api.md §1](./contracts/analyze-api.md):
  - `isAnalyzeJobRequest` accepts a body with valid `profileData`;
  - it rejects malformed `profileData` (non-string `text`, non-array `dealbreakers`) and a malformed `rescore.priorFingerprint` (not null and not 64 hex);
  - `resolveScoringProfile(body)` returns `profileToPromptText(profileData)` when `profileData` is present, ignoring `profile`, and otherwise returns `profile`;
  - a legacy body without the new fields is accepted unchanged.

### Implementation for the groundwork

- [ ] T033 Extend `Fit` in `shared/types/job.ts` with optional `dealbreakersViolated?: string[]` and `profileFingerprint?: string`, with JSDoc citing research R4. Do **not** change `matching`, `missing` or `desired`. Add `AnalyzeJobRequest.profileData?: ScoringProfile` and `AnalyzeJobRequest.rescore?: { priorFingerprint: string | null }`. `ScoringProfile` is `{ text; dealbreakers; preferences?; confirmedSkills? }`, exported from `shared/types/profile.ts`. Leave `isJobAnalysisPayload` unchanged.
- [ ] T034 Add `dealbreakerLinesFromPrompt` to `shared/types/profile.ts`, and widen `profileToPromptText`'s generic to accept `ScoringProfile` without changing output for `{text, dealbreakers}`. This makes T029 pass.
- [ ] T035 Implement `functions/src/services/profileFingerprint.ts`, exporting `profileFingerprint(serialized)` and `fingerprintForRequest(body)` with `node:crypto`. This makes T030 pass.
- [ ] T036 Extend `isAnalyzeJobRequest` in `shared/types/job.ts` to validate the optional `profileData` and `rescore` shapes. Add `resolveScoringProfile` in `functions/src/services/profileFingerprint.ts`. This makes T032 pass.
- [ ] T037 Update `functions/src/services/profileRepository.ts` and `functions/src/models/user.ts` to make T031 pass:
  - `ProfileEntity` gains the optional JSON columns `fingerprintHistory`, `preferences` and `confirmedSkills`;
  - `StoredProfile` gains `fingerprint`, computed on read with `profileFingerprint(profileToPromptText(stored))`;
  - `putProfile` reads the existing row, merges the body over it, prepends the old fingerprint to `fingerprintHistory` when it changed (capped at 20), and writes with `upsertEntity(…, "Replace")` carrying **all** columns;
  - `isProfilePutBody` accepts the optional `preferences` (or `null`) and `confirmedSkills`, structurally only. Detailed validation lands in US4 and US5.
  Return `fingerprint` from the GET and PUT handlers in `functions/src/profile/index.ts`.
- [ ] T038 Create `shared/fitView.ts` with `normalizeFit`, `NormalizedFit`, `Verdict` and `Freshness` per [data-model.md §2](./data-model.md), to make T027 and T028 pass. Keep it pure TypeScript with no DOM, `chrome` or `fetch` imports.
- [ ] T039 [P] Add `fingerprint: string` to `web/src/api/types.ts` `ProfilePayload` and `fingerprint` to the extension's `CandidateProfile` in `extension/types/job.ts`. Both are optional on read, so an older backend still type-checks at runtime.

**Checkpoint**: shared types, fingerprinting and merge-PUT are in place, with no user-visible change yet.

---

## Phase 4: User Story 1 — I can trust that a score reflects my current profile (Priority: P1) 🎯 MVP

**Goal**: every fit records its profile version. Out-of-date fits are marked everywhere and offer a source-appropriate rescore with a stated cost. Dealbreaker violations are enforced on the server and shown in a banner. A taken-down posting keeps its score with a note.

**Independent test**: [quickstart.md § PR2](./quickstart.md#pr2--us1--us2-freshness-dealbreakers-rubric-verdict), steps P2-1 to P2-8 and P2-11 to P2-14.

### Tests for User Story 1 (write first, must fail) ⚠️

- [ ] T040 [P] [US1] Add the recorded fixtures `functions/tests/fixtures/jobAnalysis/dealbreaker-onsite.json` and `functions/tests/fixtures/jobAnalysis/dealbreaker-paraphrased.json`:
  - `dealbreaker-onsite.json`: an on-site posting with `fit.score: 72` and `fit.dealbreakersViolated: ["No fully on-site roles"]`.
  - `dealbreaker-paraphrased.json`: `dealbreakersViolated: ["no on-site"]`, plus one unrelated entry, `"Must sponsor visas"`.
  Update the folder README with what each fixture proves.
- [ ] T041 [P] [US1] Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts` for `resolveDealbreakers` ([research R8](./research.md#r8--server-validated-dealbreakers-and-the-rubric-pr2-fr-005fr-008)):
  - with `dealbreaker-onsite` and the profile dealbreaker "No fully on-site roles", the violation keeps the user's exact wording and **the score stays 72** (FR-005: violations never change the score);
  - with `dealbreaker-paraphrased`, "no on-site" maps by containment to the user's line, and the unmatched entry is kept with exactly one warning;
  - the step never changes `score`, with or without violations;
  - the system prompt no longer contains "cap fit.score at 20", and does contain the instructions to not lower the score for dealbreakers and to name each violated dealbreaker in the rationale (research R8);
  - no profile gives `fit: null` with no `dealbreakersViolated`;
  - `fit.profileFingerprint` equals `fingerprintForRequest(req)` whenever `fit` is non-null;
  - the schema sent to the model includes `fit.dealbreakersViolated` as a required string array with `maxItems: 10`.
- [ ] T042 [P] [US1] Write `functions/tests/unit/rescoreEligibility.test.ts` for the pure `decideRescoreCharge({ intent, currentFingerprint, savedFit, fingerprintHistory, rescoresUsed })`. It covers every row of [research R6's eligibility rule](./research.md#r6--free-rescore-metering-pr2-fr-004fr-004a-constitution-v):
  - no intent, or no profile, charges an analysis;
  - a saved fit with an absent fingerprint charges a rescore;
  - a saved fit with a different fingerprint charges a rescore;
  - a saved fit with the same fingerprint charges an analysis, even when the claimed prior differs;
  - no saved row and a claimed prior in history that differs from current charges a rescore;
  - a claimed prior not in history charges an analysis;
  - a `null` claimed prior with no saved row charges an analysis;
  - an eligible request with `rescoresUsed` at 10 or more charges an analysis;
  - a saved row with `fit: null` charges an analysis.
- [ ] T043 [P] [US1] Extend `functions/tests/integration/metering.test.ts` (Azurite) for the **Replace hazard (trap 1)**: do a free rescore, then an ordinary analysis, and assert `rescoresUsed === 1` and `count === 1` on the row. Also cover:
  - parallel rescores at `rescoresUsed: 9` produce exactly one free rescore, and the rest fall back to analyses;
  - a refund decrements the counter that was charged;
  - a row written before 006 without the new columns reads them as 0.
- [ ] T044 [P] [US1] Write `functions/tests/integration/rescore.test.ts` (Azurite, recorded model fixtures), using `functions/tests/helpers/savedJobsSeeder.ts`. Cover:
  - a rescore of a saved stale posting returns `usage.charged: "rescore"`, plus `rescoresUsed` and `rescoresLimit: 10`;
  - with the allowance exhausted (`count === limit`) but free rescores left, the rescore still returns 200;
  - with both exhausted, it returns 429 `USAGE_LIMIT_REACHED`, whose `usage` includes `rescoresUsed`;
  - a model 5xx leaves `rescoresUsed` unchanged;
  - a rescore whose fixture returns `isJobPosting: false` without `assumeJobPosting` gives `postingUnavailable: true` and `usage.charged: "none"`, and `unavailableRefunds` goes up by one;
  - an 11th unavailable refund in the month is not granted;
  - the same flows run through `analyze-document` using `functions/tests/fixtures/documents/valid.docx`, whose saved row is keyed by `sha256("doc:" + sha256(text))`.
- [ ] T045 [P] [US1] Extend `functions/tests/unit/analyze-job.handler.test.ts` for the **charge-after-validation side fix** ([contracts/analyze-api.md §4](./contracts/analyze-api.md)): an invalid JSON body (400), a missing extract (400) and an oversized `mainText` (413) each leave the metering mock **uncalled**.
- [ ] T046 [P] [US1] Extend `functions/tests/unit/savedJobsRepository.test.ts` and `functions/tests/integration/storageApi.test.ts` per [contracts/saved-jobs-api.md §4](./contracts/saved-jobs-api.md):
  - `PATCH {unavailableAt}` round-trips through GET and list;
  - a PATCH with `analysis` clears it, and so does a PUT;
  - an invalid date returns 400;
  - `PATCH {status}` preserves it.
- [ ] T047 [P] [US1] Add the freshness and rescore cases to `shared/fitView.fixtures.ts` as `FRESHNESS_CASES`, `RESCORE_ACTION_CASES` and `COST_LINE_CASES`:
  - every row of the data-model §2 freshness table;
  - `rescoreAction` for each `source` × freshness, plus `unavailableAt`, covering the research R7 table and including the paste copy "Paste again in the extension to rescore" for the web context (`surface: "web"`);
  - `rescoreCostLine` for 7 of 10 left ("Free — 7 of 10 free rescores left this month"), 0 left with allowance left ("Uses 1 analysis"), and both exhausted.
  Extend both `fitView.test.ts` suites (T028) to iterate them.
- [ ] T048 [P] [US1] Extend `extension/tests/unit/jobFlow.test.ts` and `extension/tests/unit/revisitFlow.test.ts`:
  - a revisit with a stored fit whose fingerprint differs from `getProfile().fingerprint` broadcasts the stored result with `currentProfileFingerprint` set, and does **not** call `postJobAnalysis`. This replaces the old auto-refresh expectation.
  - pre-breakdown fits and null fits are no longer auto-refreshed;
  - a revisit writes `profile:fingerprint` to `chrome.storage.session`;
  - a Rescore message sends `rescore: { priorFingerprint }`, `profileData` and `profile`, and PATCHes the saved entry's `analysis`;
  - thin content with a saved entry broadcasts the stored result with `postingUnavailable: false` and no request;
  - a Rescore from that state PATCHes `unavailableAt` and sends no request;
  - a `postingUnavailable: true` response keeps the stored analysis and PATCHes `unavailableAt`.
- [ ] T049 [P] [US1] Extend `extension/tests/unit/jobAnalysisClient.test.ts`. The request body includes `profileData`, `profile` and, when given, `rescore`. The response's `usage` (with `charged`, `rescoresUsed` and `rescoresLimit`) and `postingUnavailable` are surfaced to the caller.
- [ ] T050 [US1] Write the **FR-001 / SC-006 contract tests**:
  - in `extension/tests/unit/jobFlow.test.ts`, the page, paste and scoped-region flows each send `profileData` equal to the stored profile and `profile === profileToPromptText(profileData)`;
  - in `web/tests/contract/upload.test.tsx`, the web document upload sends a `profileData` form part with the same content as the extension, from one shared fixture profile.
- [ ] T051 [P] [US1] Extend `extension/tests/unit/FitScore.test.tsx`, `extension/tests/unit/ThisPageTab.test.tsx` and `extension/tests/unit/SavedTab.test.tsx`:
  - the dealbreaker banner reads "Violates your dealbreaker: <line>" for each violation, above the score (FR-006);
  - an out-of-date fit shows "Scored against an older profile" with a Rescore button and the cost line;
  - a version-unknown fit shows "May be out of date";
  - a fit whose profile was deleted shows "Scored against a deleted profile";
  - an unavailable entry shows "Posting no longer available — score can't be updated";
  - with free rescores and the allowance exhausted, the existing `UsageExhausted` card renders;
  - a `storage.onChanged` event for `profile:fingerprint` re-marks the visible result and shows the FR-007 offer to rescore without auto-running;
  - Saved tab rows show the out-of-date marker.
- [ ] T052 [P] [US1] Extend `web/tests/contract/library-view.test.tsx` and `web/tests/contract/filters.test.tsx`, and create `web/tests/contract/posting-detail.test.tsx`:
  - library rows and the detail page mark out-of-date and version-unknown fits;
  - URL-sourced rows link "Open posting to rescore" to `sourceUrl`;
  - document rows link "Upload again to rescore" to `/upload?rescore=<key>`;
  - paste rows show "Paste again in the extension to rescore";
  - a "Current profile only" filter hides non-current fits;
  - the unavailable note renders.
- [ ] T053 [P] [US1] Extend `web/tests/contract/upload.test.tsx`:
  - Upload does not send until the profile request settles, whether it succeeds or fails (spec edge case);
  - with `?rescore=<key>`, the request carries `rescore=true` and the entry's `priorFingerprint`, and a successful result PATCHes that saved entry's `analysis` in place instead of offering "Save to library";
  - when the profile fetch failed, the result shows "Fit not scored — your profile couldn't be loaded".
- [ ] T054 [US1] Write the **P1 E2E test** `extension/tests/e2e/profileFreshness.spec.ts`, using the existing `fixtures.ts` harness and localhost fixture server:
  1. analyze a posting and save it;
  2. change the profile through the options page;
  3. the panel shows the out-of-date notice and the Rescore cost line;
  4. Rescore clears the notice;
  5. serve a thin stub at the same URL, then Rescore shows "Posting no longer available" and makes no network call to analyze-job (assert with route interception).

### Implementation for User Story 1

- [ ] T055 [US1] Add `resolveDealbreakers(payload, dealbreakerLines, warn)` to `functions/src/services/jobExtractionOrchestrator.ts`. It runs after `enforceConsistency`. Wire it in:
  - add `fit.dealbreakersViolated` (array of string, `maxItems: 10`, required) to `JOB_ANALYSIS_SCHEMA`;
  - **remove** today's prompt line "If the posting violates any stated dealbreaker in the profile, cap fit.score at 20 or below and name the dealbreaker in the rationale";
  - add the system-prompt lines "fit.score measures only how well the posting matches the candidate's skills, experience and seniority; do not lower it for dealbreakers", "copy each violated dealbreaker exactly as written in the profile into dealbreakersViolated, and also name it in the rationale" and "a fact the posting does not state is not a violation — add an `Unverified: …` weakness instead";
  - the step never reads or writes `score`;
  - source dealbreaker lines from `req.profileData?.dealbreakers ?? dealbreakerLinesFromPrompt(req.profile)`;
  - build the user message from `resolveScoringProfile(req)`;
  - stamp `fit.profileFingerprint`.
  This makes T041 pass.
- [ ] T056 [US1] Implement `functions/src/services/rescoreEligibility.ts`, exporting the pure `decideRescoreCharge`, to make T042 pass. Add `FREE_RESCORES_PER_MONTH = 10` and `UNAVAILABLE_REFUNDS_PER_MONTH = 10` next to `MONTHLY_ANALYSES` in `functions/src/models/user.ts`, and add `rescoresUsed?` and `unavailableRefunds?` to `UsageEntity`.
- [ ] T057 [US1] Extend `functions/src/services/meteringService.ts`:
  - switch every `updateEntity` in `checkAndIncrement` and `refundOnSystemFailure` from `"Replace"` to `"Merge"` with the same ETag (trap 1);
  - add `chargeAnalysis(sub, tier, decision)`, which returns `{ charged: "rescore" | "analysis", allowed, usage }`. A rescore increments `rescoresUsed` if it is below 10 and otherwise falls back to `count`.
  - add `refundCharge(sub, tier, charged)` and `grantUnavailableRefund(sub, tier, charged)`, which checks `unavailableRefunds < 10`, decrements the charged counter, and increments `unavailableRefunds`;
  - make `peekUsage` return `rescoresUsed` and `rescoresLimit`.
  This makes T043 pass.
- [ ] T058 [US1] Restructure `functions/src/analyze-job/index.ts` to validate, then charge, then call the model (contracts/analyze-api.md §2):
  - remove `withUsageMetering` from the route composition, keeping `withRateLimit(withAuth(handler))`;
  - after validation, look up the saved row with `getJob(user.sub, sha256Hex(extract.canonicalUrl))` and the profile's `fingerprintHistory` only when `body.rescore` is present;
  - call `decideRescoreCharge`, then `chargeAnalysis`, and return 429 as before when not allowed;
  - after the model call, apply the unavailable-refund rule;
  - refund the charged counter on 5xx;
  - echo `usage` with `charged`, `rescoresUsed` and `rescoresLimit`.
  Delete `withUsageMetering` if nothing else uses it (Constitution I, no dead code). This makes T044 (job part) and T045 pass.
- [ ] T059 [US1] Apply the same flow in `functions/src/analyze-document/index.ts`:
  - parse the `profileData`, `rescore` and `priorFingerprint` form parts, returning 400 if `profileData` is malformed;
  - compute the saved key from the server-computed `doc:` canonical URL, after `extractDocument` and before charging;
  - use `chargeAnalysis`, `refundCharge` and `grantUnavailableRefund`.
  This makes the T044 document part pass.
- [ ] T060 [US1] Add `unavailableAt` per [contracts/saved-jobs-api.md](./contracts/saved-jobs-api.md):
  - add the column to `SavedJobEntity`;
  - add `unavailableAt?: string | null` to `SavedJobPayload` and `SavedJobPatchBody` in `functions/src/models/user.ts`;
  - validate it as an ISO date in `isSavedJobPatchBody`;
  - map it in `entityFromPayload` and `payloadFromEntity` in `functions/src/services/savedJobsRepository.ts`, and clear it in `patchJob` and `saveJob` whenever `analysis` is written.
  This makes T046 pass. Mirror the field in `web/src/api/types.ts` and in the extension's `SavedJob` type in `extension/types/job.ts`.
- [ ] T061 [US1] Add `freshness`, `rescoreAction` and `rescoreCostLine` to `shared/fitView.ts` to make the T047 cases pass in both suites.
- [ ] T062 [US1] Update `extension/services/profileStorage.ts`:
  - `getProfile` and `setProfile` write `chrome.storage.session` key `profile:fingerprint` as `{ value, fetchedAt }`, with `null` meaning no profile (404) and the value left untouched on fetch failure;
  - export `getCachedFingerprint()` and `toScoringProfile(profile)`.
- [ ] T063 [US1] Update `extension/services/jobAnalysisClient.ts` to send `profileData`, `profile` and the optional `rescore`, and to return `{ analysis, usage, postingUnavailable }` while keeping the existing error mapping. This makes T049 pass. Update the callers in `extension/services/jobFlow.ts` to the new return shape.
- [ ] T064 [US1] Update `extension/services/jobFlow.ts` to make T048 and T050 pass:
  - delete `needsFitRefresh` and its two auto-refresh branches (research R7);
  - every result broadcast carries `currentProfileFingerprint`;
  - a new `RESCORE_JOB_PAGE` message runs with `bypassCache`, `rescore: { priorFingerprint }` and `profileData`;
  - reorder the thin-content check so that a saved entry for the canonical URL is shown first;
  - a Rescore on thin content, or a `postingUnavailable` response, PATCHes `unavailableAt` through `jobStorage.update` and keeps the stored analysis;
  - the paste and scoped-region flows send `profileData`.
  Add the new message types and fields to `extension/types/messages.ts`.
- [ ] T065 [US1] Implement the extension UI to make T051 pass:
  - in `extension/components/JobPanel/FitScore.tsx`, the dealbreaker banner above the score, the freshness notice with Rescore and the cost line from `rescoreCostLine`, and the unavailable note;
  - in `extension/components/JobPanel/ThisPageTab.tsx`, the Rescore dispatch, the `UsageExhausted` fallback, and the FR-007 offer through `chrome.storage.onChanged`;
  - in `extension/components/JobPanel/SavedJobRow.tsx`, the row marker and the "Open posting to rescore" or "Paste again to rescore" action from `rescoreAction`;
  - in `extension/entrypoints/options/OptionsApp.tsx`, writing `profile:fingerprint` after save through `setProfile`.
  Get the cost line's usage numbers from `extension/services/accountService.ts` `fetchAccount()`, extended with `rescoresUsed` and `rescoresLimit`. Use only spec-vocabulary copy: "Rescore", "out of date", "Dealbreaker".
- [ ] T066 [US1] Add `rescoresUsed` and `rescoresLimit` to the `/api/account` usage response in `functions/src/billing/index.ts`, from `peekUsage`. Extend `functions/tests/integration/billing.test.ts` with the assertion, written first.
- [ ] T067 [US1] Implement the web side to make T052 and T053 pass:
  - in `web/src/api/endpoints.ts`, `analyzeDocument` sends `profileData`, `rescore` and `priorFingerprint`, and gains a `patchJob` function;
  - add the freshness marker and the `rescoreAction` link to `web/src/pages/Library.tsx` and `web/src/pages/PostingDetail.tsx`;
  - add the "Current profile only" toggle to `web/src/components/LibraryControls.tsx` and `web/src/lib/libraryQuery.ts`, using `freshness`;
  - in `web/src/pages/Upload.tsx`, gate Upload on profile settlement, support `?rescore=<key>` with PATCH in place, and show the profile-failed message;
  - in `web/src/components/AnalysisView.tsx`, show the dealbreaker banner.
- [ ] T068 [US1] Run `npm run build` in `extension/`, then the P1 E2E test (T054), and fix until green.

**Checkpoint**: US1 is fully functional. Scores are trustworthy across all four surfaces, with dealbreakers listed next to an unchanged score, and free-rescore metering.

---

## Phase 5: User Story 2 — I understand what a score means at a glance (Priority: P2)

**Goal**: the model scores against an explicit rubric. Every fit scored under this feature shows a verdict from one shared mapping, with a text label, an icon and a screen-reader label. Legacy fits show "Unrated — rescore for a verdict".

**Independent test**: [quickstart.md § PR2](./quickstart.md#pr2--us1--us2-freshness-dealbreakers-rubric-verdict), steps P2-9 and P2-10, plus verdict consistency across the extension and the web.

### Tests for User Story 2 (write first, must fail) ⚠️

- [ ] T069 [P] [US2] Add `VERDICT_CASES` to `shared/fitView.fixtures.ts` and iterate them in both `fitView.test.ts` suites. Cover:
  - the boundaries 0, 39, 40, 64, 65, 84, 85 and 100;
  - a dealbreaker with score 95, which maps to `dealbreaker`;
  - no fingerprint, which maps to `unrated` with the label "Unrated — rescore for a verdict";
  - `ariaFitLabel` returning "Strong match, fit 86 out of 100" and "Unrated, fit 72 out of 100";
  - `verdictLabel` copy for all six values, exactly as in the spec;
  - `previewMissing(fit)` returning the first 3 items.
- [ ] T070 [P] [US2] Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts`: the system prompt sent with a profile contains the four FR-008 rubric bands, with their exact numeric ranges and descriptions.
- [ ] T071 [P] [US2] Extend `extension/tests/unit/FitScore.test.tsx` and `extension/tests/unit/SavedTab.test.tsx`:
  - the verdict label and icon render next to the score;
  - the score element's accessible name equals `ariaFitLabel`;
  - labels are present as text, so FR-010 doesn't rely on colour;
  - a legacy fit shows the Unrated label;
  - "My profile" is a secondary button, not the filled primary style (FR-024);
  - the default view shows the verdict, score, rationale and up to 3 missing items, and "Show full breakdown" reveals the rest (FR-025);
  - `SavedJobRow` uses the shared tone, and no `scoreStyle` import remains.
- [ ] T072 [P] [US2] Extend `web/tests/contract/library-view.test.tsx` and `web/tests/contract/posting-detail.test.tsx`: verdict labels and accessible names on rows and detail match the extension's for the same fixture fit, and legacy fits are Unrated.

### Implementation for User Story 2

- [ ] T073 [US2] Add the FR-008 rubric lines to `buildSystemPrompt` in `functions/src/services/jobExtractionOrchestrator.ts`:
  - 85–100: all required skills covered and seniority aligned;
  - 65–84: minor gaps;
  - 40–64: significant gaps or a level mismatch;
  - 0–39: major mismatch.
  This makes T070 pass.
- [ ] T074 [US2] Add `verdictFor`, `verdictLabel`, `scoreTone`, `ariaFitLabel` and `previewMissing` to `shared/fitView.ts` to make T069 pass.
- [ ] T075 [US2] Update `extension/components/JobPanel/FitScore.tsx` and `extension/components/JobPanel/SavedJobRow.tsx` to make T071 pass:
  - delete `scoreStyle` with its hard-coded 70/20 thresholds;
  - map `scoreTone` to Tailwind classes and an inline SVG icon per verdict in one local map;
  - restyle "My profile" as secondary;
  - add the collapsed default view with a "Show full breakdown" toggle that has `aria-expanded`.
- [ ] T076 [US2] Update `web/src/components/AnalysisView.tsx`, `web/src/pages/Library.tsx` and `web/src/pages/PostingDetail.tsx` to show the verdict label and icon using `scoreTone`, `verdictLabel` and `ariaFitLabel`. Use a web-local class map, because Tailwind classes are not shared (contracts/fit-view.md). This makes T072 pass.
- [ ] T077 [US2] Re-run the eval with field-based detection **(live, the chosen free and Premium configurations only, `--runs=5`)** using `npm run eval:postings -- --configs=<chosen-only file> --out=../specs/006-profile-match-ux/eval-runs/pr2.json`. Run the violating pairs a second time with each profile's dealbreakers and preferences removed, for SC-002's score-independence check. Append a "PR2 — rubric and dealbreakers listed without changing the score" table to `specs/006-profile-match-ux/eval-models.md`, with SC-002, SC-004 and SC-008 now measured with `detectionMethod: "field"`. If SC-004 or score independence drops below 90%, stop and report to the user before merging (research R8 names the fallback).
- [ ] T078 [US2] Run the PR2 gate:
  - lint, tests and coverage (at least 80% on `rescoreEligibility.ts`, `meteringService.ts`, `profileRepository.ts`, `profileFingerprint.ts`, `jobExtractionOrchestrator.ts`, `savedJobsRepository.ts`, `shared/fitView.ts`, `jobFlow.ts`, `FitScore.tsx` and `libraryQuery.ts`);
  - `perf.test.ts` against the T001 baseline;
  - the compatibility smoke (rule 3), including an **old-extension profile save that must not erase anything** and old-extension rendering of a PR2-shaped saved fit.
  Request QG-3 review of the score header, banner and cost line, then open PR2 (US1 + US2).

**Checkpoint**: PR2 is shippable. Out-of-date, dealbreaker and verdict UI works on both surfaces, and old extensions keep working.

---

## Phase 6: User Story 3 — I can verify why a skill counts as matched or missing (Priority: P3) — PR3

**Goal**: matching, missing and desired items carry verbatim posting quotes, and matching items also carry profile quotes. Quotes are validated on the server, hidden until requested, and absent on legacy fits.

**Independent test**: [quickstart.md § PR3](./quickstart.md#pr3--us3-evidence).

### Tests for User Story 3 (write first, must fail) ⚠️

- [ ] T079 [P] [US3] Add the recorded fixtures `functions/tests/fixtures/jobAnalysis/with-evidence.json` and `functions/tests/fixtures/jobAnalysis/fabricated-quote.json`, in the **model-facing** shape where `matching`, `missing` and `desired` are `{label, postingQuote, profileQuote}` arrays.
  - `with-evidence.json`: every quote is a verbatim substring of the paired posting and profile text in the test.
  - `fabricated-quote.json`: one postingQuote and one profileQuote are not substrings, and one quote is 260 characters long.
  Update the README.
- [ ] T080 [P] [US3] Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts` for wire shape (trap 3) and validation:
  - the response's `fit.matching`, `fit.missing` and `fit.desired` are **string arrays of labels**;
  - `fit.evidence.matching[i]` is `{label, postingQuote, profileQuote}`;
  - a fabricated quote becomes `null`, its item and label are kept, and one warning is logged per dropped quote;
  - the 260-character quote is truncated to 200 after validation;
  - `profileQuote` is `null` for missing and desired items;
  - evidence whose label is not in its list is dropped;
  - the existing arrangement-evidence behaviour is unchanged (the existing tests stay green).
- [ ] T081 [P] [US3] Add `EVIDENCE_CASES` to `shared/fitView.fixtures.ts`, covering `evidenceFor(fit, list, label)` finding by label, returning `null` for legacy fits and returning `null` for unknown labels. Iterate them in both suites.
- [ ] T082 [P] [US3] Extend `extension/tests/unit/FitScore.test.tsx`:
  - a chip with evidence shows a disclosure button with `aria-expanded="false"`;
  - Enter or Space and a click both reveal the posting quote, plus the profile quote for matching items;
  - the collapsed render adds no height, so the evidence region is not in the DOM until expanded (FR-013);
  - chips without evidence have no button and log no console error;
  - a legacy fit renders exactly as before.
- [ ] T083 [P] [US3] Create `web/tests/contract/evidence.test.tsx` with the same assertions for `web/src/components/AnalysisView.tsx`.

### Implementation for User Story 3

- [ ] T084 [US3] In `functions/src/services/jobExtractionOrchestrator.ts`, make T080 pass:
  - change the model schema's `fit.matching`, `fit.missing` and `fit.desired` to arrays of `{label, postingQuote: string|null, profileQuote: string|null}`, keeping `maxItems` at 8 for matching and missing and 10 for desired (research R9);
  - add prompt lines asking for the shortest verbatim supporting span, with `profileQuote` null for missing and desired;
  - generalize `validateEvidence` into `validateQuotes(payload, postingHaystack, profileHaystack, warn)`;
  - add `splitEvidence(modelFit)`, which produces the label arrays plus `fit.evidence`;
  - keep a separate internal `ModelJobAnalysisPayload` type, so the wire `JobAnalysisPayload` type is unchanged apart from `evidence`.
- [ ] T085 [US3] Add `evidence?: FitEvidence` and `EvidenceItem` to `Fit` in `shared/types/job.ts`, and `evidenceFor` to `shared/fitView.ts`. This makes T081 pass.
- [ ] T086 [US3] Add the chip evidence disclosure to `extension/components/JobPanel/FitScore.tsx` (T082) and to `web/src/components/AnalysisView.tsx` (T083). Quotes render as `<blockquote>` with a source label ("From the posting" or "From your profile").
- [ ] T087 [US3] Measure evidence **(live, the chosen free configuration plus Premium, `--runs=3`)** and write `eval-runs/pr3.json`. Append a "PR3 — evidence" table to `specs/006-profile-match-ux/eval-models.md` with:
  - the SC-003 verbatim rate (target at least 95%);
  - the cost-per-analysis delta against `pr2.json`;
  - the p95 delta;
  - truncation count.
  If truncations are above 0, raise `max_completion_tokens` in the orchestrator and re-measure.
- [ ] T088 [US3] Run the PR3 gate: lint, tests, coverage on `jobExtractionOrchestrator.ts`, `fitView.ts`, `FitScore.tsx` and `AnalysisView.tsx`, `perf.test.ts`, and the compatibility smoke. Rule 3 matters most here, because an old extension must render a PR3 fit without crashing.
  - If p95 rose 20% or more against the T001 baseline, write a QG-4 exception in the PR description, with the numbers from T087 and the absolute p95 against 30 s, and ask the user to approve it.
  - If the cost per analysis rose, state it as a feature cost and ask the user to confirm it is acceptable under FR-M05 (research R9).
  Then open PR3.

**Checkpoint**: evidence is visible and verifiable, and legacy fits are unaffected.

---

## Phase 7: User Story 4 — Setting up my profile is quick (Priority: P4) — PR4

**Goal**: import a résumé from `.pdf` or `.docx` with nothing stored, and add structured preferences. Arrangement, salary and seniority are checked in code. Location is judged by the model.

**Independent test**: [quickstart.md § PR4](./quickstart.md#pr4--us4-profile-setup).

### Tests for User Story 4 (write first, must fail) ⚠️

- [ ] T089 [P] [US4] Write `functions/tests/unit/profileImport.handler.test.ts` for `POST /api/profile/import` ([contracts/profile-api.md §4](./contracts/profile-api.md)):
  - `valid.pdf` and `valid.docx` from `functions/tests/fixtures/documents/` return 200 with `{text, charCount}`;
  - `oversized.pdf` returns 413, `mislabeled.pdf` 415, `encrypted.pdf` and `encrypted.docx` 422 `FILE_PASSWORD_PROTECTED`, and `image-only.pdf` 422 `FILE_NO_TEXT` with the **same message** as analyze-document;
  - a missing file part returns 400;
  - spy on `ensureTable` and on `meteringService` and assert neither is called (R12);
  - assert that no `context.log`, `context.warn` or `context.error` argument contains the extracted text;
  - text above 20,000 characters is returned whole.
- [ ] T090 [P] [US4] Extend `functions/tests/unit/profileSerialization.test.ts`:
  - the Preferences section renders exactly as in [data-model.md §3](./data-model.md) for each preference;
  - it is omitted when `preferences` is absent or empty;
  - **the T029 invariant snapshot cases are still byte-identical**;
  - the fingerprint of a profile without preferences is unchanged from PR2.
- [ ] T091 [P] [US4] Write `functions/tests/unit/applyPreferences.test.ts` for the pure `applyPreferences(payload, preferences)`, covering every row of [research R11's table](./research.md#r11--structured-preferences-pr4-fr-015fr-016):
  - an on-site posting with explicit evidence against "remote only" is a violation labelled "Arrangement: remote only", with the score unchanged;
  - an `unspecified` arrangement gives no violation and an "Unverified: arrangement not stated" weakness;
  - an on-site posting with `arrangementConfidence: "none"` gives no violation;
  - a salary max of 100k USD/year against a 120k USD/year minimum is a violation;
  - EUR against USD gives no violation and an unverified note;
  - a different pay period gives the same unverified result;
  - no salary gives an unverified note;
  - seniority outside the range is a violation, and `unspecified` gives an unverified note;
  - a location preference is never checked in code, and a model-reported location violation is kept as-is;
  - unverified notes are prepended and `weaknesses` stays at 5 or fewer;
  - with no preferences, the payload is unchanged.
- [ ] T092 [P] [US4] Extend `functions/tests/unit/profileRepository.test.ts` and `functions/tests/integration/storageApi.test.ts`:
  - preferences validate per data-model §3 (empty `arrangements`, `amount <= 0`, an unknown currency format, and `min > max` all return 400);
  - `schemaVersion` becomes 2 on write;
  - a version-1 row reads as having no preferences;
  - an old-shape PUT keeps preferences (trap 2, repeated now that the field exists).
- [ ] T093 [P] [US4] Extend `extension/tests/unit/apiClient.test.ts`: `apiFetch` with `rawBody: FormData` sends it untouched and sets no JSON content type, while JSON `body` behaviour is unchanged.
- [ ] T094 [P] [US4] Extend `extension/tests/unit/OptionsApp.test.tsx` and create `web/tests/contract/profile-import.test.tsx`:
  - choosing a `.pdf` calls the import endpoint, fills the editor with the returned text, and does **not** save until Save is clicked;
  - the import error message matches the job-upload copy;
  - text over 20,000 characters shows the existing over-limit message;
  - the preference fields (arrangement checkboxes, minimum salary with amount, currency and period, seniority min/max selects in enum order with management levels last, and free-text locations) save through PUT and reload;
  - every field has an accessible label.

### Implementation for User Story 4

- [ ] T095 [US4] Implement `POST /api/profile/import` in `functions/src/profile/index.ts`, as a new `app.http("profile-import")` with `route: "profile/import"`, `withRateLimit("analyze", withAuth(...))`, and a preflight route mirroring `profile-preflight`. Reuse `extractDocument` and the `REJECTION_STATUS` map. Move that map to `functions/src/services/documentExtraction.ts` and import it in both handlers, to avoid duplicating it. This makes T089 pass.
- [ ] T096 [US4] Add `Preferences` to `shared/types/profile.ts` and the Preferences section to `profileToPromptText`. This makes T090 pass.
- [ ] T097 [US4] Add preferences validation and `schemaVersion: 2` to `functions/src/models/user.ts` and `functions/src/services/profileRepository.ts`, to make T092 pass.
- [ ] T098 [US4] Implement `applyPreferences` in a new file, `functions/src/services/applyPreferences.ts`, to make T091 pass. Call it from `orchestrateJobAnalysis` after `resolveDealbreakers`, with `req.profileData?.preferences`. Merge its violations into `fit.dealbreakersViolated`. Never change `score`.
- [ ] T099 [US4] Add a `rawBody` option to `extension/services/api/apiClient.ts`, mirroring `web/src/api/apiClient.ts`. Add `importResume(file)` to `extension/services/profileStorage.ts`. This makes T093 pass.
- [ ] T100 [US4] Add the import control and preference fields to `extension/entrypoints/options/OptionsApp.tsx`, and add the same to `web/src/pages/Profile.tsx` with `importResume` in `web/src/api/endpoints.ts`. Show a progress indicator during import (Principle III, over 300 ms). This makes T094 pass.
- [ ] T101 [US4] Ensure every analyze flow sends `profileData.preferences`. In `extension/services/jobFlow.ts` and `web/src/pages/Upload.tsx`, build `profileData` with `toScoringProfile`. Extend the FR-001 contract tests (T050) to include a profile with preferences.
- [ ] T102 [US4] Run the live checks from quickstart P4-5 (location preference) **(live)**. Then time SC-005 by hand: a first-time user with `valid.pdf` must reach a first fit score in under 2 minutes from opening the editor. Record both in the PR description.
- [ ] T103 [US4] Run the PR4 gate: lint, tests, coverage on `applyPreferences.ts`, `profileRepository.ts`, `profile/index.ts`, `apiClient.ts`, `OptionsApp.tsx` and `Profile.tsx`, `perf.test.ts`, and the compatibility smoke. Rule 3 here includes an old-extension profile save after setting preferences on the web. Then open PR4.

**Checkpoint**: profile setup is fast, and preference dealbreakers are enforced deterministically.

---

## Phase 8: User Story 5 — I can correct a wrong verdict in one click (Priority: P5) — PR5

**Goal**: "I have this" on missing and desired chips adds a confirmed skill, saves, marks the fit out of date, and offers a rescore that never runs automatically.

**Independent test**: [quickstart.md § PR5](./quickstart.md#pr5--us5-i-have-this).

### Tests for User Story 5 (write first, must fail) ⚠️

- [ ] T104 [P] [US5] Extend `functions/tests/unit/profileRepository.test.ts` and `functions/tests/integration/storageApi.test.ts`:
  - `confirmedSkills` are trimmed and deduplicated case-insensitively, keeping the first spelling;
  - `[]` clears them;
  - a serialized length (text plus the Confirmed skills section) over 20,000 returns 400 `PROFILE_TOO_LONG` with the existing over-limit wording, and nothing is truncated;
  - an old-shape PUT keeps `confirmedSkills`.
- [ ] T105 [P] [US5] Extend `functions/tests/unit/profileSerialization.test.ts`: the Confirmed skills section renders after Preferences and is omitted when empty, and the T029 invariant cases are still byte-identical.
- [ ] T106 [P] [US5] Extend `extension/tests/unit/FitScore.test.tsx`, `extension/tests/unit/ThisPageTab.test.tsx` and `web/tests/contract/posting-detail.test.tsx`:
  - missing and desired chips show "I have this", with an accessible name of "I have <label>";
  - clicking it PUTs the profile with the label appended (no duplicate, ignoring case);
  - on success, the fit is marked out of date and "Rescore this posting" is offered with its cost line, and **no** analyze request is made;
  - on failure (offline or 5xx), the chip is unchanged, the existing save-error message shows, and no rescore is offered;
  - at the cap, the over-limit message shows;
  - on the web, the offer is the source-appropriate `rescoreAction` (FR-020).
- [ ] T107 [P] [US5] Extend `extension/tests/unit/OptionsApp.test.tsx` and `web/tests/contract/profile-dealbreakers.test.tsx`: the confirmed skills are listed, each has a remove button labelled "Remove <skill>", and removing one saves.

### Implementation for User Story 5

- [ ] T108 [US5] Add `confirmedSkills` normalization and the serialized-length cap to `functions/src/services/profileRepository.ts` and `functions/src/models/user.ts`, replacing silent truncation with `PROFILE_TOO_LONG`. Add the Confirmed skills section to `profileToPromptText` in `shared/types/profile.ts`. This makes T104 and T105 pass.
- [ ] T109 [US5] Add `confirmSkill(label)` to `extension/services/profileStorage.ts`, which re-fetches, appends with deduplication, and calls `setProfile`. Add the "I have this" control and the post-save rescore offer to `extension/components/JobPanel/FitScore.tsx` and `extension/components/JobPanel/ThisPageTab.tsx`. This makes the extension part of T106 pass.
- [ ] T110 [US5] Add the same control to `web/src/components/AnalysisView.tsx` and `web/src/pages/PostingDetail.tsx`, using `saveProfile` in `web/src/api/endpoints.ts` and showing `rescoreAction` afterwards. This makes the web part of T106 pass.
- [ ] T111 [US5] Add the removable confirmed-skills list to `extension/entrypoints/options/OptionsApp.tsx` and `web/src/pages/Profile.tsx`, to make T107 pass.
- [ ] T112 [US5] Check SC-007 by hand: from "Missing: X", count clicks to a rescored result, which must be 2 or fewer. Then run the PR5 gate (lint, tests, coverage, perf and the compatibility smoke) and open PR5.

**Checkpoint**: users can fix a wrong "missing" verdict in place.

---

## Phase 9: User Story 6 — I can triage and compare by fit wherever I am (Priority: P6) — PR6

**Goal**: the extension's Saved tab sorts and filters by fit and verdict, and the web Compare view becomes a requirement-by-requirement table.

**Independent test**: [quickstart.md § PR6](./quickstart.md#pr6--us6-triage-and-compare).

### Tests for User Story 6 (write first, must fail) ⚠️

- [ ] T113 [P] [US6] Add `SORT_CASES`, `FILTER_CASES` and `MERGE_CASES` to `shared/fitView.fixtures.ts` and iterate them in both suites:
  - `sortByFit` in both directions puts unscored jobs last in each, while out-of-date and unrated fits sort by number;
  - `filterByVerdict` never matches `unrated`;
  - `mergeRequirementRows` merges "Kubernetes" with "kubernetes " and " KUBERNETES";
  - cell states come from each posting's lists: matching is `matched`, missing is `missing`, desired is `nice-to-have`, and anything else is `not-asked`;
  - row order is by number of postings that ask, then alphabetical.
- [ ] T114 [P] [US6] Extend `extension/tests/unit/SavedTab.test.tsx` with "Fit (highest)" and "Fit (lowest)" sort options, the verdict filter, unscored jobs last, and out-of-date markers kept.
- [ ] T115 [P] [US6] Extend `web/tests/contract/compare.test.tsx`:
  - with 2 to 4 selected postings, the header row shows score, verdict, salary and arrangement;
  - the body has one row per merged requirement, with cell states;
  - each column links to the full analysis;
  - at a 375 px viewport, the table container has `overflow-x: auto` and the document does not scroll horizontally.
  Extend `web/tests/unit/libraryQuery.test.ts` so that its fit sorting matches `sortByFit`.

### Implementation for User Story 6

- [ ] T116 [US6] Add `sortByFit`, `filterByVerdict` and `mergeRequirementRows` to `shared/fitView.ts` to make T113 pass.
- [ ] T117 [US6] Add the sort and verdict-filter controls to `extension/components/JobPanel/SavedTab.tsx` using the shared helpers, to make T114 pass.
- [ ] T118 [US6] Rewrite `web/src/components/CompareGrid.tsx` as the requirements table, and make `web/src/lib/libraryQuery.ts` delegate fit sort and filter to `shared/fitView.ts`, removing its local `fitScore` sorting. Add a verdict filter to `web/src/components/LibraryControls.tsx`. This makes T115 pass.
- [ ] T119 [US6] Run the PR6 gate (lint, tests, coverage, perf, compatibility smoke) and request QG-3 review of the Compare table. Then open PR6.

**Checkpoint**: all six user stories are delivered.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T120 [P] Update `README.md`'s feature list and any user-facing docs under `docs/` that describe fit scoring, so they match the spec's vocabulary (verdicts, Rescore, out of date). Per the constitution, public API documentation ships in the same PR that changes it, which the `contracts/` files already cover. This task covers prose docs only.
- [ ] T121 [P] Check whether `store-submission/` listing text or screenshots describe the old fit UI ("Fit score" number only). If they do, list the needed changes in the final PR description. Do **not** submit to the Chrome Web Store, because that is an outward-facing action needing the user's approval.
- [ ] T122 Run every section of `specs/006-profile-match-ux/quickstart.md` end to end against local Azurite. Tick each step, and record any deviation as a GitHub issue labelled `needs-triage`.
- [ ] T123 Verify SC-001 by hand on the web library and the extension Saved tab with a mixed library (current, out-of-date, version-unknown, deleted-profile and unscored entries). Every visible fit is either current or carries a marker.
- [ ] T124 Run `/speckit-analyze` for cross-artifact consistency, and fix any spec, plan or tasks drift it reports in `specs/006-profile-match-ux/`.

---

## Dependencies & Execution Order

### Phase dependencies

| Phase | Depends on | Ships as |
|---|---|---|
| 1 Setup | nothing | (no PR; baselines only) |
| 2 Foundational A, model switch | Setup | **PR1** |
| 3 Foundational B, PR2 groundwork | PR1 merged **and** T025's settings switch applied, so PR2's eval (T077) runs on the final model | PR2 |
| 4 US1 | Phase 3 | PR2 |
| 5 US2 | Phase 3. T075 also edits `FitScore.tsx` after T065. | PR2 |
| 6 US3 | PR2 merged | **PR3** |
| 7 US4 | PR2 merged. Independent of US3. | **PR4** |
| 8 US5 | PR4's profile serialization (T096) and merge-PUT. Uses US1's rescore offer. | **PR5** |
| 9 US6 | PR2's `fitView` (verdicts and freshness). Independent of US3 to US5. | **PR6** |
| 10 Polish | the PRs being validated | final PR or the last story's PR |

The plan's PR order is 1 → 2 → 3 → 4 → 5 → 6. US3, US4 and US6 do not depend on each other technically, so the order is a product choice. Keeping it avoids stacking UI changes in `FitScore.tsx`.

### Within each story

- Tests marked ⚠️ are committed failing before the implementation tasks of that story.
- Shared and types first, then services, then HTTP handlers, then client services, then UI.
- Each phase ends with its PR gate, including the compatibility smoke.

### Cross-story file hotspots (sequence these, don't parallelize)

- `functions/src/services/jobExtractionOrchestrator.ts`: T010, T055, T073, T084, T098
- `shared/fitView.ts`: T038, T061, T074, T085, T116
- `extension/components/JobPanel/FitScore.tsx`: T065, T075, T086, T109
- `shared/types/profile.ts`: T034, T096, T108

## Parallel Examples

### PR1 (Phase 2)

```text
Together: T004 modelConfig.test.ts · T005 orchestrator tests (then T006, same file) · T007 handler test · T008 evalMetrics.test.ts
Together: T012 settings doc · T014 exportCorpusExtracts.ts · T016 fixture profiles · T018 modelPrices.json · T019 evalConfigs.json
```

### PR2 groundwork (Phase 3)

```text
Together: T027 fixtures · T028 both fitView suites · T029 serialization · T030 fingerprint · T031 profile repo · T032 request guard
```

### User Story 1

```text
Backend tests together: T040 fixtures · T041 dealbreakers · T042 eligibility · T043 metering · T044 rescore · T045 side fix · T046 unavailableAt
Client tests together:  T047 fitView cases · T048 jobFlow · T049 client · T051 extension UI · T052/T053 web (then T050, which shares jobFlow.test.ts and upload.test.tsx)
```

### User Stories 3, 4 and 6 after PR2 merges (if staffed)

```text
Developer A: Phase 6 (US3, evidence)
Developer B: Phase 7 (US4, profile setup), then Phase 8 (US5)
Developer C: Phase 9 (US6, triage and compare)
```

Watch the `FitScore.tsx` and orchestrator hotspots listed above.

## Implementation Strategy

### MVP

1. Phase 1, then Phase 2 (PR1). The model switch must land well before 2027-04-14 regardless of everything else.
2. Phase 3, then Phase 4 (US1). **Stop and validate** against quickstart P2-1 to P2-8: trustworthy scores are the MVP.
3. Phase 5 (US2) completes PR2. US1 and US2 ship together because they share the fit schema change and `fitView` (plan.md).

### Incremental delivery

Each subsequent PR (PR3 to PR6) is independently deployable. The backend deploys first through CD. The extension follows after Chrome Web Store review. The compatibility smoke on every PR guarantees that the published extension keeps working throughout.

### Approvals to collect (never done unilaterally)

- **T020**: set temperature settings before PR1 merges.
- **T025**: model settings switch after eval sign-off, plus privacy confirmation.
- **T022**: any TPM increase or new deployment, only if the eval needs it.
- **T088**: a possible QG-4 exception and FR-M05 cost acknowledgement for evidence.

## Notes

- `[P]` means different files and no dependency on an incomplete task.
- Live-model tasks (T002, T013, T022, T077, T087, T102) cost money and are on demand. Their outputs are committed so the numbers are reproducible.
- Every `test:` commit precedes its `feat:` commit (Constitution II).
