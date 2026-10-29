# Full-length postings (FR-M03 eval corpus)

Each `<slug>.json` is the exact analyze-job `extract` the extension would send
for one captured job page: `{ url, canonicalUrl, title, jsonLd,
structuredSources, mainText, extractedAt }`.

- **Derived, not hand-edited.** The files are produced from
  `extension/tests/fixtures/pages/<slug>/settled.html` by running the shipping
  `extractPage` in real Chromium:
  `cd extension && npx tsx scripts/exportCorpusExtracts.ts`. `url` is the page's
  live URL and `extractedAt` its capture time, so a re-run is byte-identical.
- **Regenerate only when** the pages corpus or `extension/lib/pageExtractor.ts`
  changes, and commit the result with that change.
- **`thin-posting-control` is never scored for fit.** It is tagged
  `expectNotScorable: true` and exists to check that the thin-content guard
  holds. `profiles/pairs.json` excludes it.

Used by `npm run eval:postings -- --configs=…` (see
`specs/006-profile-match-ux/contracts/eval-harness.md`).
