# UX & Accessibility Requirements Checklist: Resilient Page Extraction

**Purpose**: QG-3 gate — validate that the *requirements* governing this feature's user-facing surfaces are complete, unambiguous, consistent, and measurable, before implementation begins. This audits the writing in `spec.md`/`plan.md`, not the built UI.
**Created**: 2026-07-26
**Feature**: [spec.md](../spec.md) | **Depth**: Formal gate | **Scope**: All four stories | **Audience**: Non-author reviewer (constitution QG-3)

**How to use**: Each item asks whether something is adequately *specified*. A failing item is resolved by editing the spec, not by writing code. Items marked `[Gap]` check for requirements that appear to be absent entirely.

## Requirement Completeness — User-Facing Surfaces

- [x] CHK001 Are requirements defined for what the panel displays *during* a scoped re-analysis, between the user committing a picked or selected region and the result arriving? [Gap, Spec §FR-026]
      **Resolved 2026-07-26** — FR-007a now states the progress indicator MUST appear within 300 ms of *any* analysis trigger, explicitly including a scoped picker/selection commit, not only page load.
- [x] CHK002 Is the placement of the "Pick region" entry point specified for the *successful-but-wrong* case? FR-023 requires it be reachable from both a failed extraction and a successful one, but only the failure surface (the thin-content card) is described anywhere. [Gap, Spec §FR-023]
      **Verified already resolved** — FR-023 already states "reachable both from a failed extraction and from a successful-but-wrong one" on the "This Page" surface; no further edit needed.
- [x] CHK003 Are requirements defined for what identifies a paste-sourced posting in the library list, given it has no URL and no filename? Feature 004's document source had a filename to display; FR-020 says only what must *not* be shown. [Gap, Spec §FR-020]
      **Resolved 2026-07-26** — new FR-020a: label derived from content (extracted title, else a short excerpt), never blank/URL-shaped/raw key.
- [x] CHK004 Does FR-020 enumerate the surfaces bound by "wherever a posting's source is shown or stored"? The web companion library was omitted from plan.md's file list and recovered only as a task-level deviation. [Completeness, Spec §FR-020]
      **Resolved 2026-07-26** — FR-020 now enumerates the panel Saved tab, the options page, and `web/src/pages/Library.tsx`, and names the plan.md deviation explicitly instead of leaving it to be recovered from tasks.md alone.
- [x] CHK005 Are requirements defined for the paste composer's initial/empty state — placeholder guidance, or any instruction telling the user what to paste? [Gap, Spec §FR-017b]
      **Resolved 2026-07-26** — FR-017c: empty state MUST show placeholder guidance (e.g. "Paste a job posting…").
- [x] CHK006 Are requirements defined for the options-page listing of learned hosts — what is shown per row, and whether clearing is confirmed or reversible? [Gap, Spec §FR-031]
      **Resolved 2026-07-26** — FR-031: each row shows the site and a clear control; clearing is immediate, no confirmation dialog, consistent with the action's low-stakes reversibility.
- [x] CHK007 Is the cancel affordance itself required to be present and labeled during the readiness wait, or does FR-006 only specify the *effect* of cancelling? [Ambiguity, Spec §FR-006]
      **Verified already resolved** — FR-006a already requires "a labeled cancel control ... present for the whole readiness wait"; this is a presence requirement, not only an effect. No further edit needed.
- [x] CHK008 Are requirements defined for how the learning offer is presented after a successful scoped analysis — inline, transient, or persistent — and what happens if the user neither accepts nor declines? [Gap, Spec §FR-026b]
      **Resolved 2026-07-26** — FR-026b: offer is inline (not a toast), stays visible/actionable until a choice, and navigating away without choosing counts as declining.

## Requirement Clarity & Measurability

- [x] CHK009 Is "the panel indicates the host was learned" quantified — what the indicator says, whether it is actionable (can the user undo the learning from there), and whether it persists across the session? [Clarity, Spec §FR-032]
      **Resolved 2026-07-26** — FR-032: example copy given, persists for as long as the result is shown, explicitly a plain-text label (not actionable) — undo happens on the options page (FR-031).
- [x] CHK010 Is "indicate what will be captured" (picker hover) defined with any observable criterion, or is it left to implementation to decide what "indicating" means? [Ambiguity, Spec §FR-024]
      **Resolved 2026-07-26** — FR-024: MUST show at minimum the candidate's text length, the same measure FR-024b's list shows, so pointer and keyboard paths convey the same fact.
- [x] CHK011 Can "the offer must describe the broader region it would actually store" be objectively satisfied? Describing a DOM subtree in plain language is unspecified work, and this is the hardest copy problem in the feature. [Measurability, Spec §Edge Cases]
      **Resolved 2026-07-26** — Edge Cases: acceptance criterion reframed as honesty about imprecision (say "a larger part of the page containing your selection" rather than a false-precise container name), not full precision, which is accepted as a hard, open copy problem.
- [x] CHK012 Is "added latency from readiness checking is negligible relative to the analysis call" (SC-004) expressed as a threshold a reviewer could apply without reading plan.md's 150 ms fast path? [Measurability, Spec §SC-004]
      **Resolved 2026-07-26** — SC-004 now cites the ~150 ms fast path (FR-004) directly in the spec.
- [x] CHK013 Are the usable minimum (300) and content cap (40 000) required to be *disclosed to the user* as concrete numbers, or only enforced? FR-018 and FR-034 both require an explanation without saying whether the bound is named. [Clarity, Spec §FR-018, §FR-034]
      **Resolved 2026-07-26** — new FR-018a: refusal MUST state the applicable number, not merely that a bound was crossed; applies to both FR-018 and FR-034.
- [x] CHK014 Is "dismissible without side effects" defined for the picker — specifically whether dismissal restores prior scroll position, focus, and any page styling the overlay altered? [Clarity, Spec §FR-025]
      **Resolved 2026-07-26** — FR-025: "without side effects" now explicitly requires restoring scroll position, focus, and removing overlay styling.
- [x] CHK015 Is "unavailable with a stated reason" specified as *one* reason or several? A `no-access` page and an extraction failure are different causes with different remedies. [Ambiguity, Spec §FR-036a]
      **Resolved 2026-07-26** — FR-036a: reason MUST distinguish a `no-access` page from a page the extension can read but where scoping separately failed (e.g. shadow root / cross-origin iframe).

## Requirement Consistency

- [x] CHK016 Is the user-facing vocabulary for the learned-region concept pinned to a single term? The artifacts use "learned selector" (FR-028–FR-031), "learned region" (FR-032, T080), "scoped region" (Key Entities), and "Pick region" (FR-023) — constitution III requires stable terminology in user-facing copy. [Conflict, Spec §FR-028–§FR-032, Constitution III]
      **Resolved 2026-07-26** — spec §User-Facing Vocabulary fixes region / site / analyze / always, and bars learn, remember, save, selector, host, pick, scope from user copy. Code vocabulary unchanged. T084 greps for violations.
- [x] CHK017 Are the two below-minimum refusal messages (pasted text, FR-018; scoped region, FR-034) required to be consistent with each other in wording and in the next action they offer? [Consistency, Spec §FR-018, §FR-034]
      **Resolved 2026-07-26** — FR-018a requires the same sentence shape and next-action kind across both refusals; FR-034 now cross-references it.
- [x] CHK018 Is the cancel affordance required to be the same control, in the same place, during the readiness wait as during the model call? The user cannot distinguish the two phases. [Consistency, Spec §FR-006]
      **Resolved 2026-07-26** — FR-006a: explicitly the same control in the same place across both phases.
- [x] CHK019 Do the paste entry points stay consistent — the persistent header button (FR-017) and the contextual shortcuts in the failure/no-access states (FR-017e) — in label and in the state they open the composer into? [Consistency, Spec §FR-017, §FR-017e]
      **Resolved 2026-07-26** — FR-017e: shortcut MUST open the same composer with the same label and same empty-or-draft state as the header button.
- [x] CHK020 Are the requirements for the picker and for "Analyze selection" consistent about what the user is told after committing, given FR-023c makes both feed one learning path? [Consistency, Spec §FR-023c, §FR-026b]
      **Verified already resolved** — the "Common to both" heading over FR-026–FR-034 already binds both mechanisms to the same post-commit and learning-offer requirements; FR-026b's 2026-07-26 edit (inline offer, confirmation copy) applies to both without needing a separate statement.
- [x] CHK021 Does the spec state whether "This Page" and "Saved" remain switchable while the paste composer is open? FR-017b hides the tab panels and FR-017c describes preservation "while it is closed", which together imply but never state that tabs are inert. [Ambiguity, Spec §FR-017b, §FR-017c]
      **Resolved 2026-07-26** — FR-017b now states the tab controls MUST NOT be reachable (pointer or keyboard) while the composer is open.

## Accessibility Requirements (WCAG 2.1 AA, Constitution III)

- [x] CHK022 Are keyboard-operability requirements defined for the picker itself? FR-024/FR-025 specify hover, click, and Escape only — a mouse-only path to a core function is a WCAG 2.1.1 failure, and no requirement anywhere provides a keyboard alternative. [Gap, Spec §FR-024, Constitution III]
      **Resolved 2026-07-26** — FR-024a puts the keyboard path in the *panel* (an in-page overlay cannot take focus from a panel control, so key handlers on the overlay would not have fixed this); FR-024b specifies the candidate list; FR-025 adds focus restoration; SC-011 and T064a gate it with a pointer-event-free test.
- [x] CHK023 Is the accessible announcement of the picker's current highlight a *requirement*, or only a plan-level intention? It appears in plan.md's Constitution Check and in T069 but in no FR. [Gap, Spec §FR-024, Plan §Constitution Check III]
      **Resolved 2026-07-26** — new sentence in FR-024b: moving between candidates (arrow key or hover) MUST be announced via an `aria-live` region naming the current candidate.
- [x] CHK024 Are contrast requirements specified for the picker's highlight treatment, which is non-text UI drawn over arbitrary third-party pages (WCAG 1.4.11)? [Gap, Constitution III]
      **Resolved 2026-07-26** — new FR-024c: 3:1 contrast against adjacent page content, per WCAG 1.4.11, with a rendering approach (e.g. mixed-blend-mode outline) called out since the underlying page's colors are not controlled.
- [x] CHK025 Is the picker's highlight required to be perceivable without relying on color alone (WCAG 1.4.1)? [Gap, Constitution III]
      **Resolved 2026-07-26** — FR-024c also requires a shape/outline change, not color alone, per WCAG 1.4.1.
- [x] CHK026 Are focus-management requirements defined for the paste composer — where focus lands on open, and that it returns to the header button on Escape or close? FR-017b specifies dismissal but not focus. [Gap, Spec §FR-017b]
      **Resolved 2026-07-26** — FR-017b: focus MUST move into the composer's text area on open, and return to the header button on close (Escape or close control).
- [x] CHK027 Is the composer required to be an accessibly-labeled region, so its opening is perceivable to a screen-reader user beyond the button's `aria-pressed` state change? [Completeness, Spec §FR-017b]
      **Resolved 2026-07-26** — FR-017b: composer MUST be an accessibly-labeled region (e.g. `role="region"` with an accessible name).
- [x] CHK028 Are accessible-label requirements defined for the learned-region badge (FR-032) and for the disabled scoping controls with their stated reason (FR-036a), so the reason is programmatically available and not visual-only? [Gap, Spec §FR-032, §FR-036a]
      **Resolved 2026-07-26** — new FR-032a: badge has an accessible name equivalent to its visible text; disabled-control reason MUST be programmatically associated (e.g. `aria-describedby`).
- [x] CHK029 Is the header row's keyboard focus order specified, now that a non-tab button sits beside a tablist whose arrow-key behavior differs from Tab? FR-017a fixes the semantics but says nothing about traversal. [Gap, Spec §FR-017a]
      **Resolved 2026-07-26** — FR-017a: Tab moves between the tablist and the button as sibling stops; arrow keys stay scoped to moving between tabs inside the tablist.

## Feedback, Progress & Error Requirements

- [x] CHK030 Is a requirement stated that the progress indicator appears within constitution III's 300 ms threshold *from the trigger*, now that up to 6 s of readiness waiting precedes the model call? plan.md asserts the existing spinner "already covers" it without a requirement backing the claim. [Gap, Constitution III, Plan §Constitution Check III]
      **Resolved 2026-07-26** — new FR-007a states the 300 ms threshold explicitly, from the moment analysis is triggered, replacing the prose paragraph that only asserted it.
- [x] CHK031 Is the spinner's copy required to remain accurate across both phases, or may a page still be waiting on readiness while the user is told it is being analyzed? [Ambiguity, Constitution III]
      **Resolved 2026-07-26** — FR-007a explains why shared copy is not an inaccuracy: it describes the analysis as a whole, which is true throughout both phases, rather than making a claim specific to either.
- [x] CHK032 Are requirements defined for the *action hierarchy* of the thin-content error card, which now hosts Retry, Pick region, and a paste shortcut? The three-actions-in-one-red-box concern is recorded as a plan watch item with no governing requirement. [Gap, Spec §FR-005, §FR-037, Plan §Constitution Check III]
      **Resolved 2026-07-26** — new FR-007b resolves the plan.md watch item: Retry primary (filled button), "Analyze a region" secondary (outlined/text button), paste shortcut quietest (plain-text link).
- [x] CHK033 Does FR-005 specify what Retry actually re-runs after a budget expiry — a fresh readiness cycle, or the same failed extraction — so its label can be honest? [Ambiguity, Spec §FR-005]
      **Verified already resolved** — FR-005a already requires retry to "re-run extraction from the beginning, including a fresh readiness cycle." No further edit needed.
- [x] CHK034 Does FR-037 enumerate the new error and empty states it binds, or must a reviewer derive the list themselves? A requirement that names no states cannot be checked for coverage. [Completeness, Spec §FR-037]
      **Resolved 2026-07-26** — FR-037 now lists the six states it binds by requirement ID.
- [x] CHK035 Are requirements defined for the feedback shown after the user accepts the learning offer — a confirmation, and whether it names the host? [Gap, Spec §FR-026b]
      **Resolved 2026-07-26** — FR-026b: acceptance MUST show a brief confirmation naming the site, in the fixed vocabulary.

## Scenario & Edge Case Coverage

- [x] CHK036 The spec lists "'Analyze selection' invoked on a page whose analysis is already open in the panel for a *different* tab" as an edge case but states no expected user-visible outcome. Is the resolution specified anywhere? [Gap, Spec §Edge Cases]
      **Resolved 2026-07-26** — Edge Cases: the command targets the tab that was right-clicked; the panel switches to (or opens) that tab's analysis rather than overwriting the previously-open tab's result.
- [x] CHK037 Are requirements defined for the user-visible outcome when a selection lands in a shadow root or cross-origin iframe? The edge case requires failing "with an explanation" without specifying what the explanation must convey or whether the learning offer is suppressed. [Clarity, Spec §Edge Cases]
      **Resolved 2026-07-26** — Edge Cases: explanation must name the actual cause (not a generic scoping-failed message), and the learning offer MUST be suppressed since no selector can ever match.
- [x] CHK038 Is the user-visible behavior specified when a learned selector is silently retired after 3 misses — is the user told the learning is gone, or does the host quietly revert to automatic extraction? FR-029's "silently" governs the fallback, not the retirement. [Ambiguity, Spec §FR-029]
      **Resolved 2026-07-26** — FR-029: retirement itself is also silent, by design — the options page (FR-031) is the place to check what's currently learned, not a notification.
- [x] CHK039 Are requirements defined for the case where the user cancels during the readiness wait and then immediately re-triggers analysis on the same page? [Gap, Spec §FR-006]
      **Resolved 2026-07-26** — new FR-006c: re-triggering after a cancel MUST get a normal, full-budget attempt with no lockout or cooldown.
- [x] CHK040 Are recovery requirements defined for a scoped analysis that fails *after* the region was committed (network error, allowance exhausted) — does the user return to a state where the region is still selected, or start over? [Gap, Exception Flow, Spec §FR-026]
      **Resolved 2026-07-26** — new Edge Case: the committed region remains current; retrying re-runs against the same region rather than requiring the user to scope again.
- [x] CHK041 Is the interaction between the paste composer's retained draft (FR-017d) and an exhausted monthly allowance (FR-022) specified — is the user warned before composing, or only on submit? [Coverage, Spec §FR-017d, §FR-022]
      **Resolved 2026-07-26** — new FR-017f: allowance-exhausted state MUST show immediately on opening the composer, before the user starts typing.

## Dependencies, Assumptions & Traceability

- [x] CHK042 Is the assumption that the existing "Analyzing page…" spinner satisfies constitution III for a 6 s pre-model wait recorded as an assumption to be validated at QG-3, rather than as settled fact? [Assumption, Plan §Constitution Check III]
      **Resolved 2026-07-26** — the assumption is now a spec requirement (FR-007a) rather than only a plan.md assertion; QG-3 validates the requirement, closing the assumption out.
- [x] CHK043 Is the dependency of US4's honest degradation on US3 shipping first (FR-036a points unreadable pages at paste) reflected in the requirements, so US4 cannot ship alone with a dead-end message? [Dependency, Spec §FR-036a]
      **Resolved 2026-07-26** — FR-036a now states the dependency explicitly: this requirement is only satisfiable once Story 3 ships, and Story 4 MUST NOT ship its honest-degradation path ahead of it.
- [x] CHK044 Do the UX-bearing requirements carry acceptance criteria a non-author reviewer can apply without reading `tasks.md`? Several user-visible decisions (400 ms stability window, 3-miss retirement, 200-host cap, the 20 000-char structured cap) exist only in plan/contracts/tasks. [Traceability, Spec §FR-029, §FR-030]
      **Resolved 2026-07-26** — all four numbers now appear directly in spec.md: 400 ms (FR-002), 6000 ms budget and ~150 ms fast path (FR-003/FR-004), 3-miss retirement (FR-029), 200-host cap (FR-030), 20,000-character structured cap (FR-011).

## Notes

- Check items off as completed: `[x]`
- A failing item is fixed by amending `spec.md` (or recording the decision in `plan.md`), not by adjusting the implementation.
- **CHK022 is the highest-risk item**: a mouse-only picker is a WCAG 2.1 AA conformance failure, and no requirement currently prevents one from being built. It is resolved (FR-024a/FR-024b/FR-025, SC-011).
- CHK016 and CHK032 correspond to constitution III obligations (stable terminology; plain-language errors with a stated next action) that QG-3 is explicitly the gate for. Both resolved.
- Items referencing findings from the `/speckit-analyze` run: CHK004 (D2), CHK012 (A2), CHK044 (A1). All resolved 2026-07-26.
- **QG-3 status: PASS** — all 44 items resolved 2026-07-26 by edits to `spec.md` (FR-002 through FR-037, and the Edge Cases section). No implementation changes were required; this was a specification-completeness pass.
