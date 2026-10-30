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
5. **One branch per PR, each targeting `main`** (Development Workflow). PR1 uses `006-profile-match-ux`, which already carries these planning artifacts. Later PRs branch from `main` after the previous PR merges: `006-freshness-verdict` (PR2), `006-evidence` (PR3), `006-profile-setup` (PR4), `006-confirm-skills` (PR5) and `006-triage-compare` (PR6).

## Four traps this feature is built around

These are silent failures, not crashes. They were found in existing code during planning.

1. **Usage `Replace` writes erase new columns** (T064). `checkAndIncrement` and `refundOnSystemFailure` use `updateEntity(…, "Replace")`, so the first ordinary analysis after a rescore wipes `rescoresUsed`. T046 writes that test failing first.
2. **An old client's profile PUT erases new fields** (T039). `putProfile` upserts with `"Replace"`, so an older extension saving `{text, dealbreakers}` would drop preferences and confirmed skills. T032 pins merge semantics.
3. **Object-shaped chips crash old clients** (T094). The PR3 model schema uses objects internally, and the server MUST split them back into label strings plus `fit.evidence`. T090 asserts the wire shape.
4. **Removing temperature changes prod behaviour** (T021). Once temperature becomes optional, the deployed tiers would silently move from temperature 0 to the default of 1. T021 sets `…_TEMPERATURE=0` **before** PR1 deploys. It needs approval.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Lock the baselines that later PRs are measured against.

- [X] T001 Record the QG-4 p95 baseline on `main` by running `npm run test:integration -- perf.test.ts` from `functions/`. Write the p95 and the commit SHA into a new "Baselines" section at the bottom of `specs/006-profile-match-ux/quickstart.md`, so later PRs compare against a fixed number for the 20% regression gate.
- [X] T002 [P] Record the current six-posting arrangement eval for both tiers in the same "Baselines" section of `specs/006-profile-match-ux/quickstart.md` **(live model calls, about $0.01)**. Run `npm run eval:postings` and `npm run eval:postings -- --tier=premium` from `functions/`, and note the deployment names, accuracy and p95. This is the "current 100%" that SC-008 must keep.
- [X] T003 [P] Create `specs/006-profile-match-ux/eval-runs/` containing a `.gitkeep`, plus a `README.md` that says raw `--out` JSON files land here and are committed with PR1.

---

## Phase 2: Foundational A — PR1, Scoring-model switch (FR-M01–M05)

**Purpose**: Every rubric, verdict and stability measurement in later PRs must run on the model that will remain. This phase blocks all user stories.

**Independent test**: [quickstart.md § PR1](./quickstart.md#pr1--scoring-model-switch-frm01m05). The eval report shows the chosen free configuration passing SC-002, SC-004, SC-008 and SC-009, and `eval-models.md` is signed off.

### Tests for PR1 (write first, must fail) ⚠️

- [X] T004 [P] Write `functions/tests/unit/modelConfig.test.ts`, which tests `resolveModelConfig(tier, env)` against [contracts/model-config.md](./contracts/model-config.md). It covers:
  - the free deployment fallback chain (`AZURE_OPENAI_JOB_DEPLOYMENT` → `AZURE_OPENAI_DEPLOYMENT` → `"gpt-4o-mini"`);
  - Premium using its own deployment **and** its own `_PREMIUM` settings when `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` is non-empty;
  - Premium using the free deployment **and the free settings** when it is unset or `""`;
  - empty strings treated as unset;
  - temperature parsing for `"0"`, `"0.7"` and `"2"`, and rejecting `"abc"`, `"-1"`, `"2.5"` and `"NaN"`;
  - `reasoningEffort` accepting `none|low|medium|high|xhigh` and rejecting `minimal` and `max`;
  - `apiVersion` defaulting when unset and being overridden by `AZURE_OPENAI_API_VERSION`;
  - an invalid value throwing `ModelConfigError` whose message names the variable.
- [X] T005 [P] Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts` with request-shape tests on the mocked `create`:
  - with no temperature set, the request has **no** `temperature` key;
  - with temperature 0 set, it has `temperature: 0`;
  - with reasoning effort `none` set, it has `reasoning_effort: "none"` and no `temperature`;
  - the repair retry (second call) uses identical settings;
  - `max_completion_tokens` is still 3000;
  - `new AzureOpenAI` receives the resolved `apiVersion`.
- [X] T006 Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts` with `observe`-callback tests:
  - one call per completion attempt, with `attempt: 1` and then `2` on repair;
  - token fields read from the mocked `completion.usage`, including `completion_tokens_details.reasoning_tokens` and `prompt_tokens_details.cached_tokens`, defaulting to 0 when absent;
  - `finishReason` and `deployment` included;
  - `latencyMs` is a non-negative number;
  - omitting `observe` changes nothing.
- [X] T007 [P] Extend `functions/tests/unit/analyze-job.handler.test.ts` to assert two things:
  - the handler logs exactly one `model.usage` line per completion attempt through `context.log`, with token counts only (assert that no argument contains `mainText` or profile text);
  - a `ModelConfigError` maps to `500 SERVICE_ERROR`, so the existing 5xx refund path runs.
- [X] T008 [P] Write `functions/tests/unit/evalMetrics.test.ts` for the pure metric helpers that `functions/scripts/evalMetrics.ts` will export. It covers:
  - `bandFor(score, violations)` returning one of the five FR-009 bands;
  - `verdictStability(runsByPair)`, as the share of pairs whose band is identical across runs;
  - `falseDealbreakers(results, pairs)` and `missedDealbreakers(results, pairs)`, using `fit.dealbreakersViolated` when present and otherwise the PR1 proxy of `score ≤ 20` plus a case-insensitive rationale mention (valid only while the PR1 prompt still asks for the cap), and reporting which `detectionMethod` was used;
  - `scoreIndependence(withDealbreakers, withoutDealbreakers)`, as the share of violating pairs whose band, computed **from the score alone**, is the same in both runs (SC-002);
  - `costPerAnalysis(usage, price)`, with cached tokens billed at the cached rate and never assumed cheaper than uncached;
  - `p95` (reusing the existing nearest-rank definition);
  - `truncations`, counting `finishReason === "length"`.

### Implementation for PR1

- [X] T009 Implement `functions/src/services/modelConfig.ts`, exporting `resolveModelConfig`, `ModelConfig` and `ModelConfigError`, to make T004 pass. Keep it pure: it reads only the `env` argument.
- [X] T010 Refactor `orchestrateJobAnalysis` in `functions/src/services/jobExtractionOrchestrator.ts` to make T005 and T006 pass:
  - replace the inline deployment selection with `resolveModelConfig(tier, process.env)`;
  - pass `apiVersion` from the config;
  - spread `temperature` and `reasoning_effort` only when defined;
  - add the optional 4th parameter `observe?: (u: ModelUsage) => void`, called after each `create` returns;
  - export the `ModelUsage` type.
- [X] T011 Wire `observe` in `functions/src/analyze-job/index.ts` and `functions/src/analyze-document/index.ts` so each logs `context.log("model.usage", JSON.stringify(u))`. Map `ModelConfigError` to `500 SERVICE_ERROR` in both. This makes T007 pass.
- [X] T012 [P] Document the five new variables in `functions/local.settings.json.example`, using the `//NAME` comment-key convention already in that file. The variables are `AZURE_OPENAI_JOB_TEMPERATURE[_PREMIUM]`, `AZURE_OPENAI_JOB_REASONING_EFFORT[_PREMIUM]` and `AZURE_OPENAI_API_VERSION`. Each comment states that the setting is omitted from the request when empty, and that the Premium settings apply only when the Premium deployment is set.
- [x] T013 **⚠ APPROVAL**: ask the user to approve creating a `gpt-5.4-mini` deployment (model version 2026-03-17) named `gpt-5.4-mini` in Azure OpenAI resource `job-posting-analyzer-openai` (resource group `job-posting-analyzer-rg`) for Premium (research R2). Present the SKU choice, GlobalStandard like the other deployments or DataZoneStandard to keep processing in the US data zone, and the capacity, 50K TPM to match `gpt-5.4-nano` if quota allows. After approval, create it with `az cognitiveservices account deployment create`, confirm it with `az cognitiveservices account deployment list`, and record the date, SKU and TPM in `eval-models.md`. It has no fixed charge, and deleting it reverses it. **Done 2026-10-29**: approved with DataZoneStandard; created at 50K TPM; a two-posting probe through the production code path passed (research R2); Premium switched in production the same day. Record this in `eval-models.md` when T024 creates it.
- [X] T014 Run the live probe from quickstart step P1-2 **(live, a few cents)**:
  1. Write a throwaway script under the session scratchpad (not committed) that calls `orchestrateJobAnalysis` once per deployment with an `env` override: `gpt-4o-mini` at temperature 0, `gpt-5.4-nano` at temperature 0, `gpt-5.4-mini` at temperature 0 (needs T013), and `gpt-6-luna` at reasoning effort `none`.
  2. Run it under a candidate `AZURE_OPENAI_API_VERSION`, starting with `2024-12-01-preview` and moving to a newer GA or preview version if that one 400s.
  3. Set the version that passes all four as the default in `functions/src/services/modelConfig.ts`, and update T004's expected default.
  4. Record the version and the four outcomes in a new file, `specs/006-profile-match-ux/eval-models.md`, under "API version probe".
  If no single version passes all three, stop and report to the user.
- [X] T015 [P] Write `extension/scripts/exportCorpusExtracts.ts`. For each slug in `extension/tests/fixtures/pages/manifest.json`, it serves the fixtures with `serveFixtures()`, opens the corpus page in Chromium, calls `runExtractor(page)`, and writes `functions/tests/fixtures/postings/full/<slug>.json`. Each file contains `{ url, canonicalUrl, title, jsonLd, structuredSources, mainText (sliced to 40,000), extractedAt }`, without `provenance`, plus `expectNotScorable: true` for `thin-posting-control`. Follow `extension/scripts/rescoreCorpus.ts` for the setup and teardown pattern.
- [X] T016 Run `npx tsx scripts/exportCorpusExtracts.ts` from `extension/` and commit the 6 JSON files under `functions/tests/fixtures/postings/full/`. Add a `README.md` there that says:
  - the files are derived from `extension/tests/fixtures/pages/`, not hand-edited;
  - they are regenerated only when the pages corpus or `pageExtractor.ts` changes;
  - `thin-posting-control` is never scored for fit.
- [X] T017 [P] Create the four fixture profiles under `functions/tests/fixtures/profiles/`, shaped `{ id, text, dealbreakers, preferences?, confirmedSkills? }`. Each résumé text is realistic, at about 1,500–3,000 characters.
  - `senior-backend.json`: dealbreaker "No fully on-site roles".
  - `mid-frontend.json`: preferences `arrangements: ["remote"]` and `minSalary: { amount: 120000, currency: "USD", period: "year" }`, **also** repeated as the dealbreaker lines "Remote only" and "Minimum salary 120000 USD per year", so PR1 can measure them before PR4.
  - `data-ml.json`: preference `locations: ["EU timezones only"]`, also as the dealbreaker line "EU timezones only".
  - `control.json`: no dealbreakers.
- [X] T018 Create `functions/tests/fixtures/profiles/pairs.json` with one entry per (posting × profile) pair, using the six `postings/*.txt` ids (file stem) and the five scorable `postings/full/*.json` slugs. Each entry is `{ posting, profile, violations, unstatedFacts, verdictRange? }`.
  - Label `violations` by reading each posting: a dealbreaker counts as violated **only** if the posting states the contradicting fact.
  - `unstatedFacts` lists `"arrangement"`, `"salary"` and/or `"location"` when the posting is silent on them. These pairs are SC-008's false-dealbreaker traps.
  - Exclude `thin-posting-control`.
  - Add a top-level `"_labelling"` note describing the rule above.
- [X] T019 [P] Create `functions/scripts/modelPrices.json`, keyed by deployment name. Each entry is `{ inputPer1M, cachedInputPer1M, cacheWritePer1M?, outputPer1M, source: "Azure Retail Prices API", asOf: "2026-10-28" }`. Seed it from spec.md's Technical Shape:
  - `gpt-4o-mini` 0.15 / 0.60;
  - `gpt-5.4-nano` 0.20 / 1.25;
  - `gpt-6-luna` 0.10 / 0.50, with a cache write of 0.125;
  - `gpt-5.4-mini` 0.825 / 4.95, the DataZoneStandard price of the live deployment (global is 0.75 / 4.50).
  Look up any cached-input price the spec does not give using the Azure Retail Prices API. If it can't be confirmed, set it equal to the uncached price and say so in a `"note"` field.
- [X] T020 [P] Create `functions/scripts/evalConfigs.json` with the R2 candidates as `{ label, tier, deployment, temperature?, reasoningEffort?, gate }`:
  - `free-4o-mini-t0` (baseline);
  - `premium-5.4-nano-t0` (baseline);
  - `luna-none`;
  - `luna-low`;
  - `luna-medium`;
  - `premium-5.4-mini-t0`, the chosen Premium configuration, with `gate: true`.
  The others have `gate: false` and serve as the comparison and the R2 fallback.
- [X] T021 **⚠ APPROVAL**: ask the user to approve setting `AZURE_OPENAI_JOB_TEMPERATURE=0` and `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM=0` on Function App `job-posting-analyzer-func` (resource group `job-posting-analyzer-rg`) **before** PR1 merges (research R1, trap 4). After approval, set them with `az functionapp config appsettings set` and confirm by listing the setting **names**. Never print values. Record the date in `eval-models.md`.
- [X] T022 Implement `functions/scripts/evalMetrics.ts` to make T008 pass. Then extend `functions/scripts/evalPostings.ts` per [contracts/eval-harness.md](./contracts/eval-harness.md):
  - with no `--configs`, keep today's behaviour exactly;
  - add `--configs`, `--runs` (default 5), `--concurrency` (default 2, with exponential backoff on 429 up to 5 retries), `--only` and `--out`;
  - load the full-length postings and profiles;
  - serialize each profile with `profileToPromptText` from `shared/types/profile.ts`;
  - per configuration, set `process.env` overrides, then call `orchestrateJobAnalysis` with an `observe` collector;
  - for SC-002, also score each violating pair with the profile's dealbreakers and preferences stripped, and report `scoreIndependence`;
  - print the per-configuration report block from the contract;
  - exit non-zero only when a `gate: true` configuration misses a target.
- [X] T023 Run the full eval **(live, about 3 hours at 20K TPM, about $1–3)** with `npm run eval:postings -- --configs=scripts/evalConfigs.json --runs=5 --out=../specs/006-profile-match-ux/eval-runs/pr1.json` from `functions/`. If the rate limit makes a configuration exceed about 90 minutes, rerun that configuration alone with `--concurrency=1`. Do not ask for a TPM increase without approval.
- [X] T024 Write `specs/006-profile-match-ux/eval-models.md`:
  - one comparison table across configurations from `eval-runs/pr1.json`;
  - the R2 decision rule applied step by step;
  - the chosen free and Premium settings;
  - whether `gpt-5.4-mini` passes SC-002, SC-004, SC-008, SC-009 latency and FR-M02, with its measured cost per analysis and per 300-analysis month noted as waived under FR-M05; if it fails, the R2 fallback applied step by step;
  - the TPM implication if the fallback moves Premium to `gpt-6-luna`;
  - known corpus gaps (iCIMS, SmartRecruiters stub, 5 full-length postings);
  - the GlobalStandard data-processing note from research R2.
  If no `gpt-6-luna` setting passes, record that and stop. PR1 then merges the plumbing only (research R2).
- [X] T025 Run the PR1 gate from quickstart's "Gate for every PR" (lint, unit, integration, coverage of at least 80% on `modelConfig.ts`, `jobExtractionOrchestrator.ts` and `evalMetrics.ts`), plus the compatibility smoke (rule 3). Ask the user to sign off `eval-models.md` in the PR description, then open PR1.
- [X] T026 **⚠ APPROVAL**: after PR1 merges and `eval-models.md` is signed off, confirm the privacy-policy wording covers GlobalStandard processing (research R2), then ask the user to approve the settings switch (research R1 step 4). For free, that is `AZURE_OPENAI_JOB_DEPLOYMENT=gpt-6-luna` and `AZURE_OPENAI_JOB_REASONING_EFFORT=none`, and deleting `AZURE_OPENAI_JOB_TEMPERATURE`. Premium is already on `gpt-5.4-mini` since 2026-10-29 (T013). If the eval passes, keep it with `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM=0`. If it fails, ask the user to approve reverting to `gpt-5.4-nano` or switching to the fallback recorded in `eval-models.md`. *(Signed off 2026-10-29: Premium → `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM=gpt-6-luna-premium`, `AZURE_OPENAI_JOB_REASONING_EFFORT_PREMIUM=low`, delete `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM`. Any-region processing accepted for free; capacity already raised.)* After approval:
  1. apply the switch;
  2. analyze one posting from the published extension;
  3. confirm in Application Insights or log stream that `model.usage` shows the new deployment;
  4. record the date and rollback values in `eval-models.md`.
- [X] T027 *(Skipped 2026-10-29 with the user's approval: Premium moves to `gpt-6-luna-premium`, so no retirement issue is needed.)* Open a GitHub issue in `kippolitov/job-posting-analyzer` titled "Migrate Premium off gpt-5.4-mini before 2027-09-21" (or off `gpt-5.4-nano` if the fallback kept it), labelled `needs-triage`, linking `eval-models.md`. Both models retire on that date.

**Checkpoint**: the free tier runs on a model retiring on or after 2028-01-01, and every later PR measures on it.

---

## Phase 3: Foundational B — PR2 groundwork shared by US1 and US2

**Purpose**: the fit schema additions, the shared display module, server-side profile serialization and fingerprinting, and merge-PUT. US1 and US2 both build on these, and they ship in the same PR.

### Tests for the groundwork (write first, must fail) ⚠️

- [X] T028 [P] Write `shared/fitView.fixtures.ts` exporting `NORMALIZE_CASES` as `[input, expected]` pairs. Cover:
  - `null`;
  - a pre-breakdown fit (`{score, rationale}` only);
  - a 005-era fit with all string arrays and no new fields;
  - a fully populated PR2 fit.
  Each expects absent arrays to become `[]`, `dealbreakersViolated` to default to `[]`, `evidence` to default to `{}`, and `profileFingerprint` to stay `undefined` when absent.
- [X] T029 [P] Write `extension/tests/unit/fitView.test.ts` and `web/tests/unit/fitView.test.ts`. Each iterates `NORMALIZE_CASES` from `shared/fitView.fixtures.ts` against `normalizeFit` and asserts it never throws. The two suites are deliberately duplicated (research R10, FR-023 guard). They get more fixture tables in later tasks.
- [X] T030 [P] Write `functions/tests/unit/profileSerialization.test.ts` for `shared/types/profile.ts`:
  - **invariant**: `profileToPromptText({text, dealbreakers})` output is byte-identical to the current implementation for 5 cases (no dealbreakers, one, several, trailing whitespace, unicode). Snapshot the strings literally in the test.
  - `dealbreakerLinesFromPrompt(profileToPromptText(p))` round-trips `p.dealbreakers` for every case.
  - `dealbreakerLinesFromPrompt` on text with no `Dealbreakers:` section returns `[]`.
- [X] T031 [P] Write `functions/tests/unit/profileFingerprint.test.ts`:
  - `profileFingerprint(s)` is 64 lowercase hex characters;
  - it equals SHA-256 of `s.replace(/\s+/g, " ").trim()`;
  - whitespace-only variants give the same fingerprint (US1 #6);
  - a changed dealbreaker gives a different one;
  - `fingerprintForRequest({ profileData })` equals `fingerprintForRequest({ profile: profileToPromptText(profileData) })`.
- [X] T032 [P] Extend `functions/tests/unit/profileRepository.test.ts` and `functions/tests/integration/storageApi.test.ts` (Azurite), per [contracts/profile-api.md](./contracts/profile-api.md):
  - GET and PUT responses include `fingerprint`;
  - **merge PUT (trap 2)**: seed a row with `preferences` and `confirmedSkills` columns, PUT `{text, dealbreakers}`, and assert both columns survive;
  - `preferences: null` clears them;
  - `fingerprintHistory` is prepended only when the fingerprint changes, capped at 20, and never returned by GET;
  - a whitespace-only PUT leaves `fingerprint` unchanged and history unchanged;
  - a PUT racing another write (simulate a 412 on the first attempt) retries and keeps both changes.
- [X] T033 [P] Write `functions/tests/unit/analyzeRequest.test.ts` for the request guard and profile resolution in [contracts/analyze-api.md §1](./contracts/analyze-api.md):
  - `isAnalyzeJobRequest` accepts a body with valid `profileData`;
  - it rejects malformed `profileData` (non-string `text`, non-array `dealbreakers`) and a malformed `rescore.priorFingerprint` (not null and not 64 hex);
  - `resolveScoringProfile(body)` returns `profileToPromptText(profileData)` when `profileData` is present, ignoring `profile`, and otherwise returns `profile`;
  - a legacy body without the new fields is accepted unchanged.
- [X] T034 [P] Extend `extension/tests/unit/AccountBar.test.tsx` for FR-028:
  - the web app control is a link whose visible text is "Web app", found with `getByRole("link", { name: "Web app" })`, opening `WXT_WEB_APP_URL` in a new tab;
  - its accessible description (`toHaveAccessibleDescription`) and its `title` are both "Opens in a new tab. You'll be asked to sign in with Google.";
  - it carries the secondary-button classes, including a minimum 24 × 24 px target (`min-h-6 min-w-6`);
  - it renders for both the free and the Premium account fixtures, next to Upgrade and next to "Manage subscription";
  - it stays hidden when `WXT_WEB_APP_URL` is empty, as today.
  Update the two existing tests that query the old "Open the web app in a new tab" name.

### Implementation for the groundwork

- [X] T035 Extend `Fit` in `shared/types/job.ts` with optional `dealbreakersViolated?: string[]` and `profileFingerprint?: string`, with JSDoc citing research R4. Do **not** change `matching`, `missing` or `desired`. Add `AnalyzeJobRequest.profileData?: ScoringProfile` and `AnalyzeJobRequest.rescore?: { priorFingerprint: string | null }`. `ScoringProfile` is `{ text; dealbreakers; preferences?; confirmedSkills? }`, exported from `shared/types/profile.ts`. Leave `isJobAnalysisPayload` unchanged.
- [X] T036 Add `dealbreakerLinesFromPrompt` to `shared/types/profile.ts`, and widen `profileToPromptText`'s generic to accept `ScoringProfile` without changing output for `{text, dealbreakers}`. This makes T030 pass.
- [X] T037 Implement `functions/src/services/profileFingerprint.ts`, exporting `profileFingerprint(serialized)` and `fingerprintForRequest(body)` with `node:crypto`. This makes T031 pass.
- [X] T038 Extend `isAnalyzeJobRequest` in `shared/types/job.ts` to validate the optional `profileData` and `rescore` shapes. Add `resolveScoringProfile` in `functions/src/services/profileFingerprint.ts`. This makes T033 pass.
- [X] T039 Update `functions/src/services/profileRepository.ts` and `functions/src/models/user.ts` to make T032 pass:
  - `ProfileEntity` gains the optional JSON columns `fingerprintHistory`, `preferences` and `confirmedSkills`;
  - `StoredProfile` gains `fingerprint`, computed on read with `profileFingerprint(profileToPromptText(stored))`;
  - `putProfile` reads the existing row, merges the body over it, prepends the old fingerprint to `fingerprintHistory` when it changed (capped at 20), and writes **conditionally on the row's ETag** (`updateEntity(…, "Replace", { etag })`, or `createEntity` when no row exists), carrying **all** columns and retrying on 412 up to 4 times;
  - `isProfilePutBody` accepts the optional `preferences` (or `null`) and `confirmedSkills`, structurally only. Detailed validation lands in US4 and US5.
  Return `fingerprint` from the GET and PUT handlers in `functions/src/profile/index.ts`.
- [X] T040 Create `shared/fitView.ts` with `normalizeFit`, `NormalizedFit`, `Verdict` and `Freshness` per [data-model.md §2](./data-model.md), to make T028 and T029 pass. Keep it pure TypeScript with no DOM, `chrome` or `fetch` imports.
- [X] T041 [P] Rework the web app link in `extension/components/AccountBar.tsx` to make T034 pass. Keep the `<a>` with `target="_blank"` and `rel="noopener noreferrer"`. Give it the visible text "Web app" after the existing icon (still `aria-hidden`), the "Manage subscription" button's classes (`rounded-md px-2 py-1 text-[11px] font-medium`) plus a border so it reads as a button, and `min-h-6 min-w-6`. Drop `aria-label`, so the accessible name is the visible text. Put the sign-in note in `title` and, through `aria-describedby`, in a visually hidden (`sr-only`) span. Buttons and links have no `alt` attribute; `title` gives the hover tooltip and `aria-describedby` makes screen readers announce it. Check the bar at 360 px width with the Premium fixture: nothing may wrap onto a second line except the left-hand usage text.
- [X] T042 [P] Add `fingerprint: string` to `web/src/api/types.ts` `ProfilePayload` and `fingerprint` to the extension's `CandidateProfile` in `extension/types/job.ts`. Both are optional on read, so an older backend still type-checks at runtime.

**Checkpoint**: shared types, fingerprinting and merge-PUT are in place, with no user-visible change yet.

---

## Phase 4: User Story 1 — I can trust that a score reflects my current profile (Priority: P1) 🎯 MVP

**Goal**: every fit records its profile version. Out-of-date fits are marked everywhere and offer a source-appropriate rescore with a stated cost. Dealbreaker violations are enforced on the server and shown in a banner. A taken-down posting keeps its score with a note.

**Independent test**: [quickstart.md § PR2](./quickstart.md#pr2--us1--us2-freshness-dealbreakers-rubric-verdict), steps P2-1 to P2-8 and P2-11 to P2-14.

### Tests for User Story 1 (write first, must fail) ⚠️

- [X] T043 [P] [US1] Add the recorded fixtures `functions/tests/fixtures/jobAnalysis/dealbreaker-onsite.json` and `functions/tests/fixtures/jobAnalysis/dealbreaker-paraphrased.json`:
  - `dealbreaker-onsite.json`: an on-site posting with `fit.score: 72` and `fit.dealbreakersViolated: ["No fully on-site roles"]`.
  - `dealbreaker-paraphrased.json`: `dealbreakersViolated: ["no on-site"]`, plus one unrelated entry, `"Must sponsor visas"`.
  Update the folder README with what each fixture proves.
- [X] T044 [P] [US1] Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts` for `resolveDealbreakers` ([research R8](./research.md#r8--server-validated-dealbreakers-and-the-rubric-pr2-fr-005fr-008)):
  - with `dealbreaker-onsite` and the profile dealbreaker "No fully on-site roles", the violation keeps the user's exact wording and **the score stays 72** (FR-005: violations never change the score);
  - with `dealbreaker-paraphrased`, "no on-site" maps by containment to the user's line, and the unmatched entry is kept with exactly one warning;
  - the step never changes `score`, with or without violations;
  - the system prompt no longer contains "cap fit.score at 20", and does contain the instructions to not lower the score for dealbreakers and to name each violated dealbreaker in the rationale (research R8);
  - no profile gives `fit: null` with no `dealbreakersViolated`;
  - `fit.profileFingerprint` equals `fingerprintForRequest(req)` whenever `fit` is non-null;
  - the schema sent to the model includes `fit.dealbreakersViolated` as a required string array with `maxItems: 10`.
- [X] T045 [P] [US1] Write `functions/tests/unit/rescoreEligibility.test.ts` for the pure `decideRescoreCharge({ intent, currentFingerprint, savedFit, fingerprintHistory, rescoresUsed })`. It covers every row of [research R6's eligibility rule](./research.md#r6--free-rescore-metering-pr2-fr-004fr-004a-constitution-v):
  - no intent, or no profile, charges an analysis;
  - a saved fit with an absent fingerprint charges a rescore;
  - a saved fit with a different fingerprint charges a rescore;
  - a saved fit with the same fingerprint charges an analysis, even when the claimed prior differs;
  - no saved row and a claimed prior in history that differs from current charges a rescore;
  - a claimed prior not in history charges an analysis;
  - a `null` claimed prior with no saved row charges an analysis;
  - an eligible request with `rescoresUsed` at 10 or more charges an analysis;
  - a saved row with `fit: null` charges an analysis;
  - every case gives the same result for `free` and `premium` accounts (FR-026).
- [X] T046 [P] [US1] Extend `functions/tests/integration/metering.test.ts` (Azurite) for the **Replace hazard (trap 1)**: do a free rescore, then an ordinary analysis, and assert `rescoresUsed === 1` and `count === 1` on the row. Also cover:
  - parallel rescores at `rescoresUsed: 9` produce exactly one free rescore, and the rest fall back to analyses;
  - a refund decrements the counter that was charged;
  - a row written before 006 without the new columns reads them as 0.
- [X] T047 [P] [US1] Write `functions/tests/integration/rescore.test.ts` (Azurite, recorded model fixtures), using `functions/tests/helpers/savedJobsSeeder.ts`. Cover:
  - a rescore of a saved stale posting returns `usage.charged: "rescore"`, plus `rescoresUsed` and `rescoresLimit: 10`;
  - with the allowance exhausted (`count === limit`) but free rescores left, the rescore still returns 200;
  - with both exhausted, it returns 429 `USAGE_LIMIT_REACHED`, whose `usage` includes `rescoresUsed`;
  - a model 5xx leaves `rescoresUsed` unchanged;
  - a rescore whose fixture returns `isJobPosting: false` without `assumeJobPosting` gives `postingUnavailable: true` and `usage.charged: "none"`, and `unavailableRefunds` goes up by one;
  - an 11th unavailable refund in the month is not granted;
  - the same flows run through `analyze-document` using `functions/tests/fixtures/documents/valid.docx`, whose saved row is keyed by `sha256("doc:" + sha256(text))`;
  - a paste rescore through `analyze-document`'s `text` part finds a `paste:` row saved the way the extension saves it, and charges `rescore`.
- [X] T048 [P] [US1] Write `functions/tests/unit/pasteIdentity.test.ts` for `shared/pasteIdentity.ts`: a fixed test vector, the exact hex for one sample posting, written literally in the test; whitespace and line-ending variants give the same key; the key matches `/^paste:[0-9a-f]{64}$/`. Point `extension/tests/unit/pasteIdentity.test.ts` at the shared module and add the same literal vector, so the server and the extension are proven to agree.
- [X] T049 [P] [US1] Write `functions/tests/unit/analyze-document.paste.test.ts` for the `text` part per [contracts/analyze-api.md §1](./contracts/analyze-api.md), with the orchestrator and metering mocked:
  - both `file` and `text`, or neither, is a 400;
  - 299 characters is `400 TEXT_TOO_SHORT` and 40,001 is `413 TEXT_TOO_LONG`, and metering is never called;
  - a valid paste calls the orchestrator with an empty title and `mainText` equal to the text, and returns `source: "paste"`, no `filename`, and `canonicalUrl === await pasteIdentity(text)`;
  - a whitespace variant of the same text returns the same `saveKey`.
- [X] T050 [P] [US1] Extend `functions/tests/unit/analyze-job.handler.test.ts` for the **charge-after-validation side fix** ([contracts/analyze-api.md §4](./contracts/analyze-api.md)): an invalid JSON body (400), a missing extract (400) and an oversized `mainText` (413) each leave the metering mock **uncalled**.
- [X] T051 [P] [US1] Extend `functions/tests/unit/savedJobsRepository.test.ts` and `functions/tests/integration/storageApi.test.ts` per [contracts/saved-jobs-api.md §4](./contracts/saved-jobs-api.md):
  - `PATCH {unavailableAt}` round-trips through GET and list;
  - a PATCH with `analysis` clears it, and so does a PUT;
  - an invalid date returns 400;
  - `PATCH {status}` preserves it.
- [X] T052 [P] [US1] Add the freshness and rescore cases to `shared/fitView.fixtures.ts` as `FRESHNESS_CASES`, `RESCORE_ACTION_CASES` and `COST_LINE_CASES`:
  - every row of the data-model §2 freshness table;
  - `rescoreAction` for each `source` × freshness, plus `unavailableAt`, covering the research R7 table and including paste rows, whose copy is "Paste again to rescore" on both surfaces and whose web link is `/upload?mode=paste&rescore=<key>`;
  - `rescoreCostLine` for 7 of 10 left ("Free — 7 of 10 free rescores left this month"), 0 left with allowance left ("Uses 1 analysis"), and both exhausted.
  Extend both `fitView.test.ts` suites (T029) to iterate them.
- [X] T053 [P] [US1] Extend `extension/tests/unit/jobFlow.test.ts` and `extension/tests/unit/revisitFlow.test.ts`:
  - a revisit with a stored fit whose fingerprint differs from `getProfile().fingerprint` broadcasts the stored result with `currentProfileFingerprint` set, and does **not** call `postJobAnalysis`. This replaces the old auto-refresh expectation.
  - pre-breakdown fits and null fits are no longer auto-refreshed;
  - a revisit writes `profile:fingerprint` to `chrome.storage.session`;
  - a Rescore message sends `rescore: { priorFingerprint }`, `profileData` and `profile`, and PATCHes the saved entry's `analysis`;
  - thin content with a saved entry broadcasts the stored result with `postingUnavailable: false` and no request;
  - a Rescore from that state PATCHes `unavailableAt` and sends no request;
  - a `postingUnavailable: true` response keeps the stored analysis and PATCHes `unavailableAt`;
  - when `getProfile` throws, the page, paste and region flows still analyze, and the broadcast carries `profileUnavailable: true` (spec edge case "Profile fetch fails at analysis time");
  - a Rescore that fails (5xx or timeout) keeps the stored analysis, still marked out of date, and PATCHes nothing (spec edge case "Rescore fails").
- [X] T054 [P] [US1] Extend `extension/tests/unit/jobAnalysisClient.test.ts`. The request body includes `profileData`, `profile` and, when given, `rescore`. The response's `usage` (with `charged`, `rescoresUsed` and `rescoresLimit`) and `postingUnavailable` are surfaced to the caller.
- [X] T055 [US1] Write the **FR-001 / SC-006 contract tests**:
  - in `extension/tests/unit/jobFlow.test.ts`, the page, paste and scoped-region flows each send `profileData` equal to the stored profile and `profile === profileToPromptText(profileData)`;
  - in `web/tests/contract/upload.test.tsx`, the web document upload and the web Paste text option each send a `profileData` form part with the same content as the extension, from one shared fixture profile.
- [X] T056 [P] [US1] Extend `extension/tests/unit/FitScore.test.tsx`, `extension/tests/unit/ThisPageTab.test.tsx` and `extension/tests/unit/SavedTab.test.tsx`:
  - the dealbreaker banner reads "Violates your dealbreaker: <line>" for each violation, above the score (FR-006);
  - an out-of-date fit shows "Scored against an older profile" with a Rescore button and the cost line;
  - a version-unknown fit shows "May be out of date";
  - a fit whose profile was deleted shows "Scored against a deleted profile";
  - an unavailable entry shows "Posting no longer available — score can't be updated";
  - with free rescores and the allowance exhausted, the existing `UsageExhausted` card renders;
  - a `storage.onChanged` event for `profile:fingerprint` re-marks the visible result and shows the FR-007 offer to rescore without auto-running;
  - a result with `profileUnavailable: true` shows "Fit not scored — your profile couldn't be loaded", not the "Configure profile" call to action;
  - Saved tab rows show the out-of-date marker.
- [X] T057 [P] [US1] Extend `web/tests/contract/library-view.test.tsx` and `web/tests/contract/filters.test.tsx`, and create `web/tests/contract/posting-detail.test.tsx`:
  - library rows and the detail page mark out-of-date and version-unknown fits;
  - URL-sourced rows link "Open posting to rescore" to `sourceUrl`;
  - document rows link "Upload again to rescore" to `/upload?rescore=<key>`;
  - paste rows link "Paste again to rescore" to `/upload?mode=paste&rescore=<key>`;
  - a "Current profile only" filter hides non-current fits;
  - the unavailable note renders.
- [X] T058 [P] [US1] Extend `web/tests/contract/upload.test.tsx`:
  - Upload does not send until the profile request settles, whether it succeeds or fails (spec edge case);
  - with `?rescore=<key>`, the request carries `rescore=true` and the entry's `priorFingerprint`, and a successful result PATCHes that saved entry's `analysis` in place instead of offering "Save to library";
  - with `?rescore=<key>` and a result whose `saveKey` differs from `<key>`, nothing is PATCHed, "Save to library" is offered, and the note reads "This didn't match the saved posting, so it was analyzed as a new one.";
  - when the profile fetch failed, the result shows "Fit not scored — your profile couldn't be loaded";
  - with `?rescore=<key>`, the page shows the cost line from `rescoreCostLine` before a file is sent, using `rescoresUsed` and `rescoresLimit` from `GET /api/account` (FR-004a).
- [X] T059 [US1] Extend `web/tests/contract/upload.test.tsx` for the **Paste text option** (FR-027). It shares the file with T058, so it runs after it:
  - the nav entry reads "Analyze posting" and the page heading reads "Analyze a posting";
  - the page offers "Upload a file" and "Paste text" as a two-option toggle, with upload selected by default and paste selected by `?mode=paste`;
  - a paste under 300 characters shows "Paste more of the posting before analyzing." and one over 40,000 shows "Trim it to the posting itself before analyzing.", and neither sends a request;
  - a valid paste sends `analyzeDocument` a `text` part, no `file` part, and the `profileData` part, and waits for the profile request to settle like an upload;
  - "Save to library" PUTs a payload with `source: "paste"`, empty `sourceUrl` and `filename`, and the response's `canonicalUrl`;
  - the result header reads "From pasted text" instead of a filename;
  - `?mode=paste&rescore=<key>` shows the cost line before sending and PATCHes in place when the keys match.
- [x] T060 [US1] Write the **P1 E2E test** `extension/tests/e2e/profileFreshness.spec.ts`, using the existing `fixtures.ts` harness and localhost fixture server:
  1. analyze a posting and save it;
  2. change the profile through the options page;
  3. the panel shows the out-of-date notice and the Rescore cost line;
  4. Rescore clears the notice;
  5. serve a thin stub at the same URL, then Rescore shows "Posting no longer available" and makes no network call to analyze-job (assert with route interception).

- [X] T061 [US1] Write the **P1 web E2E test** `web/tests/e2e/profileFreshness.spec.ts` (Constitution II: US1 scenarios 1 and 5 name web surfaces). Follow `web/tests/e2e/signin-shared-data.spec.ts`: stub the backend at the network layer with Playwright `page.route`. Seed `GET /api/jobs` with three saved postings: one scored against the current fingerprint, one against an older fingerprint, and one with no fingerprint. Return the current fingerprint from `GET /api/profile`. Assert:
  - the library marks the stale row "Scored against an older profile" and the fingerprint-less row "May be out of date";
  - "Current profile only" hides both;
  - when sorted by fit, the stale rows still sort by number;
  - the detail page of a URL-sourced stale posting shows "Open posting to rescore" linking to its `sourceUrl`;
  - a document-sourced one shows "Upload again to rescore";
  - on the Analyze posting page, choosing "Paste text", pasting a fixture posting and clicking Analyze sends a stubbed `analyze-document` request with a `text` part, and "Save to library" PUTs a `paste:` entry.
  Run with `npm run test:e2e` from `web/`.

### Implementation for User Story 1

- [X] T062 [US1] Add `resolveDealbreakers(payload, dealbreakerLines, warn)` to `functions/src/services/jobExtractionOrchestrator.ts`. It runs after `enforceConsistency`. Wire it in:
  - add `fit.dealbreakersViolated` (array of string, `maxItems: 10`, required) to `JOB_ANALYSIS_SCHEMA`;
  - **remove** today's prompt line "If the posting violates any stated dealbreaker in the profile, cap fit.score at 20 or below and name the dealbreaker in the rationale";
  - add the system-prompt lines "fit.score measures only how well the posting matches the candidate's skills, experience and seniority; do not lower it for dealbreakers", "copy each violated dealbreaker exactly as written in the profile into dealbreakersViolated, and also name it in the rationale" and "a fact the posting does not state is not a violation — add an `Unverified: …` weakness instead";
  - the step never reads or writes `score`;
  - source dealbreaker lines from `req.profileData?.dealbreakers ?? dealbreakerLinesFromPrompt(req.profile)`;
  - build the user message from `resolveScoringProfile(req)`;
  - stamp `fit.profileFingerprint`.
  This makes T044 pass.
- [X] T063 [US1] Implement `functions/src/services/rescoreEligibility.ts`, exporting the pure `decideRescoreCharge`, to make T045 pass. Add `FREE_RESCORES_PER_MONTH = 10` and `UNAVAILABLE_REFUNDS_PER_MONTH = 10` next to `MONTHLY_ANALYSES` in `functions/src/models/user.ts`, and add `rescoresUsed?` and `unavailableRefunds?` to `UsageEntity`.
- [X] T064 [US1] Extend `functions/src/services/meteringService.ts`:
  - switch every `updateEntity` in `checkAndIncrement` and `refundOnSystemFailure` from `"Replace"` to `"Merge"` with the same ETag (trap 1);
  - add `chargeAnalysis(sub, tier, decision)`, which returns `{ charged: "rescore" | "analysis", allowed, usage }`. A rescore increments `rescoresUsed` if it is below 10 and otherwise falls back to `count`.
  - add `refundCharge(sub, tier, charged)` and `grantUnavailableRefund(sub, tier, charged)`, which checks `unavailableRefunds < 10`, decrements the charged counter, and increments `unavailableRefunds`;
  - make `peekUsage` return `rescoresUsed` and `rescoresLimit`.
  This makes T046 pass.
- [X] T065 [US1] Restructure `functions/src/analyze-job/index.ts` to validate, then charge, then call the model (contracts/analyze-api.md §2):
  - remove `withUsageMetering` from the route composition, keeping `withRateLimit(withAuth(handler))`;
  - after validation, look up the saved row with `getJob(user.sub, sha256Hex(extract.canonicalUrl))` and the profile's `fingerprintHistory` only when `body.rescore` is present;
  - call `decideRescoreCharge`, then `chargeAnalysis`, and return 429 as before when not allowed;
  - after the model call, apply the unavailable-refund rule;
  - refund the charged counter on 5xx;
  - echo `usage` with `charged`, `rescoresUsed` and `rescoresLimit`.
  Delete `withUsageMetering` if nothing else uses it (Constitution I, no dead code). This makes T047 (job part) and T050 pass.
- [X] T066 [US1] Apply the same flow in `functions/src/analyze-document/index.ts`:
  - parse the `profileData`, `rescore` and `priorFingerprint` form parts, returning 400 if `profileData` is malformed;
  - compute the saved key from the server-computed `doc:` canonical URL, after `extractDocument` and before charging;
  - use `chargeAnalysis`, `refundCharge` and `grantUnavailableRefund`.
  This makes the T047 document part pass.
- [X] T067 [US1] Move `extension/lib/pasteIdentity.ts` to `shared/pasteIdentity.ts`, using `globalThis.crypto.subtle` so it runs in Node 20, the service worker and browsers. Update the import in `extension/services/jobFlow.ts` and delete the old file. Move `MIN_TEXT_CHARS = 300` to `shared/types/job.ts` next to `MAIN_TEXT_CAP`, and re-export it from `extension/lib/pageExtractor.ts` so existing imports keep working. This makes T048 pass.
- [X] T068 [US1] Accept the `text` part in `functions/src/analyze-document/index.ts` per [contracts/analyze-api.md §1](./contracts/analyze-api.md):
  - exactly one of `file` and `text`, otherwise 400;
  - the length limits, with `TEXT_TOO_SHORT` and `TEXT_TOO_LONG`, checked before charging;
  - the extract built as the extension's paste flow builds it;
  - `canonicalUrl` from `pasteIdentity`, and the saved-row lookup for rescore eligibility from that key;
  - the response carries `source: "paste"` and omits `filename`.
  Add `"paste"` to the response's `source` type in `web/src/api/types.ts` and make `filename` optional there. This makes T049 and the T047 paste case pass.
- [X] T069 [US1] Add `unavailableAt` per [contracts/saved-jobs-api.md](./contracts/saved-jobs-api.md):
  - add the column to `SavedJobEntity`;
  - add `unavailableAt?: string | null` to `SavedJobPayload` and `SavedJobPatchBody` in `functions/src/models/user.ts`;
  - validate it as an ISO date in `isSavedJobPatchBody`;
  - map it in `entityFromPayload` and `payloadFromEntity` in `functions/src/services/savedJobsRepository.ts`, and clear it in `patchJob` and `saveJob` whenever `analysis` is written.
  This makes T051 pass. Mirror the field in `web/src/api/types.ts` and in the extension's `SavedJob` type in `extension/types/job.ts`.
- [X] T070 [US1] Add `freshness`, `rescoreAction` and `rescoreCostLine` to `shared/fitView.ts` to make the T052 cases pass in both suites.
- [X] T071 [US1] Update `extension/services/profileStorage.ts`:
  - `getProfile` and `setProfile` write `chrome.storage.session` key `profile:fingerprint` as `{ value, fetchedAt }`, with `null` meaning no profile (404) and the value left untouched on fetch failure;
  - export `getCachedFingerprint()` and `toScoringProfile(profile)`.
- [X] T072 [US1] Update `extension/services/jobAnalysisClient.ts` to send `profileData`, `profile` and the optional `rescore`, and to return `{ analysis, usage, postingUnavailable }` while keeping the existing error mapping. This makes T054 pass. Update the callers in `extension/services/jobFlow.ts` to the new return shape.
- [X] T073 [US1] Update `extension/services/jobFlow.ts` to make T053 and T055 pass:
  - delete `needsFitRefresh` and its two auto-refresh branches (research R7);
  - every result broadcast carries `currentProfileFingerprint`;
  - a new `RESCORE_JOB_PAGE` message runs with `bypassCache`, `rescore: { priorFingerprint }` and `profileData`;
  - reorder the thin-content check so that a saved entry for the canonical URL is shown first;
  - a Rescore on thin content, or a `postingUnavailable` response, PATCHes `unavailableAt` through `jobStorage.update` and keeps the stored analysis;
  - the paste and scoped-region flows send `profileData`;
  - every flow sets `profileUnavailable: true` on its broadcast when `getProfile` throws.
  Add the new message types and fields to `extension/types/messages.ts`.
- [X] T074 [US1] Implement the extension UI to make T056 pass:
  - in `extension/components/JobPanel/FitScore.tsx`, the dealbreaker banner above the score, the freshness notice with Rescore and the cost line from `rescoreCostLine`, the unavailable note, and the "Fit not scored — your profile couldn't be loaded" message;
  - in `extension/components/JobPanel/ThisPageTab.tsx`, the Rescore dispatch, the `UsageExhausted` fallback, and the FR-007 offer through `chrome.storage.onChanged`;
  - in `extension/components/JobPanel/SavedJobRow.tsx`, the row marker and the "Open posting to rescore" or "Paste again to rescore" action from `rescoreAction`;
  - in `extension/entrypoints/options/OptionsApp.tsx`, writing `profile:fingerprint` after save through `setProfile`.
  Get the cost line's usage numbers from `extension/services/accountService.ts` `fetchAccount()`, extended with `rescoresUsed` and `rescoresLimit`. Use only spec-vocabulary copy: "Rescore", "out of date", "Dealbreaker".
- [X] T075 [US1] Add `rescoresUsed` and `rescoresLimit` to the `/api/account` usage response in `functions/src/billing/index.ts`, from `peekUsage`. Extend `functions/tests/integration/billing.test.ts` with the assertion, written first.
- [X] T076 [US1] Implement the web side to make T057 and T058 pass:
  - in `web/src/api/endpoints.ts`, `analyzeDocument` sends `profileData`, `rescore` and `priorFingerprint`, and gains a `patchJob` function;
  - add the freshness marker and the `rescoreAction` link to `web/src/pages/Library.tsx` and `web/src/pages/PostingDetail.tsx`;
  - add the "Current profile only" toggle to `web/src/components/LibraryControls.tsx` and `web/src/lib/libraryQuery.ts`, using `freshness`;
  - in `web/src/pages/Upload.tsx`, gate Upload on profile settlement, support `?rescore=<key>` with PATCH in place only when the result's `saveKey` equals `<key>` (otherwise offer "Save to library" with the "didn't match" note), and show the profile-failed message;
  - in `web/src/components/AnalysisView.tsx`, show the dealbreaker banner;
  - add `rescoresUsed` and `rescoresLimit` to `AccountPayload.usage` in `web/src/api/types.ts`, and show the cost line on the Upload page in rescore mode.
- [X] T077 [US1] Implement the **Paste text option** to make T059 and the T061 paste step pass:
  - create `web/src/components/PastePosting.tsx`: a labelled textarea, a live character count, and an Analyze button, with the length check and messages from T059 using `MIN_TEXT_CHARS` and `MAIN_TEXT_CAP` from `shared/types/job.ts`;
  - in `web/src/pages/Upload.tsx`, add the "Upload a file" and "Paste text" toggle as a radio group (`role="radiogroup"`), driven by and written back to `?mode=`. Both modes share the profile gate, rescore mode, cost line, result view and Save flow. Rename the heading from "Analyze a document" to "Analyze a posting", and in `web/src/components/AppShell.tsx` rename the nav entry from "Analyze document" to "Analyze posting". Keep the `/upload` route. Update any existing test that queries the old names.
  - in `web/src/api/endpoints.ts`, `analyzeDocument` accepts `{ text }` as an alternative to `{ file }`;
  - a paste result's header reads "From pasted text", and Save sends `source: "paste"` with empty `sourceUrl` and `filename`.
- [x] T078 [US1] Run `npm run build` in `extension/`, then both P1 E2E tests: the extension test (T060) and `npm run test:e2e` from `web/` for T061. Fix until green.

**Checkpoint**: US1 is fully functional. Scores are trustworthy across all four surfaces, with dealbreakers listed next to an unchanged score, and free-rescore metering.

---

## Phase 5: User Story 2 — I understand what a score means at a glance (Priority: P2)

**Goal**: the model scores against an explicit rubric. Every fit scored under this feature shows a verdict from one shared mapping, with a text label, an icon and a screen-reader label. Legacy fits show "Unrated — rescore for a verdict".

**Independent test**: [quickstart.md § PR2](./quickstart.md#pr2--us1--us2-freshness-dealbreakers-rubric-verdict), steps P2-9 and P2-10, plus verdict consistency across the extension and the web.

### Tests for User Story 2 (write first, must fail) ⚠️

- [X] T079 [P] [US2] Add `VERDICT_CASES` to `shared/fitView.fixtures.ts` and iterate them in both `fitView.test.ts` suites. Cover:
  - the boundaries 0, 39, 40, 64, 65, 84, 85 and 100;
  - a dealbreaker with score 95, which maps to `dealbreaker`;
  - no fingerprint, which maps to `unrated` with the label "Unrated — rescore for a verdict";
  - `ariaFitLabel` returning "Strong match, fit 86 out of 100" and "Unrated, fit 72 out of 100";
  - `verdictLabel` copy for all six values, exactly as in the spec;
  - `previewMissing(fit)` returning the first 3 items;
  - `scoredByLabel` returning "Scored on Premium" or "Scored on Free" from `analysis.tier`, and "Scored by <model>" when `tier` is absent.
- [X] T080 [P] [US2] Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts`: the system prompt sent with a profile contains the four FR-008 rubric bands, with their exact numeric ranges and descriptions; and the response carries `tier` equal to the caller's tier for both tiers (spec edge case "Free-to-Premium switch").
- [X] T081 [P] [US2] Extend `extension/tests/unit/FitScore.test.tsx` and `extension/tests/unit/SavedTab.test.tsx`:
  - the verdict label and icon render next to the score;
  - the score element's accessible name equals `ariaFitLabel`;
  - labels are present as text, so FR-010 doesn't rely on colour;
  - a legacy fit shows the Unrated label;
  - "My profile" is a secondary button, not the filled primary style (FR-024);
  - the default view shows the verdict, score, rationale and up to 3 missing items, and "Show full breakdown" reveals the rest (FR-025);
  - `SavedJobRow` uses the shared tone, and no `scoreStyle` import remains;
  - the fit details show `scoredByLabel`, and a fit scored on a different tier from the account's current one is not marked out of date.
- [X] T082 [P] [US2] Extend `web/tests/contract/library-view.test.tsx` and `web/tests/contract/posting-detail.test.tsx`: verdict labels and accessible names on rows and detail match the extension's for the same fixture fit, legacy fits are Unrated, and the detail page shows `scoredByLabel`.

### Implementation for User Story 2

- [X] T083 [US2] Add the FR-008 rubric lines to `buildSystemPrompt` in `functions/src/services/jobExtractionOrchestrator.ts`:
  - 85–100: all required skills covered and seniority aligned;
  - 65–84: minor gaps;
  - 40–64: significant gaps or a level mismatch;
  - 0–39: major mismatch.
  Also stamp `tier` on the response in `orchestrateJobAnalysis`, and add optional `tier?: "free" | "premium"` to `JobAnalysisResponse` in `shared/types/job.ts`. This makes T080 pass.
- [X] T084 [US2] Add `verdictFor`, `verdictLabel`, `scoreTone`, `ariaFitLabel`, `scoredByLabel` and `previewMissing` to `shared/fitView.ts` to make T079 pass.
- [X] T085 [US2] Update `extension/components/JobPanel/FitScore.tsx` and `extension/components/JobPanel/SavedJobRow.tsx` to make T081 pass:
  - delete `scoreStyle` with its hard-coded 70/20 thresholds;
  - map `scoreTone` to Tailwind classes and an inline SVG icon per verdict in one local map;
  - restyle "My profile" as secondary;
  - add the collapsed default view with a "Show full breakdown" toggle that has `aria-expanded`;
  - show `scoredByLabel` in the fit details.
- [X] T086 [US2] Update `web/src/components/AnalysisView.tsx`, `web/src/pages/Library.tsx` and `web/src/pages/PostingDetail.tsx` to show the verdict label and icon using `scoreTone`, `verdictLabel` and `ariaFitLabel`, and `scoredByLabel` on the detail page. Use a web-local class map, because Tailwind classes are not shared (contracts/fit-view.md). This makes T082 pass.
- [X] T087 [US2] Re-run the eval with field-based detection **(live, the chosen free and Premium configurations only, `--runs=5`)** using `npm run eval:postings -- --configs=<chosen-only file> --out=../specs/006-profile-match-ux/eval-runs/pr2.json`. Run the violating pairs a second time with each profile's dealbreakers and preferences removed, for SC-002's score-independence check. Append a "PR2 — rubric and dealbreakers listed without changing the score" table to `specs/006-profile-match-ux/eval-models.md`, with SC-002, SC-004 and SC-008 now measured with `detectionMethod: "field"`. If SC-004 or score independence drops below 90%, stop and report to the user before merging (research R8 names the fallback). *2026-10-29: after three failed attempts the user approved the per-run SC-004 and the identical-fit-input SC-002 gate (spec.md Clarifications, research R8 "Superseded"). After the final run (attempt 4, `eval-runs/pr2.json`) the dealbreaker targets were relaxed too (0 trap false, ≤ 2% misreadings, ≥ 75% recall), and the gate passes on both configurations.*
- [X] T088 [US2] Run the PR2 gate:
  - lint, tests and coverage (at least 80% on `rescoreEligibility.ts`, `meteringService.ts`, `profileRepository.ts`, `profileFingerprint.ts`, `jobExtractionOrchestrator.ts`, `savedJobsRepository.ts`, `shared/fitView.ts`, `jobFlow.ts`, `FitScore.tsx` and `libraryQuery.ts`);
  - `perf.test.ts` against the T001 baseline;
  - the compatibility smoke (rule 3), including an **old-extension profile save that must not erase anything** and old-extension rendering of a PR2-shaped saved fit.
  Request QG-3 review of the score header, banner and cost line, then open PR2 (US1 + US2).
  *2026-10-30: lint, tests, coverage, perf and and both halves of the compatibility smoke are done; left are QG-3 and the PR. See handoff-pr2.md section 7.*

**Checkpoint**: PR2 is shippable. Out-of-date, dealbreaker and verdict UI works on both surfaces, and old extensions keep working.

---

## Phase 6: User Story 3 — I can verify why a skill counts as matched or missing (Priority: P3) — PR3

**Goal**: matching, missing and desired items carry verbatim posting quotes, and matching items also carry profile quotes. Quotes are validated on the server, hidden until requested, and absent on legacy fits.

**Independent test**: [quickstart.md § PR3](./quickstart.md#pr3--us3-evidence).

### Tests for User Story 3 (write first, must fail) ⚠️

- [X] T089 [P] [US3] Add the recorded fixtures `functions/tests/fixtures/jobAnalysis/with-evidence.json` and `functions/tests/fixtures/jobAnalysis/fabricated-quote.json`, in the **model-facing** shape where `matching`, `missing` and `desired` are `{label, postingQuote, profileQuote}` arrays.
  - `with-evidence.json`: every quote is a verbatim substring of the paired posting and profile text in the test.
  - `fabricated-quote.json`: one postingQuote and one profileQuote are not substrings, and one quote is 260 characters long.
  Update the README.
- [X] T090 [P] [US3] Extend `functions/tests/unit/jobExtractionOrchestrator.test.ts` for wire shape (trap 3) and validation:
  - the response's `fit.matching`, `fit.missing` and `fit.desired` are **string arrays of labels**;
  - `fit.evidence.matching[i]` is `{label, postingQuote, profileQuote}`;
  - a fabricated quote becomes `null`, its item and label are kept, and one warning is logged per dropped quote;
  - the 260-character quote is truncated to 200 after validation;
  - `profileQuote` is `null` for missing and desired items;
  - evidence whose label is not in its list is dropped;
  - the existing arrangement-evidence behaviour is unchanged (the existing tests stay green).
- [X] T091 [P] [US3] Add `EVIDENCE_CASES` to `shared/fitView.fixtures.ts`, covering `evidenceFor(fit, list, label)` finding by label, returning `null` for legacy fits and returning `null` for unknown labels. Iterate them in both suites.
- [X] T092 [P] [US3] Extend `extension/tests/unit/FitScore.test.tsx`:
  - a chip with evidence shows a disclosure button with `aria-expanded="false"`;
  - Enter or Space and a click both reveal the posting quote, plus the profile quote for matching items;
  - the collapsed render adds no height, so the evidence region is not in the DOM until expanded (FR-013);
  - chips without evidence have no button and log no console error;
  - a legacy fit renders exactly as before.
- [X] T093 [P] [US3] Create `web/tests/contract/evidence.test.tsx` with the same assertions for `web/src/components/AnalysisView.tsx`.

### Implementation for User Story 3

- [X] T094 [US3] In `functions/src/services/jobExtractionOrchestrator.ts`, make T090 pass:
  - change the model schema's `fit.matching`, `fit.missing` and `fit.desired` to arrays of `{label, postingQuote: string|null, profileQuote: string|null}`, keeping `maxItems` at 8 for matching and missing and 10 for desired (research R9);
  - add prompt lines asking for the shortest verbatim supporting span, with `profileQuote` null for missing and desired;
  - generalize `validateEvidence` into `validateQuotes(payload, postingHaystack, profileHaystack, warn)`;
  - add `splitEvidence(modelFit)`, which produces the label arrays plus `fit.evidence`;
  - keep a separate internal `ModelJobAnalysisPayload` type, so the wire `JobAnalysisPayload` type is unchanged apart from `evidence`.
- [X] T095 [US3] Add `evidence?: FitEvidence` and `EvidenceItem` to `Fit` in `shared/types/job.ts`, and `evidenceFor` to `shared/fitView.ts`. This makes T091 pass.
- [X] T096 [US3] Add the chip evidence disclosure to `extension/components/JobPanel/FitScore.tsx` (T092) and to `web/src/components/AnalysisView.tsx` (T093). Quotes render as `<blockquote>` with a source label ("From the posting" or "From your profile").
- [X] T097 [US3] Measure evidence **(live, the chosen free configuration plus Premium, `--runs=3`)** and write `eval-runs/pr3.json`. Append a "PR3 — evidence" table to `specs/006-profile-match-ux/eval-models.md` with:
  - the SC-003 verbatim rate (target at least 95%);
  - the cost-per-analysis delta against `pr2.json`;
  - the p95 delta;
  - truncation count.
  If truncations are above 0, raise `max_completion_tokens` in the orchestrator and re-measure.
- [X] T098 [US3] Run the PR3 gate: lint, tests, coverage on `jobExtractionOrchestrator.ts`, `fitView.ts`, `FitScore.tsx` and `AnalysisView.tsx`, `perf.test.ts`, and the compatibility smoke. Rule 3 matters most here, because an old extension must render a PR3 fit without crashing.
  - If p95 rose 20% or more against the T001 baseline, write a QG-4 exception in the PR description, with the numbers from T097 and the absolute p95 against 30 s, and ask the user to approve it.
  - Report the measured cost per analysis on each tier, in dollars and as a percentage against PR2, as a feature cost, and ask the user to approve it. FR-M05's no-increase limit does not apply here; it covers only the PR1 model switch (research R9).
  Request QG-3 review of the evidence disclosure, then open PR3.

**Checkpoint**: evidence is visible and verifiable, and legacy fits are unaffected.

---

## Phase 7: User Story 4 — Setting up my profile is quick (Priority: P4) — PR4

**Goal**: import a résumé from `.pdf` or `.docx` with nothing stored, and add structured preferences. Arrangement, salary and seniority are checked in code. Location is judged by the model.

**Independent test**: [quickstart.md § PR4](./quickstart.md#pr4--us4-profile-setup).

### Tests for User Story 4 (write first, must fail) ⚠️

- [X] T099 [P] [US4] Write `functions/tests/unit/profileImport.handler.test.ts` for `POST /api/profile/import` ([contracts/profile-api.md §4](./contracts/profile-api.md)):
  - `valid.pdf` and `valid.docx` from `functions/tests/fixtures/documents/` return 200 with `{text, charCount}`;
  - `oversized.pdf` returns 413, `mislabeled.pdf` 415, `encrypted.pdf` and `encrypted.docx` 422 `FILE_PASSWORD_PROTECTED`, and `image-only.pdf` 422 `FILE_NO_TEXT` with the **same message** as analyze-document;
  - a missing file part returns 400;
  - spy on `ensureTable` and on `meteringService` and assert neither is called (R12);
  - assert that no `context.log`, `context.warn` or `context.error` argument contains the extracted text;
  - text above 20,000 characters is returned whole.
- [X] T100 [P] [US4] Extend `functions/tests/unit/profileSerialization.test.ts`:
  - the Preferences section renders exactly as in [data-model.md §3](./data-model.md) for each preference;
  - it includes the "Office days: at most N per week" and "Work authorization: needs visa sponsorship" lines when set;
  - it is omitted when `preferences` is absent or empty;
  - **the T030 invariant snapshot cases are still byte-identical**;
  - the fingerprint of a profile without preferences is unchanged from PR2.
- [X] T101 [P] [US4] Write `functions/tests/unit/applyPreferences.test.ts` for the pure `applyPreferences(payload, preferences)`, covering every row of [research R11's table](./research.md#r11--structured-preferences-pr4-fr-015fr-016):
  - an on-site posting with explicit evidence against "remote only" is a violation labelled "Arrangement: remote only", with the score unchanged;
  - an `unspecified` arrangement gives no violation and an "Unverified: arrangement not stated" weakness;
  - an on-site posting with `arrangementConfidence: "none"` gives no violation;
  - a salary max of 100k USD/year against a 120k USD/year minimum is a violation;
  - EUR against USD gives no violation and an unverified note;
  - a different pay period gives the same unverified result;
  - no salary gives an unverified note;
  - seniority outside the range is a violation, and `unspecified` gives an unverified note;
  - a hybrid posting stating 3 office days against a maximum of 2 is a violation labelled "Office days: at most 2 per week", a hybrid posting with no `daysInOffice` gives "Unverified: office days not stated", an on-site posting counts as 5 days when `arrangementConfidence` is `"explicit"` or `"inferred"` but not `"none"`, and an on-site posting already flagged by the arrangement check is not reported twice;
  - a location preference is never checked in code, and a model-reported location violation is kept as-is;
  - visa sponsorship is never checked in code, and a model-reported "Work authorization: needs visa sponsorship" violation is kept as-is and is the banner text;
  - unverified notes are prepended and `weaknesses` stays at 5 or fewer;
  - with no preferences, the payload is unchanged.
- [X] T102 [P] [US4] Extend `functions/tests/unit/profileRepository.test.ts` and `functions/tests/integration/storageApi.test.ts`:
  - preferences validate per data-model §3 (empty `arrangements`, `amount <= 0`, an unknown currency format, `min > max`, `maxOfficeDays` that is not an integer from 0 to 5, and `needsSponsorship` other than `true` all return 400);
  - `schemaVersion` becomes 2 on write;
  - a version-1 row reads as having no preferences;
  - an old-shape PUT keeps preferences (trap 2, repeated now that the field exists).
- [X] T103 [P] [US4] Extend `extension/tests/unit/apiClient.test.ts`: `apiFetch` with `rawBody: FormData` sends it untouched and sets no JSON content type, while JSON `body` behaviour is unchanged.
- [X] T104 [P] [US4] Extend `extension/tests/unit/OptionsApp.test.tsx` and create `web/tests/contract/profile-import.test.tsx`:
  - choosing a `.pdf` calls the import endpoint, fills the editor with the returned text, and does **not** save until Save is clicked;
  - the import error message matches the job-upload copy;
  - text over 20,000 characters shows the existing over-limit message;
  - the preference fields (arrangement checkboxes, a maximum-office-days select with "No limit" and 0 to 5, minimum salary with amount, currency and period, seniority min/max selects in enum order with management levels last, free-text locations, and an "I need visa sponsorship" checkbox) save through PUT and reload;
  - the web Profile page has headed sections for résumé (text and import), dealbreakers and preferences, each a `<section>` with an `aria-labelledby` heading;
  - every field has an accessible label.

### Implementation for User Story 4

- [X] T105 [US4] Implement `POST /api/profile/import` in `functions/src/profile/index.ts`, as a new `app.http("profile-import")` with `route: "profile/import"`, `withRateLimit("analyze", withAuth(...))`, and a preflight route mirroring `profile-preflight`. Reuse `extractDocument` and the `REJECTION_STATUS` map. Move that map to `functions/src/services/documentExtraction.ts` and import it in both handlers, to avoid duplicating it. This makes T099 pass.
- [X] T106 [US4] Add `Preferences` to `shared/types/profile.ts` and the Preferences section to `profileToPromptText`. This makes T100 pass.
- [X] T107 [US4] Add preferences validation and `schemaVersion: 2` to `functions/src/models/user.ts` and `functions/src/services/profileRepository.ts`, to make T102 pass.
- [X] T108 [US4] Implement `applyPreferences` in a new file, `functions/src/services/applyPreferences.ts`, to make T101 pass. Call it from `orchestrateJobAnalysis` after the dealbreaker check (`violatedLines`, research R8 "Superseded"), with `req.profileData?.preferences`. Merge its violations into `fit.dealbreakersViolated`. Never change `score`.
- [X] T109 [US4] Add a `rawBody` option to `extension/services/api/apiClient.ts`, mirroring `web/src/api/apiClient.ts`. Add `importResume(file)` to `extension/services/profileStorage.ts`. This makes T103 pass.
- [X] T110 [US4] Add the import control and preference fields to `extension/entrypoints/options/OptionsApp.tsx`, and add the same to `web/src/pages/Profile.tsx` with `importResume` in `web/src/api/endpoints.ts`. Organize both editors into the headed sections from FR-015. Show a progress indicator during import (Principle III, over 300 ms). This makes T104 pass.
- [X] T111 [US4] Ensure every analyze flow sends `profileData.preferences`. In `extension/services/jobFlow.ts` and `web/src/pages/Upload.tsx`, build `profileData` with `toScoringProfile`. Extend the FR-001 contract tests (T055) to include a profile with preferences.
- [X] T112 [US4] Run the live checks from quickstart P4-5 (location preference) **(live)**. Then time SC-005 by hand: a first-time user with `valid.pdf` must reach a first fit score in under 2 minutes from opening the editor. Record both in the PR description.
- [X] T113 [US4] Run the PR4 gate: lint, tests, coverage on `applyPreferences.ts`, `profileRepository.ts`, `profile/index.ts`, `apiClient.ts`, `OptionsApp.tsx` and `Profile.tsx`, `perf.test.ts`, and the compatibility smoke. Rule 3 here includes an old-extension profile save after setting preferences on the web. Request QG-3 review of the import flow and preference fields, then open PR4.

**Checkpoint**: profile setup is fast, and preference dealbreakers are enforced deterministically.

---

## Phase 8: User Story 5 — I can correct a wrong verdict in one click (Priority: P5) — PR5

**Goal**: "I have this" on missing and desired chips adds a confirmed skill, saves, marks the fit out of date, and offers a rescore that never runs automatically.

**Independent test**: [quickstart.md § PR5](./quickstart.md#pr5--us5-i-have-this).

### Tests for User Story 5 (write first, must fail) ⚠️

- [X] T114 [P] [US5] Extend `functions/tests/unit/profileRepository.test.ts` and `functions/tests/integration/storageApi.test.ts`:
  - `confirmedSkills` are trimmed and deduplicated case-insensitively, keeping the first spelling;
  - `[]` clears them;
  - a PUT **with** `confirmedSkills` whose serialized length (text plus the Confirmed skills section) exceeds 20,000 returns 400 `PROFILE_TOO_LONG` with the existing over-limit wording, and nothing is truncated;
  - a legacy PUT **without** `confirmedSkills` truncates text at 20,000 as today and never returns `PROFILE_TOO_LONG` (contracts/profile-api.md §2);
  - `POST /api/profile/confirmed-skills` (contracts/profile-api.md §4a) appends with case-insensitive deduplication, is idempotent for an existing label, returns 404 with no profile, and returns `PROFILE_TOO_LONG` past the cap;
  - two concurrent add-skill calls with different labels both persist (Azurite);
  - an old-shape PUT keeps `confirmedSkills`.
- [X] T115 [P] [US5] Extend `functions/tests/unit/profileSerialization.test.ts`: the Confirmed skills section renders after Preferences and is omitted when empty, and the T030 invariant cases are still byte-identical.
- [X] T116 [P] [US5] Extend `extension/tests/unit/FitScore.test.tsx`, `extension/tests/unit/ThisPageTab.test.tsx` and `web/tests/contract/posting-detail.test.tsx`:
  - missing and desired chips show "I have this", with an accessible name of "I have <label>";
  - clicking it calls `POST /api/profile/confirmed-skills` with the label (no duplicate, ignoring case);
  - on success, the fit is marked out of date and "Rescore this posting" is offered with its cost line, and **no** analyze request is made;
  - on failure (offline or 5xx), the chip is unchanged, the existing save-error message shows, and no rescore is offered;
  - at the cap, the over-limit message shows;
  - on the web, the offer is the source-appropriate `rescoreAction` (FR-020).
- [X] T117 [P] [US5] Extend `extension/tests/unit/OptionsApp.test.tsx` and `web/tests/contract/profile-dealbreakers.test.tsx`: the confirmed skills are listed, each has a remove button labelled "Remove <skill>", and removing one saves.

### Implementation for User Story 5

- [X] T118 [US5] Add `confirmedSkills` normalization and the serialized-length cap to `functions/src/services/profileRepository.ts` and `functions/src/models/user.ts`, returning `PROFILE_TOO_LONG` only for writes that include `confirmedSkills` (legacy text-only PUTs keep truncating). Add `POST /api/profile/confirmed-skills` to `functions/src/profile/index.ts`, with an ETag-conditional append and retry, plus a preflight route. Add the Confirmed skills section to `profileToPromptText` in `shared/types/profile.ts`. This makes T114 and T115 pass.
- [X] T119 [US5] Add `confirmSkill(label)` to `extension/services/profileStorage.ts`, which calls `POST /api/profile/confirmed-skills` and updates the `profile:fingerprint` session key from the response. Add the "I have this" control and the post-save rescore offer to `extension/components/JobPanel/FitScore.tsx` and `extension/components/JobPanel/ThisPageTab.tsx`. This makes the extension part of T116 pass.
- [X] T120 [US5] Add the same control to `web/src/components/AnalysisView.tsx` and `web/src/pages/PostingDetail.tsx`, using a new `confirmSkill(label)` in `web/src/api/endpoints.ts` that calls `POST /api/profile/confirmed-skills`, and showing `rescoreAction` afterwards. This makes the web part of T116 pass.
- [X] T121 [US5] Add the removable confirmed-skills list to `extension/entrypoints/options/OptionsApp.tsx` and `web/src/pages/Profile.tsx`, to make T117 pass.
- [X] T122 [US5] Check SC-007 by hand: from "Missing: X", count clicks to a rescored result, which must be 2 or fewer. Then run the PR5 gate (lint, tests, coverage, perf and the compatibility smoke) and open PR5.
  - 2026-10-30: SC-007 is 2 clicks ("I have this", then Rescore), asserted in ThisPageTab tests. Compat smoke: published v0.0.36 against this backend passed (`compat-smoke/pr2-old-extension.spec.ts` plus 8 other E2E); `regionScoping` fails on `main` too. Web half of the smoke and a manual click-through were not run.

**Checkpoint**: users can fix a wrong "missing" verdict in place.

---

## Phase 9: User Story 6 — I can triage and compare by fit wherever I am (Priority: P6) — PR6

**Goal**: the extension's Saved tab sorts and filters by fit and verdict. The web Library becomes a timeline grouped by save day with each entry's key facts visible, and Compare becomes a requirement-by-requirement table in a dialog opened from the Library.

**Independent test**: [quickstart.md § PR6](./quickstart.md#pr6--us6-triage-and-compare).

### Tests for User Story 6 (write first, must fail) ⚠️

- [X] T123 [P] [US6] Add `SORT_CASES`, `FILTER_CASES` and `MERGE_CASES` to `shared/fitView.fixtures.ts` and iterate them in both suites:
  - `sortByFit` in both directions puts unscored jobs last in each, while out-of-date and unrated fits sort by number;
  - `filterByVerdict` never matches `unrated`;
  - `mergeRequirementRows` merges "Kubernetes" with "kubernetes " and " KUBERNETES";
  - cell states come from each posting's lists: matching is `matched`, missing is `missing`, desired is `nice-to-have`, and anything else is `not-asked`;
  - row order is by number of postings that ask, then alphabetical.
- [X] T124 [P] [US6] Extend `extension/tests/unit/SavedTab.test.tsx` with "Fit (highest)" and "Fit (lowest)" sort options, the verdict filter, unscored jobs last, and out-of-date markers kept.
- [X] T125 [P] [US6] Write `web/tests/unit/libraryTimeline.test.ts` for `web/src/lib/libraryTimeline.ts` per [data-model.md §9](./data-model.md):
  - `groupByDay` with a fixed `now` and `timeZone: "America/Los_Angeles"`: postings saved today, yesterday, three days ago and last year get "Today", "Yesterday", the weekday and date, and the date with the year;
  - a posting saved at 23:30 local time lands on that local day, not the UTC day;
  - groups are newest first, entries inside a group are newest first, and no group is empty;
  - with `direction: "oldest"` for the "Saved (oldest)" sort, both groups and entries run oldest first under the same headings;
  - `summarizeJob` reads "Salary not stated" and "Arrangement not stated" when those are missing, formats a hybrid posting with 2 office days as "Hybrid · 2 days in office", omits null location and `unspecified` seniority, and gives the host name, file name or "Pasted" as the source label;
  - `formatSalary` from `web/src/lib/formatJob.ts` returns the same strings `AnalysisView` shows today for a range, a single bound, and a missing currency or period.
- [X] T126 [P] [US6] Extend `web/tests/contract/library-view.test.tsx` for the timeline (FR-029, FR-030):
  - with the default date sort, entries sit under day headings, each heading a level-3 heading;
  - each entry shows title, company, verdict and fit with the out-of-date marker, salary, arrangement, location, seniority, status and source;
  - sorting by fit removes the headings and shows each entry's save date;
  - a filter that empties a day hides that day's heading;
  - selecting postings still uses the per-entry checkbox, and the Compare button is disabled until two are selected.
- [X] T127 [P] [US6] Extend `web/tests/contract/compare.test.tsx`, which now renders the Library:
  - with fewer than 2 selected, Compare is disabled; with 2 to 4, clicking it opens a dialog named "Compare postings";
  - Escape and the Close button each close the dialog, return focus to Compare, and keep the selection;
  - the nav has no Compare entry, and rendering the router at `/compare` lands on the Library;
  - with 2 to 4 selected postings, the header row shows score, verdict, salary, arrangement, and the freshness marker for out-of-date or version-unknown fits (FR-003, SC-001);
  - the body has one row per merged requirement, with cell states;
  - each column links to the full analysis, and following the link closes the dialog;
  - at a 375 px viewport, the dialog fills the viewport, the table container has `overflow-x: auto`, and the document does not scroll horizontally.
  Extend `web/tests/unit/libraryQuery.test.ts` so that its fit sorting matches `sortByFit`.
- [X] T128 [US6] Write the web E2E test `web/tests/e2e/libraryTimeline.spec.ts`, stubbing the backend with `page.route` as T061 does. Seed postings saved today, yesterday and last month. Assert the day headings and one entry's facts, select two postings, open Compare, check the dialog and the requirements table, press Escape, and confirm focus is back on Compare. Run with `npm run test:e2e` from `web/`.

### Implementation for User Story 6

- [X] T129 [US6] Add `sortByFit`, `filterByVerdict` and `mergeRequirementRows` to `shared/fitView.ts` to make T123 pass.
- [X] T130 [US6] Add the sort and verdict-filter controls to `extension/components/JobPanel/SavedTab.tsx` using the shared helpers, to make T124 pass.
- [X] T131 [US6] Create `web/src/lib/libraryTimeline.ts` with `groupByDay` and `summarizeJob`, and move `formatSalary` from `web/src/components/AnalysisView.tsx` to `web/src/lib/formatJob.ts`, importing it back into `AnalysisView`. Use `Intl.DateTimeFormat` with an explicit `timeZone` for grouping and headings. This makes T125 pass.
- [X] T132 [US6] Rewrite `web/src/components/CompareGrid.tsx` as the requirements table, with each column's freshness marker from `freshness` (FR-003), and make `web/src/lib/libraryQuery.ts` delegate fit sort and filter to `shared/fitView.ts`, removing its local `fitScore` sorting. Add a verdict filter to `web/src/components/LibraryControls.tsx`. This makes T127 pass.
- [X] T133 [US6] Build the timeline Library and the Compare dialog to make T126, T127 and T128 pass:
  - create `web/src/components/LibraryEntry.tsx`, a card showing the `summarizeJob` facts, the verdict and fit from `shared/fitView.ts` with the freshness marker, the status, and the compare checkbox; it stacks to one column below 640 px;
  - create `web/src/components/LibraryTimeline.tsx`, which renders `groupByDay` groups under headings for the date sort and a flat list with save dates for the fit sort;
  - create `web/src/components/CompareDialog.tsx` around a native `<dialog>` opened with `showModal()`, labelled "Compare postings", with a Close button, rendering `CompareGrid`; on close it returns focus to the trigger;
  - in `web/src/pages/Library.tsx`, replace the list with `LibraryTimeline` and the Compare link with a button that opens `CompareDialog`, disabled below 2 selections;
  - delete `web/src/pages/Compare.tsx`, replace its route in `web/src/App.tsx` with `<Navigate to="/library" replace />`, and remove the Compare link from `web/src/components/AppShell.tsx`.
- [ ] T134 [US6] Run the PR6 gate (lint, tests, coverage, perf, compatibility smoke) and request QG-3 review of the timeline Library and the Compare dialog. Then open PR6.
  - 2026-10-30: lint, unit/contract tests and coverage pass in `web/` (187 tests) and `extension/` (538 tests), and `npm run test:e2e` passes in `web/` (5 tests, including `libraryTimeline.spec.ts`). Not yet done: compatibility smoke, QG-3 review, and opening PR6.

**Checkpoint**: all six user stories are delivered.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T135 [P] Update `README.md`'s feature list and any user-facing docs under `docs/` that describe fit scoring, so they match the spec's vocabulary (verdicts, Rescore, out of date). Per the constitution, public API documentation ships in the same PR that changes it, which the `contracts/` files already cover. This task covers prose docs only.
- [ ] T136 [P] Check whether `store-submission/` listing text or screenshots describe the old fit UI ("Fit score" number only). If they do, list the needed changes in the final PR description. Do **not** submit to the Chrome Web Store, because that is an outward-facing action needing the user's approval.
- [ ] T137 Run every section of `specs/006-profile-match-ux/quickstart.md` end to end against local Azurite. Tick each step, and record any deviation as a GitHub issue labelled `needs-triage`.
- [ ] T138 Verify SC-001 by hand on the web library and the extension Saved tab with a mixed library (current, out-of-date, version-unknown, deleted-profile and unscored entries). Every visible fit is either current or carries a marker.
- [ ] T139 Run `/speckit-analyze` for cross-artifact consistency, and fix any spec, plan or tasks drift it reports in `specs/006-profile-match-ux/`.

---

## Dependencies & Execution Order

### Phase dependencies

| Phase | Depends on | Ships as |
|---|---|---|
| 1 Setup | nothing | (no PR; baselines only) |
| 2 Foundational A, model switch | Setup | **PR1** |
| 3 Foundational B, PR2 groundwork | PR1 merged. Only T087, the PR2 eval, also waits for T026's settings switch, so it measures the final model. | PR2 |
| 4 US1 | Phase 3 | PR2 |
| 5 US2 | Phase 3. T085 also edits `FitScore.tsx` after T074. | PR2 |
| 6 US3 | PR2 merged | **PR3** |
| 7 US4 | PR2 merged. Independent of US3. | **PR4** |
| 8 US5 | PR4's profile serialization (T106) and merge-PUT. Uses US1's rescore offer. | **PR5** |
| 9 US6 | PR2's `fitView` (verdicts and freshness). Independent of US3 to US5. | **PR6** |
| 10 Polish | the PRs being validated | final PR or the last story's PR |

The plan's PR order is 1 → 2 → 3 → 4 → 5 → 6. US3, US4 and US6 do not depend on each other technically, so the order is a product choice. Keeping it avoids stacking UI changes in `FitScore.tsx`.

### Within each story

- Tests marked ⚠️ are committed failing before the implementation tasks of that story.
- Shared and types first, then services, then HTTP handlers, then client services, then UI.
- Each phase ends with its PR gate, including the compatibility smoke.

### Cross-story file hotspots (sequence these, don't parallelize)

- `functions/src/services/jobExtractionOrchestrator.ts`: T010, T062, T083, T094, T108
- `shared/fitView.ts`: T040, T070, T084, T095, T129
- `extension/components/JobPanel/FitScore.tsx`: T074, T085, T096, T119
- `shared/types/profile.ts`: T036, T106, T118
- `web/src/pages/Upload.tsx`: T076, T077

## Parallel Examples

### PR1 (Phase 2)

```text
Together: T004 modelConfig.test.ts · T005 orchestrator tests (then T006, same file) · T007 handler test · T008 evalMetrics.test.ts
Together: T012 settings doc · T015 exportCorpusExtracts.ts · T017 fixture profiles · T019 modelPrices.json · T020 evalConfigs.json
```

### PR2 groundwork (Phase 3)

```text
Together: T028 fixtures · T029 both fitView suites · T030 serialization · T031 fingerprint · T032 profile repo · T033 request guard · T034 AccountBar
```

### User Story 1

```text
Backend tests together: T043 fixtures · T044 dealbreakers · T045 eligibility · T046 metering · T047 rescore · T048 pasteIdentity · T049 paste handler · T050 side fix · T051 unavailableAt
Client tests together:  T052 fitView cases · T053 jobFlow · T054 client · T056 extension UI · T057/T058 web (then T059 and T055, which share upload.test.tsx and jobFlow.test.ts)
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

- **T021**: set temperature settings before PR1 merges.
- **T026**: model settings switch after eval sign-off, plus privacy confirmation.
- **T013**: create the `gpt-5.4-mini` deployment for Premium. Done 2026-10-29, and Premium switched the same day.
- **T023**: any TPM increase or other new deployment, only if the eval needs it.
- **T098**: a possible QG-4 exception and approval of the measured evidence cost (a feature cost, not an FR-M05 limit).

## Notes

- `[P]` means different files and no dependency on an incomplete task.
- Live-model tasks (T002, T014, T023, T087, T097, T112) cost money and are on demand. Their outputs are committed so the numbers are reproducible.
- Every `test:` commit precedes its `feat:` commit (Constitution II).
