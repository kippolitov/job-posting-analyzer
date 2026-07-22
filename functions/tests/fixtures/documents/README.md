# Document-upload fixtures (analyze-document, contracts/analyze-document.md)

Real files driven through the true extraction path (constitution II — no hollow
mocks), used by `tests/unit/documentExtraction.test.ts` and
`tests/integration/analyze-document.metering.test.ts`.

| File | Purpose | How it was built |
|------|---------|-------------------|
| `valid.docx` | Real extractable text | `pandoc job-posting.md -o valid.docx` |
| `valid.pdf` | Real extractable text | Hand-built single-page PDF (correct xref table) with a `Tj` text-showing content stream |
| `image-only.pdf` | No extractable text | Same PDF structure as `valid.pdf` but with an empty content stream (`q ... Q`, no `Tj`) — simulates a scanned/image-only page |
| `encrypted.pdf` | Password-protected | Hand-implemented PDF standard security handler (RC4-40, `/V 1 /R 2`, Algorithms 3.1–3.4) with a non-empty user password, so `pdf.js`'s default empty-password attempt fails and raises `PasswordException` |
| `encrypted.docx` | Password-protected | Real Office-encrypted `.docx` files are OLE2/CFB containers, not ZIP/OOXML — this fixture is just the 8-byte OLE2 magic header (`D0 CF 11 E0 A1 B1 1A E1`) plus padding, the same signal real encrypted Office files carry and the standard way to detect them before attempting a ZIP parse |
| `oversized.pdf` | > 10 MB boundary | `valid.pdf` padded with spaces past 10 MB — rejected by the size check before any parsing, so content validity past the header doesn't matter |
| `mislabeled.pdf` | Wrong magic bytes | Plain text saved with a `.pdf` extension |
| `large-valid.pdf` | Extraction-latency benchmark (QG-4) | Same technique as `valid.pdf`, scaled to ~9.2 MB of real repeated sentence text (just under the 10 MB cap) — used to assert extraction itself stays sub-second at the size boundary, distinct from `oversized.pdf` which is padding-only and never reaches extraction |

All fixtures are verified against the real `mammoth`/`unpdf` libraries (see git
history / PR description for the generation script) — `encrypted.pdf` genuinely
throws `PasswordException`, `image-only.pdf` genuinely extracts empty text, etc.
