# Quickstart: Validating Resilient Extraction

**Feature**: `005-resilient-extraction` | **Plan**: [plan.md](./plan.md)

How to run the measurement tooling and verify each success criterion. The corpus
tooling is already built and runnable **today**, before any implementation — that
is how the baseline was established.

## Prerequisites

```bash
cd extension
npm install          # Playwright is already a devDependency
npx playwright install chromium
```

No Azure credentials needed for anything on this page: extraction is measured
client-side, ahead of the model call.

## 1. Re-measure the baseline (works today)

```bash
cd extension
npx tsx scripts/baselineReport.ts
```

Prints the table in `tests/fixtures/pages/README.md` from committed fixtures. No
network. Expected as of 2026-07-25:

```
Corpus: 6 fixtures
  slowest time-to-text .......... 3440ms
  slowest time-to-settle ........ 4883ms   <- the readiness budget floor
  body-fallback container ....... 3/6
  has JSON-LD or microdata ...... 5/6
  predicate passed before text .. 3/6   <- returns with thin/empty text today
  posting-shaped state blobs .... phenom-intuit: window.wa (372B)
```

Those five numbers are the feature's scoreboard. `body-fallback 3/6 → ≤1/6` is
SC-002; `predicate before text 3/6 → 0/6` is SC-003.

## 2. Re-capture from live boards

```bash
npx tsx scripts/captureCorpus.ts                # all fixtures
npx tsx scripts/captureCorpus.ts --only=phenom  # one
npx tsx scripts/captureCorpus.ts --headed       # watch it
```

Resolves a live posting from each board's listing page rather than using
hard-coded posting URLs, and rejects stub postings below 1,500 chars by trying
the next link (`thin-posting-control` opts out with `minTextChars: 0`).

Re-capture **replaces** fixtures with whatever is posted today, and timings move
with network conditions. Phenom's time-to-text was stable across 5 runs
(3408–3600 ms); treat single-run numbers from other fixtures as indicative. Do
not re-capture casually mid-feature — it moves the baseline you are measuring
against.

## 3. Per-story validation

### Story 1 — readiness (SC-001, SC-003)

The captured snapshots **cannot** test this: a saved DOM is ready by
construction. Use the synthetic hydration fixtures (`tests/e2e/hydration/`,
built in Phase 1 of the plan), which serve an empty shell and inject posting text
after a configurable delay:

| Fixture | Delay | Expected |
|---|---|---|
| `fast` | 200 ms | Fast path; returns in ≈150 ms after text stabilizes |
| `phenom-like` | 3500 ms | Full posting returned; ≤ 6 s budget; not the 300-char prefix |
| `never` | — | Thin-content error at budget with the "still loading" copy |
| `jsonld-early` | JSON-LD at 0 ms, text at 1500 ms | **Must not** return at 0 ms with empty `mainText` — this is the 3/6 flaw |

`jsonld-early` is the one that fails against a naive implementation. Write it first.

### Story 2 — containers and structured sources (SC-002)

Run the extractor in real Chromium against `settled.html` fixtures — **not
jsdom**, which lacks `innerText` and would exercise a different code path
(research R9).

Assertions:
- `lever-palantir` selected text does not contain `"Cookie Policy"`.
- `workday-nvidia` selected text does not contain `"Skip to main content"`.
- `greenhouse-discord` and `phenom-intuit` keep their current selections (FR-013).
- `thin-posting-control` still errors thin-content (SC-003a).

**Backend, before touching the prompt** — write this failing first:

```bash
cd functions && npm test -- jobExtractionOrchestrator
```

An extract whose arrangement evidence appears **only** in `structuredSources`
must survive `validateEvidence` with arrangement and confidence intact. Without
the haystack change it fails, and that failure is the whole point — see
[contracts/extraction-payload.md](./contracts/extraction-payload.md) §2.2.

### Story 3 — paste (SC-007)

```bash
cd extension && npm test -- pasteIdentity
```

- Same text with differing incidental whitespace → same `paste:<sha256>`.
- Below 300 chars / above 40,000 → rejected before any request is sent.
- A saved paste posting round-trips with `source: "paste"` and empty
  `sourceUrl`/`filename`.

Header-button and composer behavior (`npm test -- JobPanel TabBar`), which the
persistent-entry-point choice makes load-bearing — a failure-state-only
affordance would not have owed any of it:

- The header row still exposes exactly **two** tabs. The paste button is a
  sibling of `role="tablist"`, not a child, so `getAllByRole("tab")` returns 2
  and the button is found via `getByRole("button", { name: /paste/i })`
  (FR-017a). This is the assertion that catches the tempting shortcut of
  dropping the button inside the existing tablist div.
- The button exposes `aria-pressed` reflecting composer state, and Escape and
  the close control both return to the previously selected tab (FR-017b).
- Closing and reopening preserves the draft; so does switching to "Saved" and
  back while closed (FR-017c).
- A navigation or tab-switch broadcast does **not** close the composer and does
  **not** clear the draft (FR-017d). The existing reset-to-idle logic in
  `JobPanel.tsx` fires on those events and must be scoped to the page view only.
- The existing `TabBar.test.tsx` still passes after the row/tablist split.

### Story 4 — page scoping and learned hosts (SC-008, SC-008a/b, SC-009)

```bash
cd extension && npm test -- selectorPath learnedSelectors
```

Pure-logic tests (jsdom is fine here): machine-generated classes rejected
(`css-1x2y3z`, `jsx-123`), LRU eviction at 200, retirement at 3 misses,
`recordMiss` NOT firing per readiness attempt, and `put()` NOT called by the act
of scoping — only by accepting the reuse offer (FR-026b).

Three behaviors need a real browser (Playwright), because each has a failure mode
that unit tests cannot see:

- **Cache bypass (SC-008a)** — analyze a page normally, save it, then scope a
  different region on the same URL. The scoped result must come back, not the
  stored one. Without `bypassCache` this silently returns the old analysis and
  the correction looks like a no-op. **Write this one first**; it is the trap.
- **Full selection text (SC-008b)** — select a posting body longer than the
  context-menu payload's truncation limit and confirm the analyzed text matches
  the live `window.getSelection()`, not the truncated copy.
- **Unavailability (FR-036a)** — on a page the extension cannot read, both
  scoping affordances are disabled with a reason and point at paste.

The criterion that actually matters is cross-posting generalization (SC-008), and
it needs two postings from one board:

```bash
npx tsx scripts/captureCorpus.ts --only=lever   # resolves up to 4 candidates
```

Learn a region on posting A — via the picker in one run, via a selection in
another, since FR-023c requires both to produce an equivalent selector — then
verify posting B on the same host extracts from the equivalent region with no
user action.

## 4. Full gates before merge

```bash
cd extension && npm run lint && npm test && npm run compile
cd ../functions && npm run lint && npm test
```

Then the E2E suite (needs a built extension against a live backend):

```bash
cd extension && npm run build:e2e && E2E=1 npm run test:e2e
```

**Reading QG-2 (≥80% coverage) for this feature**: meaningful extractor
assertions move into Playwright, which vitest's coverage reporter does not count.
The percentage may fall where real verification improved. Judge the change on the
Playwright suite, not the number alone — see plan.md's Constitution Check.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `captureCorpus` reports "no posting link matching …" | The board is empty or changed its URL shape; update `postingHref` in `scripts/captureCorpus.ts`. |
| A fixture's text drops to ~400 chars | Likely a stub posting; the capture retries up to 4 candidates, but a wholly stub board (Visa) yields nothing better. |
| `baselineReport` throws "No corpus" | Fixtures not captured yet — run `captureCorpus.ts`. |
| Extraction tests pass in vitest but fail in Chromium | Expected: jsdom has no `innerText` (research R9). Chromium is the source of truth. |
