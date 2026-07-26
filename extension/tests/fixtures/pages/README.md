# Extraction fixture corpus

Measurement baseline for `specs/005-resilient-extraction/`. Distinct from
`functions/tests/fixtures/postings/`, which measures *model* accuracy on text
already extracted. This corpus measures whether extraction gets the text at all.

```bash
cd extension
npx tsx scripts/captureCorpus.ts          # (re)capture every fixture from live boards
npx tsx scripts/captureCorpus.ts --only=phenom
npx tsx scripts/baselineReport.ts         # print the table below from what's captured
```

Per fixture: `served.html` (raw origin response, no JS), `settled.html` (DOM once
text stopped changing), `meta.json` (timings, full poll trace, baseline probe).
`manifest.json` indexes them.

## Baseline — current extractor, captured 2026-07-25

| fixture | platform | predicate@ | text@ | settled@ | text | jsonLd | strategy |
|---|---|---|---|---|---|---|---|
| ashby-linear | Ashby | 10ms | 369ms | 1005ms | 4249 | 1 | body |
| greenhouse-discord | Greenhouse | 116ms | 116ms | 973ms | 10960 | 0 | semantic |
| lever-palantir | Lever | 33ms | 33ms | 983ms | 4867 | 1 | body |
| phenom-intuit | Phenom People | 3314ms | 3440ms | 4883ms | 11970 | 1 | semantic |
| thin-posting-control | SmartRecruiters | 327ms | 327ms | 1063ms | 414 | 0 | semantic |
| workday-nvidia | Workday | 8ms | 736ms | 1589ms | 4369 | 1 | body |

- `predicate@` — when the **current** extractor's test (`jsonLd.length > 0 || text >= 300`) first passed.
- `text@` — when body text alone first cleared 300 chars.
- `settled@` — when text length then held steady for 600ms.

Aggregates: body-fallback container **3/6**; has JSON-LD or microdata **5/6**;
predicate passed before text existed **3/6**; posting-shaped state blobs found
**none** (see finding 3).

## What the measurement changed

**1. The readiness predicate is wrong, not merely absent.** On Ashby (10ms vs
369ms), Workday (8ms vs 736ms), and Phenom (3314ms vs 3440ms) the current
predicate passes *before* body text exists, because JSON-LD alone satisfies it.
A retry loop built on this predicate returns immediately with an empty
`mainText` — no better than today, and it fails silently rather than erroring.
Readiness must key on body text.

**2. Returning the instant text clears 300 chars is too eager.** On Phenom the
text crosses 300 at 3440ms but is still growing until ~4280ms, reaching 11,970.
Returning at first crossing captures a fraction of the posting. Readiness needs
a short stability window, not a threshold crossing — which costs every fast page
that window.

**3. State-blob harvesting is not supported by this corpus.** Scanning every
global and inline script for posting-shaped payloads found nothing usable on any
fixture. Greenhouse — the one fixture with *no* JSON-LD, where a blob would
matter most — exposes `window.__remixContext` (19,958 B), but it is Remix router
state and verifiably does not contain the posting body. `__NEXT_DATA__`,
`__NUXT_DATA__`, `__INITIAL_STATE__`, and Phenom's `window.phApp.ddo` were absent
everywhere. The only hit was `window.wa` on Phenom at 372 B — an analytics
object, matched incidentally.

This is evidence of absence *by this heuristic*, not proof: a blob whose keys
avoid `JobPosting` / `jobDescription` / `jobTitle` would not be detected, and a
framework that deletes its bootstrap payload after hydration would be missed.
But the premise that blob harvesting is the highest-leverage coverage move does
not survive contact with these six pages.

**4. Container blindness is the broader real problem.** 3 of 6 fall through to
`document.body`. On Lever the selected text opens with the cookie-consent banner
("Cookie Policy🍪DenyAccept…"), on Workday with "Skip to main content… page is
loaded". This degrades silently — the analysis still runs, on diluted input.

**5. `thin-posting-control` is a true negative.** A Visa "Sr. Manager" stub:
414 chars in `main`, 2,061 in the entire document, stable to 15 s. No extraction
strategy can rescue it, and any change that appears to is fabricating content.
The correct outcome is the thin-content error.

## Known gaps

- **iCIMS** is unrepresented — the `careers-<company>.icims.com/jobs/search`
  pattern 404s on every company tried.
- **SmartRecruiters** is represented only by a stub posting. Every posting on
  the Visa board (3 sampled) is a stub; four other boards exposed no posting
  links matching the expected URL shape.
- **Readiness (Story 1) cannot be regression-tested from these snapshots.** A
  saved DOM is ready by construction. Story 1 needs a synthetic
  delayed-hydration fixture; the numbers here are what set its budget.
- Fixtures are captured from **live** boards, so re-running replaces postings
  that have since expired and the timings move with network conditions. Phenom's
  time-to-text was stable across 5 runs (3408–3600 ms); treat single-run numbers
  from other fixtures as indicative.

## Rescore — current extractor against the frozen snapshots above (`npm run corpus:rescore`, 2026-07-26)

`corpus:rescore` (T008a) replays the **current** `extractPage` over the same
`settled.html` snapshots the baseline table above was captured from — it is
the only one of the two scoreboards that can observe a change to
`pageExtractor.ts`. `corpus:baseline`'s numbers are frozen at capture time and
never move; do not expect them to.

| fixture | text (baseline) | text (now) | strategy (baseline) | strategy (now) |
|---|---|---|---|---|
| ashby-linear | 4249 | 4249 | body | scored |
| greenhouse-discord | 10960 | 10960 | semantic | semantic |
| lever-palantir | 4867 | 4648 | body | scored |
| phenom-intuit | 11970 | 11970 | semantic | semantic |
| thin-posting-control | 414 | 414 | semantic | semantic |
| workday-nvidia | 4369 | 4125 | body | scored |

- **Body-fallback container: 3/6 → 0/6** (SC-002's ≤1/6 target). Every fixture
  that fell through to `document.body` now resolves via the FR-012 scorer
  (`strategy: "scored"`) instead.
- **Selected text shrank on 2/6** (lever-palantir −219 chars, workday-nvidia
  −244 chars) — both shrink only by the cookie-consent banner and the
  skip-link/footer chrome the scorer's noise penalty was built to exclude, not
  by losing posting content. No fixture shrank below what SC-002 treats as a
  regression.
- **greenhouse-discord and phenom-intuit are byte-for-byte unchanged**
  (FR-013's regression pair, research R3) — the two fixtures the semantic path
  already handled correctly are untouched by the scorer.
- **"predicate passed before text" has no post-change counterpart.** That
  baseline metric is derived from capture-time page timings
  (`timeToTextMs > timeToReadyMs`), not from extractor behavior — see T028. No
  code change in this feature can move it; re-running `corpus:baseline` and
  expecting a different number is a category error.
- Re-capturing the corpus (`captureCorpus.ts`) invalidates **both** columns —
  the baseline is a snapshot of what live boards served on 2026-07-25, and the
  rescore is measured against those exact bytes.
