# Contract: Extraction Payload and Backend Consumption

**Feature**: `005-resilient-extraction` | **Consumers**: `extension/` producer, `functions/analyze-job` consumer

Amends the `POST /api/analyze-job` request contract from
`specs/001-job-posting-analyzer/contracts/analyze-job.md`. The response contract
is unchanged.

## 1. Request delta

```jsonc
{
  "extract": {
    "url": "https://jobs.intuit.com/job/…",
    "canonicalUrl": "https://jobs.intuit.com/job/…",
    "title": "Staff Software Engineer at Intuit",
    "jsonLd": [ { "@type": "JobPosting", … } ],      // UNCHANGED, still populated
    "structuredSources": [                            // NEW, optional
      { "kind": "json-ld",   "data": { "@type": "JobPosting", … } },
      { "kind": "microdata", "data": { "title": "Sr. Manager", … } }
    ],
    "mainText": "…",
    "extractedAt": "2026-07-25T05:10:28.239Z"
  },
  "profile": "…",
  "assumeJobPosting": false
}
```

`provenance` is **client-side only** and is NOT transmitted — it carries no
analysis value and would only widen the request.

### Field rules

| Field | Rule |
|---|---|
| `structuredSources` | Optional. Absent from older extensions; the backend MUST treat absence as `[]`. |
| `structuredSources[].kind` | `"json-ld"` \| `"microdata"`. Unknown kinds MUST be tolerated (ignored for trust ordering, still included in the evidence haystack). |
| `structuredSources[].data` | Pruned posting-shaped object. |
| Total size | `JSON.stringify(structuredSources).length ≤ 20000`, enforced client-side. Sources dropped whole, never truncated. |
| `jsonLd` | Unchanged and still populated. Removing it breaks older backends. |

### Compatibility matrix

| Extension | Backend | Result |
|---|---|---|
| old | old | today's behavior |
| old | new | works; `structuredSources` absent → treated as `[]` |
| new | old | works; extra field ignored by `isAnalyzeJobRequest` |
| new | new | full behavior |

`isAnalyzeJobRequest` validates only `url`, `mainText`, `title`, `jsonLd` — it
MUST NOT be tightened to require `structuredSources`, or new-extension/old-backend
and old-extension/new-backend both break.

## 2. Backend consumption

### 2.1 Prompt (spec FR-016)

`buildUserMessage` appends harvested sources after the existing JSON-LD block,
labelled by kind. `buildSystemPrompt` gains one trust-ordering rule, preserving
today's body-wins behavior:

> JSON-LD and microdata JobPosting values are trusted ground truth for title,
> company, location, and salary unless the body text contradicts them; when the
> body contradicts structured data, follow the body. Where JSON-LD and microdata
> disagree with each other, prefer JSON-LD.

### 2.2 Evidence validation — REQUIRED, not optional

`validateEvidence` builds a substring haystack and downgrades any arrangement
whose `arrangementEvidence` is not found in it. The haystack MUST include
`structuredSources`:

```ts
const haystack = normalizeWhitespace(
  `${JSON.stringify(req.extract.jsonLd)} ` +
  `${JSON.stringify(req.extract.structuredSources ?? [])} ` +
  `${req.extract.title} ${req.extract.mainText}`
);
```

**Failure mode if omitted**: the model quotes evidence from microdata that is now
in its prompt but not in the haystack; the check fails; `arrangement` is forced
to `"unspecified"`, `arrangementConfidence` to `"none"`, `arrangementEvidence` to
`null`, and `daysInOffice`/`daysRemote` to `null`. Story 2 would therefore make
arrangement detection **worse** on the pages it was built to improve, silently,
with only a `warn()` line as evidence.

**Required test** (write it failing first): an extract whose arrangement evidence
appears **only** in `structuredSources` — not in `jsonLd`, `title`, or `mainText` —
must survive `validateEvidence` with its arrangement and confidence intact.

## 3. Error contract delta

One new distinction inside the existing `thin-content` code — no new error code,
so no client-side vocabulary change (`JobErrorCode` is unchanged).

| Condition | `message` | `action` |
|---|---|---|
| Budget expired, text never became usable | "The page was still loading when we tried to read it." | "Wait for the page to finish loading, then re-analyze." |
| Page settled with no usable content | "Not enough page content to analyze." | "Open the full job posting page, then re-analyze." (unchanged) |

Both remain `retryable: true`.

## 4. Non-goals

- No change to the response schema, `JOB_ANALYSIS_SCHEMA`, or fit scoring.
- No new endpoint. Paste reuses `POST /api/analyze-job` unchanged — the paste
  discriminator matters only at *save* time (`PUT /api/jobs/:id`), per
  [data-model.md §4](../data-model.md).
- No transmission of learned selectors, host names, or picked regions (spec FR-033).
