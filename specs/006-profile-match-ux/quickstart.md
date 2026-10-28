# Quickstart: Validating 006 per PR

**Plan**: [plan.md](./plan.md) | Shapes live in [data-model.md](./data-model.md)
and [contracts/](./contracts/). This guide covers only how to prove each PR works.

## Prerequisites (every PR)

```bash
cd functions && npm ci && npm run azurite &        # local Table Storage
cd functions && npm run build && npm start          # func host on :7071, local.settings.json → Azurite
cd extension && npm ci && npm run build             # load extension/.output/chrome-mv3 unpacked
cd web && npm ci && npm run dev                     # http://localhost:5173
```

- `functions/local.settings.json` needs a real `AZURE_OPENAI_API_KEY` only for
  live-model steps, which are marked **(live)**. Everything else runs against
  recorded fixtures.
- Prod is never touched by this guide. Steps marked **(prod, ask first)** are
  listed for completeness and need your approval at the time.

**Gate for every PR**:

```bash
cd functions && npm run lint && npm test && npm run test:integration && npm run coverage
cd extension && npm run lint && npm test && npm run coverage
cd web && npm run lint && npm test && npm run coverage
```

- Coverage must be at least 80% on changed modules (QG-2).
- New tests are committed red before the implementation commit (Principle II).
  `git log --oneline` on the PR shows a `test:` commit ahead of each `feat:`
  commit.

**Compatibility smoke for every PR**: run the **currently published** extension
build against the PR's backend. You can check out the last release tag's
`extension/` and build it. Analyze one posting, open the Saved tab and open the
options page. Nothing may throw. Then open the web library and posting detail
for the same saved posting.

---

## PR1 — Scoring-model switch (FR-M01–M05)

| # | Step | Expected |
|---|---|---|
| P1-1 | Unit: `resolveModelConfig` table (contract [model-config.md](./contracts/model-config.md)) | Unset settings are omitted. Premium falls back to free settings. Invalid values throw. |
| P1-2 **(live)** | Probe each deployment under the chosen API version: `gpt-4o-mini` with temperature 0, `gpt-5.4-nano` with temperature 0, `gpt-6-luna` with `reasoning_effort: none` | All three return schema-valid JSON. Record the API version in `eval-models.md`. |
| P1-3 | `cd extension && npx tsx scripts/exportCorpusExtracts.ts` | 6 files in `functions/tests/fixtures/postings/full/`, with `thin-posting-control` tagged `expectNotScorable` |
| P1-4 **(live)** | `npm run eval:postings -- --configs=scripts/evalConfigs.json --runs=5 --out=…` | The report covers each configuration (contract [eval-harness.md](./contracts/eval-harness.md)), with about 45 minutes per configuration at 20K TPM |
| P1-5 | Fill `eval-models.md` and apply the decision rule (research R2) | The chosen free and Premium settings pass SC-002, SC-004, SC-008 and SC-009, and FR-M05 cost holds |
| P1-6 | Regression: the existing six-posting arrangement eval on the chosen free config | 100% arrangement accuracy and 0 contradictions (SC-008) |
| P1-7 **(prod, ask first)** | Before merge, set `AZURE_OPENAI_JOB_TEMPERATURE=0` and `…_PREMIUM=0` | Inert on the running code |
| P1-8 **(prod, ask first)** | After merge and sign-off, switch the settings (research R1 step 4) | The next analyses log `model.usage` with `deployment: gpt-6-luna`. An extension analysis still renders. |

## PR2 — US1 + US2: freshness, dealbreakers, rubric, verdict

| # | Scenario | Expected |
|---|---|---|
| P2-1 | Analyze a posting, then save the profile with an extra sentence. Revisit the posting in the panel, the Saved row, the web library and the web detail. | Every surface shows "scored against an older profile" with the source-correct action (research R7) |
| P2-2 | Save the profile with only whitespace changes | No surface marks anything out of date (US1 #6). `GET /api/profile` returns the same `fingerprint`. |
| P2-3 | Click Rescore in the panel | The cost line reads "Free — N of 10…" before running. Afterwards the score, verdict and saved entry update, and `Usage.rescoresUsed` goes up by one. |
| P2-4 | Rescore the same posting again without a profile change | The cost line reads "Uses 1 analysis". The server charges `count` (`usage.charged: "analysis"`). |
| P2-5 | Send `rescore: {priorFingerprint: <random hex>}` with curl for an unsaved posting | Charged as `analysis`, because the history check fails (research R6) |
| P2-6 | Profile with "no fully on-site roles", on an on-site posting **(live)** | Banner reads "Violates your dealbreaker: no fully on-site roles". The score is in the same verdict band as when the dealbreaker is removed from the profile. Verdict is Dealbreaker. |
| P2-7 | Same profile, on a posting with no stated arrangement **(live)** | No banner. Weaknesses contain an "Unverified: …" note. |
| P2-8 | Saved posting whose page now returns a stub, served by the e2e localhost server with thin content: open it and click Rescore | The stored score stays with "Posting no longer available — score can't be updated". `unavailableAt` is set. `Usage` is unchanged. |
| P2-9 | Saved entries from before this feature | They show their number with "Unrated — rescore for a verdict" and a "may be out of date" notice. The verdict filter excludes them. |
| P2-10 | Screen reader (VoiceOver) on the score | Announces "Strong match, fit 86 out of 100" |
| P2-11 | Free rescores used up and the analysis allowance used up: click Rescore | The existing `UsageExhausted` state, not a silent failure |
| P2-12 | Library sorted by fit with "current profile only" | Out-of-date rows are marked and filtered |
| P2-13 | `curl` a 400 body to analyze-job | `Usage.count` is unchanged (contract analyze-api §4) |
| P2-14 | Saved-job round-trip: rescore, then an ordinary analysis | `rescoresUsed` survives the Merge write (research R6 hazard test) |

## PR3 — US3: evidence

| # | Scenario | Expected |
|---|---|---|
| P3-1 | Expand a matching chip by keyboard (Tab, then Enter) and by pointer | Shows a verbatim posting quote and a verbatim profile quote. The panel's default height does not change (FR-013). |
| P3-2 | Recorded fixture with a fabricated quote | The quote is dropped, the item stays, and one warning is logged |
| P3-3 | Pre-006 saved posting | Chips render as before, with no affordance and no console error |
| P3-4 **(live)** | Eval with evidence | SC-003 at least 95% verbatim. Report the cost and p95 delta against PR2. A p95 rise of 20% or more needs a QG-4 exception (research R9). |

## PR4 — US4: profile setup

| # | Scenario | Expected |
|---|---|---|
| P4-1 | Import `functions/tests/fixtures/documents/valid.pdf` in the options page and on the web Profile page | The text fills the editor and nothing is saved until Save. No `Usage` change, and no table write during import. |
| P4-2 | Import `image-only.pdf` | The same "No text could be extracted…" message as job uploads |
| P4-3 | Set "remote only", then analyze an on-site posting with explicit evidence | Dealbreaker banner naming "Arrangement: remote only". The score is unchanged by the violation. |
| P4-4 | Minimum salary 120000 USD/year against a posting in EUR | No violation. Unverified note. |
| P4-5 **(live)** | Location "EU timezones only" against a "US residents only" posting | Banner names the location preference, and the score is unchanged |
| P4-6 | Save preferences on the web, then save text from an **old** extension build | Preferences survive (merge PUT) |
| P4-7 | First-time user with a résumé file, timed from opening the editor | First fit score in under 2 minutes (SC-005) |

## PR5 — US5: "I have this"

| # | Scenario | Expected |
|---|---|---|
| P5-1 | Click "I have this" on "Missing: Terraform" | The profile lists Terraform under confirmed skills. The score is marked out of date. "Rescore this posting" is offered with its cost, and nothing runs automatically. |
| P5-2 | Click Rescore | Terraform moves to matching. That is 2 clicks total (SC-007). |
| P5-3 | Confirm "terraform" again | No duplicate |
| P5-4 | Offline, then click "I have this" | The chip is unchanged, the existing save-error message shows, and no rescore is offered |
| P5-5 | Near the 20,000-character cap | Adding is refused with the over-limit message |

## PR6 — US6: triage and compare

| # | Scenario | Expected |
|---|---|---|
| P6-1 | Saved tab, "Fit (highest)" | Sorted by score, unscored last, out-of-date marked |
| P6-2 | Verdict filter "Strong match" | Unrated fits are excluded |
| P6-3 | Compare 3 postings sharing "Kubernetes" and "kubernetes " | One row with cells in both columns |
| P6-4 | Compare at 375 px width | The table scrolls inside its container, and the page does not scroll horizontally |

## Performance (QG-4, every PR)

```bash
cd functions && npm run test:integration -- perf.test.ts   # p95 ≤ 30 s; reject a ≥ 20% regression vs main
```

PR1 also reports live p95 from the eval, which is the SC-009 evidence.
