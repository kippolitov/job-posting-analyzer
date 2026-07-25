# Phase 0 Research: Resilient Page Extraction

**Feature**: `005-resilient-extraction` | **Date**: 2026-07-25 | **Spec**: [spec.md](./spec.md)

Unusually for a Phase 0, most of this is settled by measurement rather than
reading: the corpus at `extension/tests/fixtures/pages/` was captured before
planning, and its baseline (`README.md` there) overturned three assumptions in
the spec's first draft. Decisions below cite it as **[corpus]**.

---

## R1. Readiness budget and stability window

**Decision**: Hard budget **6000 ms**; stability window **400 ms**; fast-path
window **150 ms** when the document is already complete and unmutated.

**Rationale** [corpus]: the slowest fixture (`phenom-intuit`) settles at 4883 ms,
with time-to-text stable across five runs at 3408–3600 ms. 6000 ms clears the
observed worst case with ~1.1 s of headroom for slower networks. The spec's
implied ~3 s would have missed the very page that motivated the feature.

Stability, not threshold-crossing, is the return condition (spec FR-002): Phenom's
text crosses 300 chars at ~3440 ms but grows until ~4280 ms, ending at ~11,900.
Returning at first crossing yields ~3% of the posting.

The 400 ms window is charged to every page, including the five that settle in
973–1589 ms today. The fast path bounds that: when `document.readyState ===
"complete"`, text is already above the minimum, and the MutationObserver has seen
nothing for 150 ms, return immediately. A genuinely static page therefore costs
+150 ms, not +400 ms.

**Alternatives rejected**:
- *Fixed 3 s budget* — fails `phenom-intuit`, which is the point of the feature.
- *Wait for `load`* — Phenom fires `load` long before `main` hydrates; it is not
  correlated with posting availability on any SPA fixture.
- *Poll-only, no MutationObserver* — spec FR-004; polling alone either wastes
  the budget on settled pages or samples too coarsely to detect the quiet period.

**Open for validation during implementation**: whether 400 ms is enough quiet on
a slow connection where chunks arrive >400 ms apart. Mitigation: the budget, not
the window, is the safety net — a premature return still yields ≥300 chars, and
the window only needs to exceed inter-chunk latency, not total load time.

---

## R2. Making the injected extractor asynchronous

**Decision**: `extractPage` returns a `Promise<RawPageExtract>`;
`chrome.scripting.executeScript` resolves it before delivering `injection.result`.

**Rationale**: MV3's `executeScript` awaits a promise returned by `func` and
delivers the settled value in `InjectionResult.result`. No API change at the call
site in [`jobFlow.ts:231`](../../extension/services/jobFlow.ts#L231) beyond the
existing `await`.

The serialization constraint is unchanged and remains the dominant design
pressure: `func` is stringified and injected, so the function must stay
self-contained — no imports, no module-scope references. Every constant it uses
is duplicated inline today for exactly this reason, and R3's scorer inherits the
restriction.

**Alternatives rejected**:
- *Repeated `executeScript` calls from the background, one per attempt* — each
  injection is a fresh isolated world, so a MutationObserver cannot survive
  between attempts; it degrades to blind polling and multiplies IPC.
- *Switching to `executeScript({ files })`* — would allow real imports and drop
  the duplication, but changes the WXT build (a new content-script entrypoint)
  and the grant model. Deferred; not required by any requirement here.

---

## R3. Container scoring heuristic

**Decision**: A hand-rolled Readability-style scorer, inline in `extractPage`.
Score = `textLength × (1 − linkDensity) × penalty`, where `linkDensity` is
anchor-text length over total text length and `penalty` discounts elements whose
`class`/`id` matches a negative pattern (`nav|menu|footer|cookie|consent|banner|
sidebar|related|similar|promo|skip`). Candidates are elements with ≥200 chars of
text. **The semantic container is scored as a candidate, not preferred a
priori**, and the highest scorer wins.

**Rationale** [corpus]: this is the feature's highest-value automatic change —
3 of 6 fixtures fall through to `document.body` today, and the resulting text
opens with a cookie banner (Lever) or "Skip to main content" (Workday). Both are
exactly what a link-density-and-negative-class penalty targets.

Scoring the semantic container as a candidate rather than short-circuiting on it
is what satisfies spec FR-012's "or yields a container that scores worse". It
does risk FR-013 (no regression where semantic already works) — `greenhouse-discord`
and `phenom-intuit` must keep their current selections. That pair is the
regression test.

No dependency (spec FR-038): Mozilla's Readability cannot be imported into a
serialized function anyway (R2), so the choice is hand-rolled or restructure the
injection. Hand-rolled wins on scope.

**Alternatives rejected**:
- *`@mozilla/readability`* — blocked by R2's serialization constraint before its
  ~30 KB bundle cost is even considered.
- *Prefer semantic, score only as fallback* — leaves Lever/Ashby/Workday on the
  body path in cases where a semantic container exists but is a poor choice, and
  measurably does not fix the cookie-banner case.

---

## R4. State-blob harvesting — the evidence gate

**Decision**: **Do not build it.** Spec FR-009 is evidence-gated and the evidence
does not exist.

**Rationale** [corpus]: a scan of every window global and inline script for
posting-shaped payloads (`extension/scripts/corpusProbe.ts`) found **nothing
usable on any of the six fixtures**. `__NEXT_DATA__`, `__NUXT_DATA__`,
`__INITIAL_STATE__`, and Phenom's `window.phApp.ddo` were absent everywhere. The
one hit, `window.wa` on Phenom, is 372 bytes of analytics matched incidentally.

The decisive case is Greenhouse: it is the only fixture with **no JSON-LD**, so a
blob would matter most there. It exposes `window.__remixContext` at 19,958 bytes —
verified to be Remix router state that does not contain the posting body.

This retires the first draft's claim that blob harvesting is "the highest-leverage
'any site' move". The effort moves to R3.

**Honest limit**: this is absence under one heuristic, not proof. A blob keyed
outside `JobPosting|jobDescription|jobTitle|job_description`, or deleted after
hydration, would be missed. The gate stays open: if any future fixture's body is
recoverable *only* from a blob, FR-009 reactivates with that fixture as its test.

**Alternatives rejected**:
- *Build it anyway for the named frameworks* — untestable against this corpus;
  ships speculative parsing with no fixture that fails without it.

---

## R5. Structured sources on the wire, and the evidence tripwire

**Decision**: `PageExtractPayload` gains `structuredSources: { kind, data }[]`
with `kind ∈ {"json-ld", "microdata"}`, capped at 20,000 characters total after
pruning. `jsonLd` stays populated exactly as today.
**`validateEvidence`'s haystack must include `structuredSources`.**

**Rationale**: keeping `jsonLd` unchanged preserves bidirectional compatibility —
`isAnalyzeJobRequest` validates only `url`/`mainText`/`title`/`jsonLd`, so an old
extension works against a new backend and vice versa, losing only the new signal.

The tripwire is the single most likely silent regression in the feature.
[`validateEvidence`](../../functions/src/services/jobExtractionOrchestrator.ts#L153)
downgrades any arrangement whose evidence quote is not a substring of
`jsonLd + title + mainText`. Adding `structuredSources` to the prompt without
adding them to that haystack would make Story 2 **reduce** arrangement confidence
on precisely the pages it improves — the model quotes newly-available microdata,
the check fails, and the arrangement silently becomes `unspecified`. Spec FR-015
exists for this; it needs a test that fails before the haystack change.

**Cap rationale**: only 1 fixture carries microdata and it is small, but the cap
is a boundary condition, not a corpus-driven number — an unpruned payload is a
memory and token risk regardless of what this corpus happens to contain.

---

## R6. Paste identity

**Decision**: Extend 004's discriminator — `PostingSource` becomes
`"url" | "document" | "paste"`, with canonical URL `paste:<sha256 hex>` over the
normalized pasted text, mirroring the existing `doc:<sha256 hex>`.

**Rationale**: 004 already solved "an analysis with no URL" in
[`user.ts:128`](../../functions/src/models/user.ts#L128), including the validation
split in `isSavedJobPutBody` where `source === "document"` requires
`DOC_CANONICAL_URL_RE` and permits an empty `sourceUrl`. Paste is the same shape;
a parallel identity scheme would duplicate that logic and the migration story.

Content-derived hashing gives spec FR-021's "repeat pastes resolve consistently"
for free, via the same dedupe path saved postings already use.

**Alternatives rejected**:
- *Synthetic `https://paste.local/<id>` URLs* — passes `isHttpUrl` and would
  silently pollute URL-sourced postings.
- *Random UUID identity* — breaks FR-021; the same text pasted twice would create
  two library entries.

---

## R7. Selector generation for the picker

**Decision**: Build a short structural path from the picked element upward,
stopping at the first stable anchor. Prefer `#id`, then a `[data-*]` attribute,
then `tag.class` filtered to human-looking classes, then `tag:nth-of-type(n)`.
Reject classes matching `/^(css|sc|jsx|emotion)-|[-_][a-z0-9]{5,}$/i` as
machine-generated (spec FR-027).

**Rationale**: postings on one host share a template but not ids or positions, so
the selector must describe structure rather than identity. Capping path length
(≈4 segments) keeps it general enough to match a sibling posting.

**Open for validation**: FR-028's real test is cross-posting generalization —
learn on one posting, verify on a different one from the same board. The corpus
capture script already resolves up to 4 candidate postings per board
(`MAX_CANDIDATES`), so the second posting needed for that test is available
without new tooling.

---

## R8. Learned-selector storage

**Decision**: `chrome.storage.local`, key `learned:<host>`, cap 200 hosts with
LRU eviction, retire after **3** consecutive misses.

**Rationale**: `local` keeps spec FR-033 ("selectors never leave the browser")
literally true. `sync` would follow the user across machines but replicates
through Google's servers, making that claim arguable, and imposes an 8 KB
per-item / 100 KB total quota that a 200-host store would strain.

Three misses tolerates a transient render failure without stranding the user on a
dead learning; a single miss would retire on any slow hydration, which Story 1
shows is common.

**Alternatives rejected**:
- *`chrome.storage.sync`* — see above; revisit only if users ask for it, and then
  as an explicit opt-in with revised privacy copy.
- *Never retire* — a site redesign would permanently degrade that host with no
  user-visible cause.

---

## R9. Testing strategy — and a fidelity problem

**Decision**: Three tiers.

1. **Story 1 (readiness)**: a **synthetic delayed-hydration fixture** served over
   the existing e2e localhost server, injecting posting text after a configurable
   delay. Cases: hydrates at 200 ms (fast path), at 3500 ms (Phenom-like), never
   (budget expiry → thin-content), and JSON-LD-early/text-late (the 3/6 flaw).
2. **Story 2 (containers, structured sources)**: Playwright against the captured
   `settled.html` fixtures, asserting selected strategy and forbidden substrings
   (no `"Cookie Policy"` on Lever, no `"Skip to main content"` on Workday).
3. **Stories 3–4 (paste, picker)**: existing vitest + Testing Library for panel
   UI; Playwright for the picker overlay's hover/click/Escape behavior.

**Rationale — the fidelity problem**: `vitest.config.ts` uses the **jsdom**
environment, and jsdom does not implement `innerText`. The extractor's
`clone.innerText ?? clone.textContent` therefore silently takes the `textContent`
branch in every existing unit test — a different code path from production, where
`innerText` is layout-aware and skips hidden subtrees. `pageExtractor.ts` already
depends on that distinction (the Google-overlay branch exists precisely because a
detached clone degrades to `textContent`).

Link density and visibility scoring (R3) depend on `innerText` and
`getBoundingClientRect`, neither faithful in jsdom. **Container scoring must
therefore be validated in real Chromium against the corpus, not in jsdom.**
jsdom unit tests remain appropriate for pure logic — selector generation (R7),
LRU eviction (R8), paste hashing (R6).

This does not lower the constitution's ≥80% changed-module coverage bar (QG-2);
it relocates where the meaningful assertions run.

---

## R10. Preserving existing behavior

**Decision**: Two existing behaviors are explicit regression targets, not
incidental.

- **The Google SERP overlay branch** (`pageExtractor.ts:68–84`) must keep winning
  on Google search pages. It reads `innerText` on the **live** node deliberately —
  `textOf` would leak neighboring postings' hidden preloaded detail views. The
  scorer must not be allowed to override it, and
  `pageExtractorGoogleOverlay.test.ts` must keep passing.
- **`thin-posting-control`** must keep producing the thin-content error. It is a
  true negative: 2,061 chars in the entire document, stable to 15 s. Any change
  that makes it "succeed" is fabricating content (spec SC-003a).

---

## Summary of what measurement changed

| First-draft assumption | Outcome |
|---|---|
| Blob harvesting is the highest-leverage move | **Withdrawn** — no fixture supports it (R4) |
| Container scoring is a gap-filler for pages with no `main` | **Promoted to highest value** — 3/6 on body path (R3) |
| Readiness is a missing retry loop | **Predicate is also wrong** — passes before text exists on 3/6 (R1) |
| ~3 s readiness budget | **6 s** — 3 s misses the motivating fixture (R1) |
| jsdom unit tests cover extraction | **Partly illusory** — no `innerText` in jsdom (R9) |
