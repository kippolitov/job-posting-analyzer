# Phase 1 Data Model: Resilient Page Extraction

**Feature**: `005-resilient-extraction` | **Date**: 2026-07-25 | **Plan**: [plan.md](./plan.md)

Four entities change or appear. Nothing requires a storage migration: the one
persisted addition reuses a discriminator 004 already made optional-on-read.

---

## §1. `PageExtractPayload` — structured sources (spec FR-010, FR-011, FR-014)

`shared/types/job.ts`. Additive; `jsonLd` is deliberately left populated.

```ts
export type StructuredSourceKind = "json-ld" | "microdata";

export interface StructuredSource {
  kind: StructuredSourceKind;
  /** Pruned posting-shaped subtree. */
  data: Record<string, unknown>;
}

export interface PageExtractPayload {
  url: string;
  canonicalUrl: string;
  title: string;
  jsonLd: Record<string, unknown>[];   // UNCHANGED — see compatibility note
  structuredSources: StructuredSource[]; // NEW
  mainText: string;
  extractedAt: string;
  provenance: ExtractionProvenance;      // NEW — §2
}
```

**Cap**: `JSON.stringify(structuredSources).length ≤ 20_000`, enforced in the
page before transmission. Sources are added in descending confidence order
(`json-ld`, then `microdata`) and dropped whole once the cap would be exceeded —
never truncated mid-object, which would produce unparseable data.

**Compatibility**: `isAnalyzeJobRequest` validates only `url`, `mainText`,
`title`, and `jsonLd`, so the field is safe in both directions — an older
extension keeps working against a newer backend, and a newer extension against an
older backend loses the new signal without erroring. `jsonLd` must therefore keep
carrying JSON-LD as it does today; `structuredSources` is additive, not a
replacement.

**`kind` is not decorative.** The backend prompt states relative trust per kind
(spec FR-016), preserving today's rule that body text wins when it contradicts
structured data.

### The evidence haystack (spec FR-015) — the feature's most dangerous line

`functions/src/services/jobExtractionOrchestrator.ts` currently validates
arrangement evidence against:

```
normalizeWhitespace(`${JSON.stringify(req.extract.jsonLd)} ${title} ${mainText}`)
```

It **must** become:

```
normalizeWhitespace(
  `${JSON.stringify(req.extract.jsonLd)} ` +
  `${JSON.stringify(req.extract.structuredSources ?? [])} ` +
  `${title} ${mainText}`
)
```

Without this, a model that quotes newly-available microdata fails the substring
check and its arrangement is silently downgraded to `unspecified` with
`confidence: "none"` — so Story 2 would *reduce* confidence on precisely the
pages it improves. The `?? []` is required: older extensions omit the field.

---

## §2. `ExtractionProvenance` — how a result was obtained (spec FR-007, FR-035)

Client-side only. Never persisted, never sent to the model as content; carried on
the extract for diagnosis, the panel's "learned" badge (spec FR-032), and the
eval harness.

```ts
export type ExtractionStrategy =
  | "learned-selector"   // user-taught region for this host, applied automatically
  | "picked"             // one-off region the user just picked with the overlay
  | "selection"          // one-off region the user just highlighted on the page
  | "semantic"           // main / [role=main] / article won the scoring
  | "scored"             // density scorer picked a non-semantic container
  | "google-overlay"     // the SERP dialog branch
  | "body"               // last-resort full-body fallback
  | "paste";             // user-supplied text, no page involved
```

`"picked"` and `"selection"` are the *act* of scoping; `"learned-selector"` is the
stored consequence being replayed on a later visit. Keeping them distinct is what
lets the eval harness tell "the user just corrected this" from "the correction is
still working."

```ts

export interface ExtractionProvenance {
  strategy: ExtractionStrategy;
  /** Readiness attempts made before returning. */
  attempts: number;
  /** ms from injection to return. */
  elapsedMs: number;
  /** True when the readiness budget expired without stable usable text. */
  budgetExpired: boolean;
  /** A learned selector existed for this host but matched nothing / too little. */
  learnedSelectorMissed: boolean;
}
```

`budgetExpired` is what lets the thin-content error distinguish "the page was
still loading" from "this page has no content" (spec FR-005) — today those are
the same message on very different situations.

### Scoped analyses are page analyses

A `"picked"` or `"selection"` result keeps the page's **canonical URL** as its
identity. It is not a new kind of posting — it is this page's analysis, scoped
better, and it supersedes whatever automatic extraction stored. Two consequences
follow, and both are easy to get wrong:

- The analysis MUST run with `bypassCache` (spec FR-026a). `jobFlow.ts` consults
  the saved library and session cache by canonical URL *before* analyzing; a
  scoped region resolves to the same URL, so without the bypass the user's
  correction returns the previous, wrong analysis and appears to have done
  nothing.
- After analyzing, the existing replace-the-snapshot path applies unchanged: a
  saved posting keeps its status and notes while its analysis is refreshed.

Paste is the opposite case — a `paste:<hash>` identity that never collides with
any URL. That difference is the whole reason paste sits behind its own button and
scoping does not.

---

## §3. `LearnedHostSelector` — picker learning (spec FR-028, FR-029, FR-030)

`chrome.storage.local`, one key per host. Local only: spec FR-033 requires these
never leave the browser, which `storage.sync` would make arguable (research R8).

```ts
/** Storage key: `learned:${host}` — e.g. "learned:jobs.intuit.com". */
export interface LearnedHostSelector {
  host: string;
  selector: string;
  learnedAt: string;      // ISO
  lastUsedAt: string;     // ISO — drives LRU eviction
  /** Consecutive failures to match or to yield MIN_TEXT_CHARS. */
  consecutiveMisses: number;
}
```

**Rules**

| Rule | Value | Source |
|---|---|---|
| Max hosts | 200, LRU by `lastUsedAt` | FR-030 |
| Retire after | 3 consecutive misses | FR-029, research R8 |
| Reset misses | On any successful use | FR-029 |
| On miss | Fall through to automatic extraction **silently** | FR-029 |
| Clearing | Per-host and clear-all, from options | FR-031 |

A miss is not an error. It sets `learnedSelectorMissed` in provenance,
increments the counter, and the automatic ladder proceeds — the user sees a
normal result (spec SC-009).

---

## §4. `PostingSource` — paste (spec FR-020, FR-021)

Extends 004's discriminator in `functions/src/models/user.ts`:

```ts
export type PostingSource = "url" | "document" | "paste";   // "paste" is new
```

Identity mirrors the existing document scheme exactly:

| Source | `canonicalUrl` | `sourceUrl` | `filename` |
|---|---|---|---|
| `url` | the canonicalized http(s) URL | the page URL | `""` |
| `document` | `doc:<sha256 hex>` | `""` allowed | required, non-empty |
| `paste` | `paste:<sha256 hex>` | `""` | `""` |

**Hash input**: the pasted text after whitespace normalization (collapse runs to
a single space, trim). Normalizing before hashing is what makes spec FR-021's
"the same text pasted twice resolves consistently" survive incidental
copy-paste whitespace differences.

**Validation**: `isSavedJobPutBody` gains a `source === "paste"` branch requiring
`PASTE_CANONICAL_URL_RE = /^paste:[0-9a-f]{64}$/`, with `sourceUrl` and
`filename` both empty — structurally identical to the existing `"document"`
branch at `user.ts:234`.

**No migration.** `SavedJobEntity.source` is already optional-on-read with a
`"url"` default (004), so existing rows are unaffected and no backfill runs.

**Metering and caps are untouched** (spec FR-022): a paste analysis goes through
the same `/api/analyze-job` path and the same allowance and library caps. Nothing
in the metering service is aware of `source`, and nothing here changes that.

---

## Entity relationships

```text
Toolbar click
   └─> extractPage (in page, serialized)
         ├─ readiness loop ──────────────> ExtractionProvenance §2
         ├─ LearnedHostSelector §3 ──────> (storage.local, tried first)
         ├─ structured harvest ──────────> StructuredSource[] §1
         └─ container scoring ───────────> mainText
               └─> PageExtractPayload §1 ──> POST /api/analyze-job
                                               └─ evidence haystack §1 ⚠
Paste panel
   └─> pasteIdentity ──> paste:<sha256> §4 ──> same POST, same metering
```

## What deliberately does not change

- **`MAIN_TEXT_CAP` (40,000)** and **`MIN_TEXT_CHARS` (300)** keep their values.
  Better container selection should *reduce* pressure on the cap, not need more.
- **The analysis schema, fit scoring, metering, and tier behavior.** Spec
  Out of Scope.
- **`jsonLd` on the wire.** Removing it would break older extensions for no gain.
- **`SavedJobs` table schema.** Only a new permitted value of an existing field.
