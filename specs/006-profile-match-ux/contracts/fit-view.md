# Contract: `shared/fitView.ts` — the single source of fit display logic

**Requirements**: FR-009, FR-010, FR-023, FR-025, FR-021, FR-022 | **Research**: R10

This module is framework-free and pure, with no DOM, `chrome.*` or `fetch`. Both
`extension/` and `web/` import it. Tailwind classes stay in each client. This
module returns semantic tones only.

## Exports

| Export | PR | Signature | Behaviour |
|---|---|---|---|
| `normalizeFit` | 2 | `(fit: Fit \| null \| undefined) => NormalizedFit \| null` | Fills absent arrays with `[]`, `dealbreakersViolated` with `[]` and `evidence` with `{}`. Keeps `profileFingerprint` as `undefined` when absent. Never throws on legacy input. |
| `verdictFor` | 2 | `(fit: NormalizedFit) => Verdict` | Mapping in [data-model.md §2](../data-model.md). `unrated` when there is no fingerprint. |
| `verdictLabel` | 2 | `(v: Verdict) => string` | The exact user-facing copy from the spec's vocabulary table |
| `scoreTone` | 2 | `(fit: NormalizedFit) => Verdict` | The same value as the verdict. Clients map it to colour and icon (FR-010: text label always shown, icon where space allows). |
| `ariaFitLabel` | 2 | `(fit) => string` | `"Strong match, fit 86 out of 100"`, or `"Unrated, fit 72 out of 100"` |
| `freshness` | 2 | `(fit, current: string \| null \| undefined) => Freshness` | Mapping in data-model.md §2. `undefined` means unknown. |
| `rescoreAction` | 2 | `(job: {source, sourceUrl, unavailableAt?}, freshness) => RescoreAction` | Returns one of `none`, `rescore-here`, `open-posting`, `upload-again` or `paste-again`, plus copy. Covers research R7's table. |
| `rescoreCostLine` | 2 | `(usage: {rescoresUsed, rescoresLimit, count, limit}) => string` | Returns "Free — 7 of 10 free rescores left this month", "Uses 1 analysis", or the exhausted state |
| `previewMissing` | 2 | `(fit, n = 3) => string[]` | FR-025's default view |
| `evidenceFor` | 3 | `(fit, list, label) => EvidenceItem \| null` | Joins evidence to a chip by label |
| `sortByFit` | 6 | `(jobs, dir) => jobs` | Unscored jobs last. Out-of-date and unrated fits still sort by number. |
| `filterByVerdict` | 6 | `(jobs, verdicts) => jobs` | `unrated` is never matched by a verdict filter (US2 #4) |
| `mergeRequirementRows` | 6 | `(jobs) => RequirementRow[]` | Keys rows by normalized label (case-folded, whitespace-collapsed). Each cell is `matched`, `missing`, `nice-to-have` or `not-asked`. |

## Shared fixture table

`shared/fitView.fixtures.ts` exports `[input, expected]` cases. They cover every
verdict boundary (39/40, 64/65, 84/85), dealbreaker overriding 95, legacy
string-only fits, missing fingerprints, and every freshness row.

Both `extension/tests/unit/fitView.test.ts` and `web/tests/unit/fitView.test.ts`
iterate the same table. A divergence in either client's build fails that
client's CI. This is the FR-023 guard.

## Replacements

- `extension/components/JobPanel/FitScore.tsx`: `scoreStyle(score)` with its
  hard-coded 70/20 thresholds is deleted. `SavedJobRow.tsx` imports the shared
  tone instead.
- `web/src/lib/libraryQuery.ts`: the fit sort and filter delegate to
  `sortByFit` and `filterByVerdict` in PR6. PR2 adds the "current profile only"
  filter, which uses `freshness`.
