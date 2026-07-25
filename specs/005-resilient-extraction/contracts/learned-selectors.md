# Contract: Learned Selectors (`chrome.storage.local`)

**Feature**: `005-resilient-extraction` | **Consumers**: `extension/` only

A purely local contract — nothing here crosses a network boundary (spec FR-033).
Documented as a contract because three modules read and write it: the picker,
the extraction path, and the options page.

## Storage shape

One key per host, so a single host's learning can be read, written, or cleared
without loading the whole store.

```
key:   `learned:${host}`          // host only — never the full URL
value: LearnedHostSelector        // specs/005-resilient-extraction/data-model.md §3
```

```ts
interface LearnedHostSelector {
  host: string;               // "jobs.intuit.com"
  selector: string;           // "main .job-description"
  learnedAt: string;          // ISO
  lastUsedAt: string;         // ISO — LRU key
  consecutiveMisses: number;  // 0..3
}
```

Host is stored bare (no scheme, no port, no path) so one learning covers every
posting on the board — which is the entire point of the feature (spec FR-028).

## Operations

| Operation | Behavior |
|---|---|
| `get(host)` | Returns the record or `null`. MUST NOT throw when storage is unavailable — return `null` and let automatic extraction proceed. |
| `put(host, selector)` | Upserts; resets `consecutiveMisses` to 0; sets both timestamps. Triggers eviction. |
| `touch(host)` | On successful use: updates `lastUsedAt`, resets `consecutiveMisses` to 0. |
| `recordMiss(host)` | Increments `consecutiveMisses`; deletes the record when it reaches **3**. |
| `clear(host)` | Removes one host (spec FR-031). |
| `clearAll()` | Removes every `learned:*` key (spec FR-031). |
| `list()` | For the options page; sorted by `lastUsedAt` descending. |

### Eviction

Cap **200** hosts. On `put` exceeding the cap, delete the least-recently-*used*
record — `lastUsedAt`, not `learnedAt`, so a host learned long ago but used
weekly outlives one learned yesterday and never revisited.

## Read path ordering (spec FR-028, FR-029)

Inside `extractPage`, before the automatic ladder:

1. Look up `learned:${location.host}`.
2. If found, `document.querySelector(selector)`.
3. If it matches **and** yields ≥ `MIN_TEXT_CHARS` (300):
   → use it, `strategy: "learned-selector"`, and `touch(host)`.
4. Otherwise → `recordMiss(host)`, set `provenance.learnedSelectorMissed = true`,
   and **fall through silently** to the automatic ladder. No error, no banner.

Step 4 is what makes spec SC-009 true: a site redesign degrades to today's
behavior rather than to a broken state the user must diagnose.

### Interaction with readiness

The learned lookup runs **inside** the readiness loop, not before it. A selector
that matches nothing at t=0 on a hydrating SPA is not a miss — it is a page that
has not rendered yet. `recordMiss` fires **only once**, when the readiness budget
expires or the page settles without the selector yielding usable text. Calling it
per attempt would retire every learned selector on a slow SPA within two page
loads, which is precisely the class of site the picker exists to serve.

## Storage-unavailable behavior

Every operation degrades to a no-op returning `null`/`void`. Learned selectors
are an optimization; extraction MUST work with the store entirely unreadable.

## Privacy

- Values never leave the browser. No sync, no backend, no telemetry (spec FR-033).
- Only host and selector are stored — never page content, never the full URL.
- `clearAll()` from the options page removes everything this feature persists.
