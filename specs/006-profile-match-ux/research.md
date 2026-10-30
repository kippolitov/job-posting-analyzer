# Research: Trustworthy, Actionable Profile Match

**Feature**: `006-profile-match-ux` | **Date**: 2026-10-28 | **Plan**: [plan.md](./plan.md)

Each item records a decision, why it was made, and what was rejected. Items are
ordered by the PR that first needs them. The Clarifications in
[spec.md](./spec.md) are inputs, not open questions, and are not revisited here.

Code facts cited below were read from the branch at `079b7f3`.

---

## R1 — Per-deployment request settings (PR1, FR-M04)

**Decision**: The orchestrator builds its request options from per-tier
environment variables. Each one is omitted from the request when unset or empty.

| Setting | Free | Premium |
|---|---|---|
| Deployment | `AZURE_OPENAI_JOB_DEPLOYMENT` (existing, falls back to `AZURE_OPENAI_DEPLOYMENT`) | `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` (existing, falls back to free) |
| Temperature | `AZURE_OPENAI_JOB_TEMPERATURE` | `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM` |
| Reasoning effort | `AZURE_OPENAI_JOB_REASONING_EFFORT` | `AZURE_OPENAI_JOB_REASONING_EFFORT_PREMIUM` |
| API version | `AZURE_OPENAI_API_VERSION` (shared) | same |

- A Premium request setting does **not** fall back to the free one. When Premium
  falls back to the free *deployment*, it also uses the free *settings*, because
  the settings belong to the deployment, not the tier.
- `reasoning_effort` is validated against `none | low | medium | high | xhigh`.
  An invalid value fails at startup with a logged error, not per request.
  `minimal` is rejected because `gpt-6-luna` rejects it.
- Temperature must parse as a finite number in `[0, 2]`. Anything else is a
  startup error.
- Resolution lives in one pure function, `resolveModelConfig(tier, env)`, that is
  unit-tested without a network. The orchestrator calls it per request, which is
  cheap, so a settings change takes effect on the next cold start without code.

**API version**: the orchestrator pins `apiVersion: "2024-08-01-preview"`.
Microsoft Learn documents `reasoning_effort` as arriving in `2024-12-01-preview`,
and an older API version answers an unknown argument with HTTP 400
("Unrecognized request argument supplied: reasoning_effort"). PR1 therefore makes
the API version configurable and defaults it to a version that accepts
`reasoning_effort`. The exact default is fixed by the first live probe in PR1
(quickstart step P1-2), which sends `reasoning_effort: "none"` to `gpt-6-luna` and
`temperature: 0` to `gpt-4o-mini` and `gpt-5.4-nano` under the candidate version.
The new default is applied to all three deployments, so the probe must pass on
all three before merge.

**Rollout ordering (behaviour-preserving)**: today prod sends `temperature: 0`
to both tiers. Once the code omits temperature when unset, deploying PR1 before
the settings exist would silently move both tiers to the default temperature of 1.
New environment variables are ignored by the currently deployed code. So the
safe order is:

1. **Before merging PR1**, with your approval: set
   `AZURE_OPENAI_JOB_TEMPERATURE=0` and `AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM=0`
   on the Function App. The running code ignores them.
2. Merge PR1. Behaviour is identical to today: same deployments, temperature 0.
3. Run the FR-M03 eval (R3) and record the choice in `eval-models.md` (R2).
4. **With your approval**, switch the settings. For free: set
   `AZURE_OPENAI_JOB_DEPLOYMENT=gpt-6-luna` and
   `AZURE_OPENAI_JOB_REASONING_EFFORT=none`, and delete
   `AZURE_OPENAI_JOB_TEMPERATURE`. Premium changes per R2.

Step 4 is a settings change with no deploy. It is reversible by restoring the old
values. Nothing in this plan changes prod settings or Azure resources without
asking first.

**Alternatives considered**:
- *Default temperature to 0 when unset.* This preserves behaviour without a
  settings step, but a model that rejects temperature would then need a sentinel
  such as `"omit"` to turn it off. It also contradicts the instruction to omit
  unset settings. Rejected.
- *A per-model capability table in code* (for example, "luna rejects
  temperature"). This turns every model swap back into a code change, which
  FR-M04 forbids. Rejected.
- *Move to the Responses API or the `/openai/v1/` endpoint.* This is the
  direction Microsoft recommends. It is a larger change than FR-M04 needs, it
  touches the structured-output call shape, and it is not needed to meet the
  retirement date. Deferred.

---

## R2 — Model selection rule for free and Premium (PR1, FR-M01/M02/M05)

**Inputs**: the measured table in spec.md's Technical Shape. On one posting and a
dealbreaker profile, `gpt-6-luna` at `none` was the only configuration that
treated an unstated arrangement as unverified and kept scores in one verdict
band. It cost about $0.00066 per analysis at about 5.5 s.

**Free tier decision**: `gpt-6-luna` with `reasoning_effort: none`, provided the
FR-M03 eval confirms all of the following on the full corpus:

- SC-008: zero false dealbreakers, and arrangement accuracy of 100% on the six
  existing fixtures.
- SC-002: every true violation is reported. In PR1 this is measured with the
  score-≤20 proxy, because the PR1 prompt still asks for the cap; PR2 removes it.
- SC-004: the same verdict band in at least 90% of pairs over 5 runs.
- SC-009: median cost per analysis at or below `gpt-4o-mini`'s on the same
  corpus, and p95 latency at or below 30 s.

If `none` fails SC-004 or SC-008, the next candidate is `low`, which must still
pass SC-009. If no `gpt-6-luna` setting passes, PR1 merges the configuration
plumbing only, and the switch is escalated to you with the eval report. The
retirement deadline of 2027-04-14 leaves room for that.

**Premium decision (you decided 2026-10-29)**: Premium moves to `gpt-5.4-mini` at
temperature 0, and FR-M05's cost limit is waived for Premium. The eval still
gates it. The table below keeps the other candidates as the fallback.

| Candidate | Status | Cost check, FR-M05 |
|---|---|---|
| `gpt-5.4-nano`, temperature 0 (today) | Retires 2027-09-21 | Baseline, about $0.0016 per analysis |
| `gpt-6-luna` `none` | Same config as free | About $0.00066 |
| `gpt-6-luna` `low` | | About $0.0007 |
| `gpt-6-luna` `medium` | Not yet measured | Must measure |
| **`gpt-5.4-mini`, temperature 0 (chosen, live for Premium since 2026-10-29)** | Retires 2027-09-21. DataZoneStandard, 50K TPM. | About $0.0065 at Data Zone prices ($0.825/$4.95 per 1M), roughly 4× the old Premium cost. FR-M05 is waived for Premium. |

1. `gpt-5.4-mini` is Premium if it passes SC-002, SC-004 and SC-008 on the
   corpus, keeps p95 latency at or below 30 s (SC-009), and is at least as good
   as free on every fit metric (FR-M02). Cost is reported but not gated.
2. If it fails, discard any other candidate that fails SC-002, SC-004 or SC-008,
   or whose median cost is above today's Premium median (FR-M05 still applies
   to the fallback). Of those left, Premium takes the configuration with the
   best fit-quality score
   (R3 metrics, in this order: false dealbreakers, missed dealbreakers, verdict
   stability, then agreement with the labelled verdict range). Ties go to the
   cheaper configuration.
3. FR-M02 is satisfied when Premium's result is at least as good as free's on
   every metric. If the free configuration matches or beats `gpt-5.4-nano`, the
   rule above moves Premium off `gpt-5.4-nano`.

**Capacity for you** (checked read-only on 2026-10-29): the resource has three
GlobalStandard deployments: `gpt-4o-mini` at 20K tokens per minute (TPM),
`gpt-5.4-nano` at 50K TPM, and `gpt-6-luna` at 20K TPM. There is **no
`gpt-5.4-mini` deployment**. The model is available in the resource as GA
version 2026-03-17, as GlobalStandard or DataZoneStandard. Premium needs a new
deployment, which is an Azure change needing your approval. The suggestion is
50K TPM to match today's Premium, subject to quota. It is needed before PR1's
live probe and eval can include it. DataZoneStandard keeps processing inside
the US data zone, which would also answer the data-processing flag below for
Premium; confirm its price before choosing it. A deployment has no fixed
charge. Only tokens are billed.

**Done 2026-10-29, with your approval**: deployment `gpt-5.4-mini` created as
DataZoneStandard at 50K TPM (Data Zone quota 200K; prices $0.825 input and
$4.95 output per 1M, about 10% above global). A probe through the unchanged
production code path (api-version 2024-08-01-preview, temperature 0, strict
JSON schema) returned schema-valid results:

| Posting fixture, dealbreaker "no fully on-site roles" | `gpt-5.4-mini` | `gpt-5.4-nano` |
|---|---|---|
| `unspecified-arrangement` | fit 58, no violation, 2.3 s | fit 78, no violation, 4.4 s |
| `onsite-explicit` | fit 0, violation named, 3.0 s | fit 20, violation named, 3.5 s |

Premium was then switched in production
(`AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM`: `gpt-5.4-nano` → `gpt-5.4-mini`). This is
two postings, not the FR-M03 eval. The PR1 eval still gates it, and if it fails,
Premium goes back to `gpt-5.4-nano` or to R2's fallback, with your approval.

**Data-processing flag**: GlobalStandard deployments may process prompts in any
Azure region. Prompts include the user's résumé text. Confirm the privacy policy
wording covers this before switching. `gpt-4o-mini`'s deployment SKU should be
checked for comparison.

**Output**: `specs/006-profile-match-ux/eval-models.md`, written by PR1. It holds
per-configuration tables from the harness and the chosen settings, and it is
signed off by you before step 4 of R1.

---

## R3 — Evaluation harness extension (PR1, FR-M03)

**Decision**: extend `functions/scripts/evalPostings.ts` instead of writing a new
harness. The existing arrangement checks and the `--tier` flag stay as they are.

**Corpus**:

1. *Short postings*: the six existing `functions/tests/fixtures/postings/*.txt`.
2. *Full-length postings*: derived from the extension's captured pages corpus in
   `extension/tests/fixtures/pages/<slug>/settled.html`. A new extension script,
   `extension/scripts/exportCorpusExtracts.ts`, runs the **shipping**
   `extractPage` over each snapshot in real Chromium. It reuses `runExtractor` and
   `serveFixtures`, the R9 lane from feature 005. It writes the exact wire payload
   the extension would send (`url`, `canonicalUrl`, `title`, `jsonLd`,
   `structuredSources`, `mainText`) to
   `functions/tests/fixtures/postings/full/<slug>.json`.
   - The outputs are committed. They are derived from committed HTML, and
     committing them keeps the functions eval free of Playwright.
   - `thin-posting-control` is exported but tagged `expectNotScorable`. It checks
     that the thin-content guard holds and is never scored for fit.
   - This gives 5 usable full-length postings: Ashby, Greenhouse, Lever, Phenom
     and Workday. The Phenom posting is the one used in the spec's probe.
3. *Fixture profiles*: `functions/tests/fixtures/profiles/*.json`, each shaped
   `{ id, text, dealbreakers, preferences?, confirmedSkills? }`. Four profiles
   cover the spec's cases:
   - a senior backend engineer with "no fully on-site roles";
   - a mid-level frontend engineer with a remote-only preference and a minimum
     salary;
   - a data/ML engineer with an "EU timezones only" location preference;
   - a control profile with no dealbreakers.
   The `preferences` and `confirmedSkills` fields are inert until PR4 and PR5
   extend `profileToPromptText`. Until then, each fixture repeats any preference
   that matters as a dealbreaker line, so PR1 can measure it.
4. *Pair labels*: `functions/tests/fixtures/profiles/pairs.json` maps
   `(postingId, profileId)` to ground truth:
   - `violations`: the dealbreaker or preference strings the posting truly
     violates, given what it states;
   - `unstatedFacts`: facts the posting does not state, for SC-008;
   - optional `verdictRange`: a loose labelled band such as
     `["Stretch", "Worth a shot"]`, used only as a tie-breaker in R2.
   There are 11 postings × 4 profiles = 44 pairs. Pairs that make no sense, such
   as a non-posting, are excluded explicitly.

**Metrics per run, for each tier or configuration**:

| Metric | Measures | Source |
|---|---|---|
| Arrangement accuracy, contradictions, hybrid days | Existing | Unchanged |
| False dealbreakers | SC-008 | A violation reported for a pair whose `violations` is empty or does not include it |
| Missed dealbreakers | SC-002 | A labelled violation not reported |
| Score independence | SC-002 | Share of violating pairs whose verdict band is the same when the profile's dealbreakers and preferences are removed. Active from PR2, because the PR1 prompt still caps. |
| Verdict stability | SC-004 | Share of pairs whose FR-009 band is the same across `--runs=N` (default 5) |
| Evidence verbatim rate | SC-003 | Share of returned quotes that pass validation. Active from PR3. |
| Tokens | SC-009 | Prompt, completion, reasoning and cached tokens, from `completion.usage` |
| Cost per analysis | SC-009, FR-M05 | Tokens × prices from `functions/scripts/modelPrices.json` |
| Latency | SC-009, QG-4 | p50 and p95 per configuration |
| Truncations | Watch | Count of `finish_reason == "length"` |

**Detecting a reported violation**: the harness reads `fit.dealbreakersViolated`
when present, which arrives in PR2. Before that it uses the PR1 proxy of
`score ≤ 20` plus a case-insensitive mention of the dealbreaker in the rationale.
The harness logs which method it used, so PR1 and PR2 numbers are not compared as
if they were alike.

**Cost accounting**: `modelPrices.json` is keyed by deployment and records
input, cached-input, cache-write and output prices per 1M tokens, with the source
and date. Prices are seeded from the spec's table, which used the Azure Retail
Prices API on 2026-10-28. `gpt-6-luna` bills cache writes at $0.125/1M, above its
$0.10 uncached input price, so cached tokens are reported separately and never
assumed to be cheaper. Long-context pricing applies above a threshold the spec
could not confirm. Prompts here are well under 32K tokens, and the report
flags any prompt over 32K.

**Exposing usage from the orchestrator**: `orchestrateJobAnalysis` gains an
optional `observe` callback. It receives
`{ deployment, promptTokens, completionTokens, reasoningTokens, cachedTokens, latencyMs, attempts, finishReason }`
once per call, including the repair retry. The HTTP handlers pass a callback that
logs the counts, which gives prod cost visibility. The wire response does not
change.

**Throughput and tooling**:
- `--runs=N` repeats each pair, for SC-004.
- `--configs=<file>` lists `{label, tier, deployment, temperature?, reasoningEffort?}`
  so several configurations run in one invocation by overriding the environment
  per configuration.
- `--concurrency` defaults to 2, with exponential backoff on 429.
- `--out=<json>` writes the raw results that `eval-models.md` tables are built
  from.

At 20K TPM, one configuration of 44 pairs × 5 runs is about 220 calls and about
45 minutes. Running four configurations takes about 3 hours and costs about $1–3.
The harness stays on-demand and never runs in CI.

**Alternatives considered**: synthetic long postings were rejected because they
are not realistic, which FR-M03 requires. Adding more live captures now was
deferred: the corpus has known gaps (no iCIMS, and SmartRecruiters only as a
stub), and those gaps are stated in `eval-models.md` instead of filled by this
feature.

---

## R4 — Fit schema migration and version skew (PR2, PR3, FR-005/FR-011)

**The constraint**: three kinds of reader see a `Fit`:

- legacy snapshots in `SavedJobs.analysisJson` and in `chrome.storage.session`;
- an **older extension build** that keeps talking to the new backend while a new
  build is in Chrome Web Store review, which can take days;
- the new clients.

The library is shared across surfaces. A snapshot written by a new client is read
back by an old extension through `GET /api/jobs`. So the *stored* shape must be
readable by old clients, not just the *response* shape.

**The hazard**: the shipped `FitScore.tsx` renders `fit.matching` items directly
as React children inside `<li key={item}>{item}</li>`. If items became objects,
an old extension would throw "Objects are not valid as a React child" and the
panel would crash. The web's `AnalysisView.tsx` behaves the same way. Per-request
version negotiation cannot fix this, because a new client can still save a
v2-shaped snapshot that an old client later reads.

**Decision: an additive-only wire and storage shape.**

```text
Fit (stored and on the wire)
  score, rationale, matching[], missing[], desired[], strengths[], weaknesses[]   ← unchanged; labels stay string[]
  dealbreakersViolated?: string[]         ← PR2, additive
  profileFingerprint?: string             ← PR2, additive (64-char hex)
  evidence?: {                            ← PR3, additive
    matching?: EvidenceItem[]             //   { label, postingQuote, profileQuote }
    missing?:  EvidenceItem[]             //   { label, postingQuote, profileQuote: null }
    desired?:  EvidenceItem[]
  }
```

- The **model-facing** structured-output schema is free to use objects. In PR3
  its `matching / missing / desired` become
  `{ label, postingQuote, profileQuote }` arrays. The server then splits them into
  label arrays plus `evidence`. The model schema is internal and never stored.
- Old clients ignore unknown fields. Every new field is optional. The legacy
  `isJobAnalysisPayload` guard and the extension's `isJobAnalysis` guard check
  none of them.
- New clients read every snapshot through `normalizeFit()` in `shared/fitView.ts`
  (R10). A missing `profileFingerprint` means version-unknown, and missing
  `evidence` means no evidence affordance.
- Evidence is joined to its chip by `label`, not by array index, so the join is
  robust to filtering and duplicates.
- Dealbreakers never change `score` (Clarification, 2026-10-28). An old client
  shows no banner, so it would see an unchanged, possibly green score for a
  posting that breaks a dealbreaker. To keep that signal visible on old builds,
  the prompt still asks the model to name each violated dealbreaker in
  `rationale`, which old clients render (R8).

**Alternatives considered**:
- *The spec's suggestion to replace the label arrays with objects and keep the
  guard tolerant of strings.* This is safe for new readers, but it crashes old
  extension builds on any snapshot a new client wrote. Rejected. This is the one
  place the plan departs from Technical Shape, which is non-binding.
- *Index-aligned parallel arrays* such as `matchingEvidence[i]`. These break
  silently if any code filters a list. Rejected.
- *Bumping `SavedJobs.schemaVersion` with a migration.* The rows do not need
  rewriting, because the shape is additive. The existing `schemaVersion: 1` stays.

**Retirement**: there is no planned removal of the label arrays. They are the
canonical labels, and `evidence` is supplementary.

---

## R5 — Profile fingerprint (PR2, FR-002)

**Decision**: fingerprint = lowercase hex SHA-256 of
`normalizeWhitespace(serializedProfile)`, where:

- `serializedProfile` is the output of shared `profileToPromptText`;
- `normalizeWhitespace` is `s.replace(/\s+/g, " ").trim()`, the same
  normalization `pasteIdentity` and `validateEvidence` already use.

The server computes it in three places, all through one function,
`profileFingerprint(serialized)` in `functions/src/services/profileFingerprint.ts`:

1. **`GET /api/profile` and `PUT /api/profile`** compute it from the stored
   profile and return it as `fingerprint`. Nothing is stored for the current
   value, because it is derived on every read. That keeps it correct even if the
   serialization changes (see the note below).
2. **`orchestrateJobAnalysis`** computes it from the profile it actually sends
   to the model and stamps `fit.profileFingerprint`. When `fit` is null, nothing
   is stamped.
3. **Fingerprint history**: `PUT /api/profile` appends the *previous*
   fingerprint to `Profiles.fingerprintHistory`, a JSON array capped at the 20
   most recent, whenever the fingerprint changes. Only R6 uses it.

**Which serialized text?** Starting in PR2, clients send the structured profile
as `profileData`, next to the legacy `profile` string (contract:
[analyze-api.md](./contracts/analyze-api.md)). When `profileData` is present, the
server serializes it with the shared `profileToPromptText` and ignores the
string. This makes SC-006 hold by construction: the server serializes for every
new client. When only `profile` is present, as from an older extension, the
server uses the string as is.

As a result, an old extension's analysis gets a fingerprint for what it actually
sent. After US4 or US5 add preferences or confirmed skills, an old extension
omits them, so its fit is correctly shown as out of date on new surfaces. It
really was scored without those parts of the profile.

**Stability rules**:
- Whitespace-only edits leave the fingerprint unchanged (acceptance scenario
  US1 #6).
- `updatedAt` is not part of the input.
- Sections that are empty serialize to nothing. Adding the Preferences and
  Confirmed skills sections in PR4 and PR5 therefore leaves the fingerprint of
  every profile that has neither unchanged. **Contract test**: the serialization
  of `{text, dealbreakers}` stays byte-identical across PR2 to PR5.
- Dealbreaker order is significant. Reordering is a meaningful edit, because the
  model sees a different prompt.

**How the extension learns the current fingerprint for cached analyses**: the
extension already calls `getProfile()` on every revisit, inside
`needsFitRefresh`, and before every analysis. That response now carries
`fingerprint`. The background:

- writes it to `chrome.storage.session` as `profile:fingerprint`, as
  `{ value: string | null, fetchedAt }`, where `null` means no profile;
- includes it in `JOB_ANALYSIS_RESULT` and `PASTE_ANALYSIS_RESULT` as
  `currentProfileFingerprint`.

The options page writes the same key after a successful save. The panel and the
Saved tab subscribe to `chrome.storage.onChanged`. That is how FR-007 ("after a
profile save, an open panel offers to rescore") reaches a panel in a different
browsing context, with no new network call.

When the fingerprint is unknown because the fetch failed and no session value
exists, surfaces show no freshness marker. That is "can't tell", not "fresh". The
Saved tab refreshes the value once when it opens.

**Alternatives considered**:
- *Hashing on the client.* The spec rules this out ("the client never hashes
  anything"). It would also let the two surfaces drift.
- *Storing the current fingerprint on the Profiles row.* It would go stale if the
  serialization changes. Deriving it on read is cheap. Rejected.
- *The server loading the stored profile itself and ignoring what the client
  sends.* This is tempting, but it changes the "profile couldn't be loaded" edge
  case and the FR-001 per-surface contract. Rejected for this feature.

---

## R6 — Free-rescore metering (PR2, FR-004/FR-004a, Constitution V)

**Counter location**: the existing `Usage` row (PK `sub`, RK `usage-YYYY-MM`)
gains two integer columns:

- `rescoresUsed`: free rescores consumed this month;
- `unavailableRefunds`: see the unavailability rule below.

Being on the same row means the same UTC-month boundary, the same reset with no
reset write, and the same optimistic-concurrency discipline.
`FREE_RESCORES_PER_MONTH = 10` lives next to `MONTHLY_ANALYSES` in
`models/user.ts`. It is the same for both tiers, so FR-026 holds.

**Hazard found**: `checkAndIncrement` and `refundOnSystemFailure` write the row
with `updateEntity({partitionKey, rowKey, count, limit}, "Replace", {etag})`.
`Replace` drops every column it does not name, so the first ordinary analysis
after a rescore would erase `rescoresUsed`. Both functions move to `"Merge"`
with the same ETag. ETag-conditional Merge keeps exactly-one-winner semantics.
**Test-first**: an integration test against Azurite does a rescore, then an
analysis, and asserts that `rescoresUsed` survives.

**Request shape**: both analyze endpoints accept an optional rescore intent.
On `analyze-job` it is `rescore: { priorFingerprint: string | null }`. On
`analyze-document` it is two form fields, `rescore=true` and `priorFingerprint`.
See [analyze-api.md](./contracts/analyze-api.md).

**Eligibility rule**, decided by the server before the model call:

```text
current = fingerprint of the profile being sent (R5)
if no profile is sent, or there is no rescore intent → ordinary analysis
saved = SavedJobs row at sha256(canonicalUrl), if any
        (analyze-job: extract.canonicalUrl; analyze-document: the server-computed doc:<sha256>)
if saved exists and saved.analysis.fit exists:
    prior = saved.analysis.fit.profileFingerprint        ← authoritative; the client claim is ignored
    eligible = (prior is absent) or (prior ≠ current)     ← absent = pre-feature, version-unknown
else:
    prior = request.priorFingerprint
    eligible = prior ≠ null and prior ≠ current and prior ∈ Profiles.fingerprintHistory
```

- An eligible request with `rescoresUsed < 10` is charged as a free rescore, by
  incrementing `rescoresUsed`.
- Every other request, including an ineligible one marked as a rescore, is
  metered exactly as today. The spec says "any other analysis is metered as
  today". The flag never causes a rejection. It only changes which counter is
  charged.
- The response's `usage` echo states which counter was charged
  (`charged: "rescore" | "analysis"`) and adds `rescoresUsed` and
  `rescoresLimit`. Old clients ignore both.

**Why this satisfies "prior fingerprint must differ"**:

- A first-time analysis has no saved row. Its claimed prior would have to be a
  fingerprint the account really had, and not the current one. A random or
  copied hash fails the history check.
- A saved posting already scored against the current profile is ineligible,
  whatever the client claims, because the saved row overrides the claim.
- The residual: a modified client can point `extract.canonicalUrl` at a
  different, stale saved posting and send new text, which gets a free analysis.
  That is bounded by the 10-per-month cap. The cap is the real abuse ceiling, and
  the rules above stop honest clients from spending it on the wrong things.

**Charge timing**: the spec's Technical Shape says metering is "charged only
after a successful analysis". The code does something different, and the
difference matters:

- `checkAndIncrement` charges **before** the model call, failing closed, so N
  parallel requests at the cap produce exactly one winner (SC-002 of 003).
- `refundOnSystemFailure` refunds on a 5xx.

Charging after success would let parallel requests overshoot the cap. Rescore
keeps the existing pattern: charge the selected counter first, then refund that
same counter on failure. The user-visible result is what FR-004a asks for: a
failed rescore costs nothing. As today, a refund is best-effort, and a lost
refund over-counts by one.

**Side fix**: `withUsageMetering` charges before the body is parsed. Today a 400
or 413 response on `analyze-job` is charged and never refunded, because only a
5xx refunds. Eligibility needs the parsed body. So `analyze-job` adopts
`analyze-document`'s order (research R7 of 004): validate, then meter, then call
the model. The charge-before-the-model guarantee stays, and invalid requests stop
costing an analysis. A regression test pins this.

**Unavailability rule (FR-003a)**: a rescore on a posting page that now shows no
posting must consume nothing.
- *Thin content* is detected in the extension before any request, so nothing is
  sent and nothing is charged. This is the common case and has no limit.
- *The model returns `isJobPosting: false`* on a request with rescore intent and
  without `assumeJobPosting`. The server refunds whichever counter it charged.
  To stop this becoming an unbounded free-call path, these refunds are capped by
  `unavailableRefunds < 10` per month. Past the cap, the charge stands. The
  response sets `postingUnavailable: true`, so the client keeps the old score and
  records `unavailableAt` (R7).

**Constitution V — overage and cost note** (copied into plan.md):

| Item | Free quota | Metered rate | Worst case per account per month |
|---|---|---|---|
| Free rescores | 10 per account | Unbilled model call | Free: 10 × about $0.00066 ≈ $0.0066. Premium on `gpt-5.4-mini`: 10 × about $0.006 ≈ $0.06. |
| Refunded "posting unavailable" rescores | 10 per account | Unbilled model call | Same per-call cost again: ≤ $0.0066 free, ≈ $0.06 Premium |
| Combined unbilled ceiling | | | ≤ 20 calls. Free: ≤ $0.013, about 40% above the 50-analysis allowance's ≈ $0.033. Premium: ≤ $0.12 against a $5.00 subscription. |

These calls are not new infrastructure. They draw on the same deployment TPM and
the same $50/month budget alert set up in 003 (T043). The per-account ceiling
makes the total linear in active accounts and capped. No new metered resource is
adopted.

**Alternatives considered**:
- *A separate `Rescores` table.* It would need a second ETag dance across two
  rows and a second reset boundary. Rejected.
- *Trusting the client's `priorFingerprint` alone,* as the spec's sketch did.
  "Absent prior → free" would let any client get 10 free first-time analyses.
  Rejected in favour of the saved-row and history checks.
- *Rejecting ineligible rescore requests with a 4xx.* The client already showed a
  cost line based on its own view, and a rejection would strand the user.
  Metering them as ordinary analyses matches the spec. Rejected.

---

## R7 — "Posting no longer available" and rescore paths per source (PR2, FR-003a)

**Field**: `SavedJobs` gains an optional string column, `unavailableAt`, holding
an ISO timestamp. It is absent or empty when the posting is available. It
appears on `SavedJobPayload` as `unavailableAt?: string | null` and is settable
through `PATCH /api/jobs/{key}` (contract:
[saved-jobs-api.md](./contracts/saved-jobs-api.md)).

- It is cleared, set to `null`, whenever a PATCH or PUT replaces `analysis`. A
  successful rescore means the posting is available again.
- Older clients never send it. The current `isSavedJobPatchBody` already accepts
  and ignores unknown fields, and `patchJob` copies only known fields. An older
  extension's PATCH therefore leaves the flag alone, unless it replaces
  `analysis`, which clears it. That is correct.
- `listJobs` and `getJob` return it, so every surface can show the note.

**Who sets it**: the client, after a rescore attempt that finds no posting. This
matches today's pattern, where clients write the analysis back with
`jobStorage.update()` and the web upsert. The server does not write `SavedJobs`
from inside an analyze call. That would add a hidden side effect to a metered
endpoint.

**Rescore path per source**:

| Source | Where Rescore runs | Library row and web detail action | How "unavailable" is detected |
|---|---|---|---|
| `url` | Extension panel on the posting's page (`analyzeJobPage` with `bypassCache` and rescore intent) | "Open posting to rescore": opens `sourceUrl`; the panel shows the stored result with Rescore | Thin content on extraction (client-side, no request), or `postingUnavailable: true` from the server |
| `document` | Web Upload page: drop the same file. `doc:<sha256 of text>` gives the same `saveKey`, so the existing entry updates in place. | "Upload again to rescore": navigates to Upload with the entry's key, and Upload sends rescore intent | Not applicable. A different file is just a different posting. |
| `paste` | **Extension paste composer**, or the **web Analyze posting screen's Paste text option**. `shared/pasteIdentity.ts` maps the same text to the same `paste:` key on both. | "Paste again to rescore" on both surfaces. On the web it opens `/upload?mode=paste&rescore=<key>`. | Not applicable |

**Web paste screen, added 2026-10-28 at your request (FR-027)**: the web had no
paste screen. It also cannot call `analyze-job`, because that route is
`authLevel: "function"` and the web bundle cannot hold a function key. The
Paste text option therefore goes through `analyze-document`, which already
uses Google sign-in only:

- **Request**: `analyze-document` accepts exactly one of a `file` part or a
  `text` part. Both or neither is `400 INVALID_REQUEST`.
- **Limits**: the same as the extension's paste composer, 300 to 40,000
  characters of raw text. The web checks first and shows the composer's
  messages, so a bad paste sends nothing. The server checks again before
  charging: `400 TEXT_TOO_SHORT` or `413 TEXT_TOO_LONG`, never charged.
- **Identity**: the server keys the posting `paste:<sha256>` with the
  extension's normalization (whitespace collapsed, trimmed).
  `extension/lib/pasteIdentity.ts` moves to `shared/pasteIdentity.ts`, built
  on `globalThis.crypto.subtle`, which Node 20, the service worker and browsers
  all provide. Both sides import it, so a paste on the web and the same paste
  in the extension land on the same saved entry. A shared test vector guards
  this.
- **Model input**: identical to the extension's paste flow. The extract has
  an empty title and `mainText` is the text capped at 40,000.
- **Response and save**: `source: "paste"` with no filename. The saved payload
  uses `source: "paste"` and empty `sourceUrl` and `filename`, which
  `isSavedJobPayload` already accepts from the extension.
- **Rescore**: the web row's "Paste again to rescore" opens
  `/upload?mode=paste&rescore=<key>`. Upload sends rescore intent as it does
  for documents, and charging follows R6 unchanged.
- **Different content on "again"**: when the result's `saveKey` differs from
  the `rescore` key, for a paste or a document, Upload does not PATCH. It
  shows the result as a new analysis with "Save to library" and the spec's
  "didn't match" note. Without this rule, a different file would overwrite
  another posting's analysis.
- **CD window**: if the new web goes live a minute before the functions, a
  paste gets `400` "Missing required file part" and is not charged. That
  matches the existing note for this window.

**Taken-down page in the extension**: `analyzeJobPage` runs its thin-content
check **before** `lookupStored`. Today a taken-down page with a saved analysis
therefore shows a thin-content error instead of the saved score. PR2 reorders
this:

- When extraction is thin and a saved entry exists for the canonical URL, the
  panel shows the stored result with a note.
- A Rescore from that state records `unavailableAt` without sending a request
  (US1 acceptance scenario 4).
- Without a saved entry, the thin-content error stays as it is.

**Removing automatic refreshes**: `needsFitRefresh` re-analyzes automatically in
two cases, which spends allowance silently:

- a pre-breakdown fit;
- a null fit with a profile updated after the analysis.

The spec says re-analysis must never happen silently (FR-003, FR-007, and
Technical Shape's "marks instead"). Both cases become markers through
`fitView.freshness`:

- a pre-breakdown fit is version-unknown, with a "may be out of date" notice;
- a null fit with a profile now present shows the existing "Configure profile"
  call to action, changed to "Score against your profile".

A null-fit rescore is metered as an ordinary analysis, because it is a first
scoring, not a rescore (R6).

---

## R8 — Server-validated dealbreakers and the rubric (PR2, FR-005/FR-008)

**Decision**:

- The model schema's `fit` gains `dealbreakersViolated: string[]`
  (`maxItems: 10`).
- The system prompt adds the FR-008 rubric bands and these instructions:
  - "fit.score measures only how well the posting matches the candidate's
    skills, experience and seniority; do not lower it for dealbreakers";
  - "copy each violated dealbreaker exactly as written in the profile into
    dealbreakersViolated, and also name it in the rationale";
  - "a fact the posting does not state is not a violation; list it as
    `Unverified: …` in weaknesses instead".
- Today's prompt line "cap fit.score at 20 or below" is **removed** in PR2. It is
  the only thing that lowers scores today, and removing the server cap alone
  would leave it in force.
- The server post-processes in a new pure step, `resolveDealbreakers`, which runs
  after `validateEvidence` and `enforceConsistency`. In PR4 it grows into
  `applyPreferences` (R11).
  1. It parses the profile's dealbreaker lines, from `profileData` or with the
     shared inverse `dealbreakerLinesFromPrompt` for the legacy string.
  2. It maps each model entry to a profile line, first by normalized equality,
     then by normalized containment in either direction. A matched entry is
     replaced with the user's exact wording, as FR-005 requires.
  3. An unmatched entry is **kept** with a warning. Dropping it could hide a real
     violation, while a kept paraphrase is still visible to the user in the
     banner. The eval's SC-008 metric catches a model that over-reports.
  4. It never reads or writes `score` (FR-005). A unit test asserts the score
     is identical before and after the step.
- No profile, or a null fit, means no `dealbreakersViolated`.

**Measuring that the score doesn't depend on dealbreakers (SC-002)**: the model
could still drift its score down when it sees a dealbreaker, even when told not
to. The eval scores every violating pair twice, once with the fixture profile
and once with its dealbreakers and preferences removed, and reports the share of
pairs whose verdict band matches. The target is at least 90%. If it is lower,
the fallback is to score fit without dealbreakers in the prompt and judge
violations separately. That costs a second model call, so it is escalated to you
rather than adopted silently.

**Alternatives considered**: having the model return dealbreaker IDs (`D1`, `D2`)
instead of text. That needs ID-numbered serialization, and it changes the prompt
an older extension sends, which has no IDs. Verbatim copy plus validation works
on both formats. Rejected.

**Superseded on 2026-10-29 (T087)**: three eval attempts failed, so the decision
above changed in three steps:

1. The fallback was adopted. The fit call never sees the dealbreakers, and its
   schema has no `dealbreakersViolated`. A second call on the same deployment,
   run in parallel, judges them. A failed judge call reports none, with a
   warning.
2. The judge returns one check per dealbreaker: `number`, `postingSays` (a
   verbatim posting quote, `""` if none), and `verdict` (`violated`,
   `compatible` or `not stated`). Its prompt has reading rules for arrangement,
   salary and location dealbreakers. The list comes after the posting. The
   server (`violatedLines`) reports a line only for a `violated` check whose
   quote is a substring of the posting, and maps it by number to the user's
   exact line. That makes `resolveDealbreakers`' paraphrase matching
   unnecessary, so it was removed. Numbering is server-side only, so the
   older-extension objection above does not apply.
3. SC-002's independence is now gated on the fit call getting identical input
   with and without dealbreakers (`fitCallMessages`). SC-004 counts runs that
   agree with their pair's most common verdict. See spec.md Clarifications.

---

## R9 — Evidence quotes (PR3, FR-011/FR-012)

**Decision**: generalize `validateEvidence` into a quote validator with two
haystacks:

- the **posting haystack**, which is today's: JSON-LD, structured sources, title
  and `mainText`;
- the **profile haystack**: the serialized profile sent to the model.

Both are whitespace-normalized. Each `postingQuote` and `profileQuote` that is
not a substring of its haystack is set to `null` with one warning per drop, and
the item is kept. Quotes are capped at 200 characters on the server after
validation. Strict mode does not reliably enforce `maxLength`, so the cap does
not depend on it.

**Cost and latency risk**: evidence adds up to 30 items × 1–2 quotes of output.
At an estimated 300–600 more output tokens and $0.50/1M, that is about +$0.0002
per analysis, roughly +30%, and about +2–4 s. Three consequences:

- **Cost is a feature cost, not an FR-M05 limit** (decided 2026-10-28). FR-M05
  binds the PR1 model switch only. PR3 measures the evidence cost on the eval
  before merging, reports it per tier in dollars and percent against PR2, and
  you approve it in the PR. At the full monthly allowance, the estimate is
  about +$0.0075 to +$0.015 per free account and +$0.41 to +$0.81 per Premium
  account on `gpt-5.4-mini`, whose output costs $4.50 per million tokens.
- **QG-4 regression gate**: a p95 regression of 20% or more must be rejected or
  carry a documented exception. PR3 is the PR most likely to hit this. A 20%
  regression on about 5.5 s is only about 1.1 s. The mitigation, in order:
  1. instruct the model to quote the shortest supporting span, and cap item
     counts, with `matching` and `missing` at 8;
  2. measure;
  3. if the regression is still 20% or more, record a QG-4 exception for your
     approval in the PR, because the absolute p95 stays far below 30 s.
- `max_completion_tokens` stays 3000 unless the eval shows truncations, which
  the harness counts.

---

## R10 — Shared fit view logic (PR2 onward, FR-009/FR-023)

**Decision**: add `shared/fitView.ts`, framework-free and pure, imported by
`extension/` and `web/` in the same way `shared/types/job.ts` is today. Its
exports:

- `normalizeFit(fit)`: returns `NormalizedFit` (see
  [data-model.md](./data-model.md)). It accepts legacy fits with missing fields,
  and string arrays only.
- `verdictFor(fit)`: one of the five verdicts, or `"unrated"` when
  `profileFingerprint` is absent.
- `scoreTone(fit)`: replaces `scoreStyle` in `FitScore.tsx`. `Tone` is one of
  `strong | ok | stretch | long-shot | dealbreaker | unrated`. Colours map from
  tone in each surface's Tailwind classes. The mapping is shared, the classes are
  not.
- `freshness(fit, currentFingerprint)`: one of `current | out-of-date |
  version-unknown | profile-deleted | unknown`.
- `verdictLabel(verdict)` and `ariaFitLabel(fit)`: the latter returns text such
  as "Strong match, fit 86 out of 100" (US2 #3).
- `evidenceFor(fit, list, label)`.
- `sortByFit`, `filterByVerdict` and `mergeRequirementRows`: the US6 helpers,
  added in PR6.

Contract tests in each client import the same fixture table from
`shared/fitView.fixtures.ts`. Each client's test suite runs it against the shared
module. That is FR-023's guard against the surfaces drifting apart.

**Coverage**: `shared/` has no test runner of its own. The tests live in
`extension/tests/unit/fitView.test.ts`, and the web runs the same fixture table,
so both coverage reports include the module. That meets QG-2's "changed module"
requirement.

---

## R11 — Structured preferences (PR4, FR-015/FR-016)

**Storage**: `Profiles.preferences` is a JSON-encoded optional object holding
`arrangements`, `maxOfficeDays`, `minSalary {amount, currency, period}`,
`seniority {min, max}`, `locations: string[]` and `needsSponsorship`.
`Profiles.schemaVersion` goes to 2. A version-1 row reads as having no
preferences.

**Checks**: `applyPreferences(payload, preferences)` is a pure function. It
covers arrangement, office days, salary and seniority only.

| Preference | Violation only when | Unverified note when |
|---|---|---|
| Arrangements | `payload.arrangement ∉ allowed` **and** `arrangementConfidence ≠ "none"` | arrangement is `unspecified` |
| Maximum office days | `arrangement` is `hybrid` with `daysInOffice` stated and above the maximum, or `onsite` with `arrangementConfidence ≠ "none"`, which counts as 5 days. An on-site posting already reported by the Arrangements check is not reported twice. | `arrangement` is `hybrid` with no `daysInOffice` |
| Minimum salary | The posting's `salary.max` (or `min` if there is no max) is below the minimum, with the **same currency and period** | there is no salary, or the currency or period differs |
| Seniority range | `payload.seniority` is outside `[min, max]` on the enum's order | seniority is `unspecified` |
| Locations | Never checked in code. It goes to the model through `profileToPromptText`, and the model's `dealbreakersViolated` entry is kept as-is (Clarification 2). | |
| Visa sponsorship | Never checked in code, for the same reason as Locations: postings state sponsorship only in prose. The banner shows the profile line as the model copies it, "Work authorization: needs visa sponsorship", the same pattern as "Office days: at most 2 per week". | |

The seniority enum mixes the individual-contributor and management tracks
(`staff`, `principal`, `manager`, `director`). The range check uses the enum's
declared order. The editor offers a min/max select from that order and lists the
management levels last. This is a simple rule. If it turns out to be wrong,
correcting it is a product question, not a schema change.

A violation adds the preference's label in the user's terms, for example
"Arrangement: remote only". Unverified notes are prepended to `weaknesses`, which
has a cap of 5, so model weaknesses are trimmed to fit.

**Request**: `profileData.preferences` carries them. An older extension cannot
send them, so its analyses are not preference-checked and show as out of date
(R5).

---

## R12 — Résumé import discards the file (PR4, FR-014)

**Confirmed from the code**: 004's path holds the upload only in memory.

- `analyze-document/index.ts` reads `file.arrayBuffer()` into a `Buffer`, and
  `extractDocument(bytes)` returns `{text, type}`.
- `documentExtraction.ts` imports only `unpdf` and `mammoth`. It has no storage,
  blob or table client.
- The handler persists nothing. A saved posting stores only the analysis, through
  a separate `PUT /api/jobs`.
- No log line includes the document text.

**Decision**: `POST /api/profile/import` (multipart, one `file` part) does the
following:

- it is wrapped in `withRateLimit("analyze")`, then `withAuth`;
- it calls `extractDocument` and returns `{ text, charCount }`;
- it makes no model call, does not meter, and writes nothing;
- it reuses 004's rejection codes and messages, so a document with no text gets
  the same `FILE_NO_TEXT` copy (US4 #2).

The text is returned whole, even above 20,000 characters. The editor shows it
with the existing over-limit message, so the user can trim it before saving
(FR-014: "nothing is saved until the user saves").

**Test-first guard**: a unit test spies on the table client factory and asserts
that the import handler never calls `ensureTable`. Another test asserts that no
`context.log` or `context.warn` argument contains the extracted text.

**Extension client gap**: the extension's `apiFetch` only sends JSON bodies,
because it calls `JSON.stringify(init.body)`. It gains a `rawBody` option that
mirrors the web's `apiFetch`, for the multipart import.

---

## Summary of unknowns, all resolved

| Unknown | Resolved in |
|---|---|
| How to omit temperature without changing prod behaviour | R1, through settings-before-code ordering |
| API version for `reasoning_effort` | R1, made configurable and verified by the PR1 live probe |
| Premium model | R2: `gpt-5.4-mini`, your decision on 2026-10-29 with FR-M05 waived for Premium, gated on quality by the eval |
| Corpus and metrics for FR-M03 | R3 |
| Fit schema compatibility with old extension builds | R4, with additive-only stored shape |
| Where the fingerprint is computed and how the extension learns it | R5 |
| Rescore counter, anti-abuse rule and cost note | R6 |
| Unavailable field and per-source rescore path | R7, with the web paste gap flagged |
| Dealbreaker wording, and keeping the score independent of dealbreakers | R8 |
| Evidence cost and latency | R9, measured in PR3 and possibly needing a QG-4 exception |
| Shared logic location and coverage | R10 |
| Preference semantics | R11 |
| Résumé file retention | R12, confirmed nothing is retained |
