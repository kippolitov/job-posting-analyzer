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
| P1-2 **(live)** | Probe each deployment under the chosen API version: `gpt-4o-mini` with temperature 0, `gpt-5.4-nano` with temperature 0, `gpt-5.4-mini` with temperature 0 (after its deployment is approved and created), `gpt-6-luna` with `reasoning_effort: none` | All four return schema-valid JSON. Record the API version in `eval-models.md`. |
| P1-3 | `cd extension && npx tsx scripts/exportCorpusExtracts.ts` | 6 files in `functions/tests/fixtures/postings/full/`, with `thin-posting-control` tagged `expectNotScorable` |
| P1-4 **(live)** | `npm run eval:postings -- --configs=scripts/evalConfigs.json --runs=5 --out=…` | The report covers each configuration (contract [eval-harness.md](./contracts/eval-harness.md)), with about 45 minutes per configuration at 20K TPM |
| P1-5 | Fill `eval-models.md` and apply the decision rule (research R2) | Free passes SC-002, SC-004, SC-008 and SC-009, and FR-M05 cost holds for free. Premium `gpt-5.4-mini` passes SC-002, SC-004, SC-008, SC-009 latency and FR-M02. Its cost is reported, with FR-M05 waived for Premium. |
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
| P2-15 | Web Analyze posting, Paste text: paste 200 characters, then a full posting | 200 characters shows the extension's "Paste more of the posting…" message with no request. The full posting analyzes, and Save to library creates a `paste:` entry. |
| P2-16 | Paste the same posting in the extension's paste composer | It resolves to the entry the web saved, with no duplicate in the library |
| P2-17 | Web library, a stale paste row: click "Paste again to rescore" and paste the same text | The page opens in paste mode with the cost line. The existing entry is updated in place. |
| P2-18 | "Upload again to rescore" with a different file | The saved posting is unchanged. The result offers "Save to library" with the "didn't match" note. |
| P2-19 | Extension account bar | A labelled "Web app" button. Hovering shows "Opens in a new tab. You'll be asked to sign in with Google." VoiceOver announces the same description. |

## PR3 — US3: evidence

| # | Scenario | Expected |
|---|---|---|
| P3-1 | Expand a matching chip by keyboard (Tab, then Enter) and by pointer | Shows a verbatim posting quote and a verbatim profile quote. The panel's default height does not change (FR-013). |
| P3-2 | Recorded fixture with a fabricated quote | The quote is dropped, the item stays, and one warning is logged |
| P3-3 | Pre-006 saved posting | Chips render as before, with no affordance and no console error |
| P3-4 **(live)** | Eval with evidence | SC-003 at least 95% verbatim. Report the cost and p95 delta against PR2. The cost increase needs your approval as a feature cost, since FR-M05 covers only PR1. A p95 rise of 20% or more needs a QG-4 exception (research R9). |

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
| P4-8 | At most 2 office days, on a hybrid posting stating 3 days, then on one stating none | First: banner "Office days: at most 2 per week", score unchanged. Second: an "Unverified: office days not stated" note. |
| P4-9 **(live)** | "I need visa sponsorship", on a posting that says it can't sponsor | Banner "Work authorization: needs visa sponsorship", score unchanged |
| P4-10 | Open the web Profile page | Headed sections for résumé, dealbreakers and preferences |

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
| P6-3 | Select 3 postings sharing "Kubernetes" and "kubernetes ", then click Compare in the Library | A dialog opens with one row for that requirement and cells in both columns |
| P6-4 | Compare at 375 px width | The dialog fills the screen. The table scrolls inside its container, and the page does not scroll horizontally. |
| P6-5 | Press Escape in the Compare dialog | The dialog closes, focus is on Compare, and the selection is kept |
| P6-6 | Visit `/compare` | Redirects to the Library. The nav has no Compare entry. |
| P6-7 | Library with postings saved today, yesterday and last month, sorted by date | Headings "Today", "Yesterday" and the dated one. Each entry shows fit and verdict, salary or "Salary not stated", arrangement, location, seniority, status and source. |
| P6-8 | Sort the Library by fit | One ranked list without date headings, with each entry's save date |

## Performance (QG-4, every PR)

```bash
cd functions && npm run test:integration -- perf.test.ts   # p95 ≤ 30 s; reject a ≥ 20% regression vs main
```

PR1 also reports live p95 from the eval, which is the SC-009 evidence.
