# UX & Accessibility Requirements Checklist: Resilient Page Extraction

**Purpose**: QG-3 gate — validate that the *requirements* governing this feature's user-facing surfaces are complete, unambiguous, consistent, and measurable, before implementation begins. This audits the writing in `spec.md`/`plan.md`, not the built UI.
**Created**: 2026-07-26
**Feature**: [spec.md](../spec.md) | **Depth**: Formal gate | **Scope**: All four stories | **Audience**: Non-author reviewer (constitution QG-3)

**How to use**: Each item asks whether something is adequately *specified*. A failing item is resolved by editing the spec, not by writing code. Items marked `[Gap]` check for requirements that appear to be absent entirely.

## Requirement Completeness — User-Facing Surfaces

- [ ] CHK001 Are requirements defined for what the panel displays *during* a scoped re-analysis, between the user committing a picked or selected region and the result arriving? [Gap, Spec §FR-026]
- [ ] CHK002 Is the placement of the "Pick region" entry point specified for the *successful-but-wrong* case? FR-023 requires it be reachable from both a failed extraction and a successful one, but only the failure surface (the thin-content card) is described anywhere. [Gap, Spec §FR-023]
- [ ] CHK003 Are requirements defined for what identifies a paste-sourced posting in the library list, given it has no URL and no filename? Feature 004's document source had a filename to display; FR-020 says only what must *not* be shown. [Gap, Spec §FR-020]
- [ ] CHK004 Does FR-020 enumerate the surfaces bound by "wherever a posting's source is shown or stored"? The web companion library was omitted from plan.md's file list and recovered only as a task-level deviation. [Completeness, Spec §FR-020]
- [ ] CHK005 Are requirements defined for the paste composer's initial/empty state — placeholder guidance, or any instruction telling the user what to paste? [Gap, Spec §FR-017b]
- [ ] CHK006 Are requirements defined for the options-page listing of learned hosts — what is shown per row, and whether clearing is confirmed or reversible? [Gap, Spec §FR-031]
- [ ] CHK007 Is the cancel affordance itself required to be present and labeled during the readiness wait, or does FR-006 only specify the *effect* of cancelling? [Ambiguity, Spec §FR-006]
- [ ] CHK008 Are requirements defined for how the learning offer is presented after a successful scoped analysis — inline, transient, or persistent — and what happens if the user neither accepts nor declines? [Gap, Spec §FR-026b]

## Requirement Clarity & Measurability

- [ ] CHK009 Is "the panel indicates the host was learned" quantified — what the indicator says, whether it is actionable (can the user undo the learning from there), and whether it persists across the session? [Clarity, Spec §FR-032]
- [ ] CHK010 Is "indicate what will be captured" (picker hover) defined with any observable criterion, or is it left to implementation to decide what "indicating" means? [Ambiguity, Spec §FR-024]
- [ ] CHK011 Can "the offer must describe the broader region it would actually store" be objectively satisfied? Describing a DOM subtree in plain language is unspecified work, and this is the hardest copy problem in the feature. [Measurability, Spec §Edge Cases]
- [ ] CHK012 Is "added latency from readiness checking is negligible relative to the analysis call" (SC-004) expressed as a threshold a reviewer could apply without reading plan.md's 150 ms fast path? [Measurability, Spec §SC-004]
- [ ] CHK013 Are the usable minimum (300) and content cap (40 000) required to be *disclosed to the user* as concrete numbers, or only enforced? FR-018 and FR-034 both require an explanation without saying whether the bound is named. [Clarity, Spec §FR-018, §FR-034]
- [ ] CHK014 Is "dismissible without side effects" defined for the picker — specifically whether dismissal restores prior scroll position, focus, and any page styling the overlay altered? [Clarity, Spec §FR-025]
- [ ] CHK015 Is "unavailable with a stated reason" specified as *one* reason or several? A `no-access` page and an extraction failure are different causes with different remedies. [Ambiguity, Spec §FR-036a]

## Requirement Consistency

- [x] CHK016 Is the user-facing vocabulary for the learned-region concept pinned to a single term? The artifacts use "learned selector" (FR-028–FR-031), "learned region" (FR-032, T080), "scoped region" (Key Entities), and "Pick region" (FR-023) — constitution III requires stable terminology in user-facing copy. [Conflict, Spec §FR-028–§FR-032, Constitution III]
      **Resolved 2026-07-26** — spec §User-Facing Vocabulary fixes region / site / analyze / always, and bars learn, remember, save, selector, host, pick, scope from user copy. Code vocabulary unchanged. T084 greps for violations.
- [ ] CHK017 Are the two below-minimum refusal messages (pasted text, FR-018; scoped region, FR-034) required to be consistent with each other in wording and in the next action they offer? [Consistency, Spec §FR-018, §FR-034]
- [ ] CHK018 Is the cancel affordance required to be the same control, in the same place, during the readiness wait as during the model call? The user cannot distinguish the two phases. [Consistency, Spec §FR-006]
- [ ] CHK019 Do the paste entry points stay consistent — the persistent header button (FR-017) and the contextual shortcuts in the failure/no-access states (FR-017e) — in label and in the state they open the composer into? [Consistency, Spec §FR-017, §FR-017e]
- [ ] CHK020 Are the requirements for the picker and for "Analyze selection" consistent about what the user is told after committing, given FR-023c makes both feed one learning path? [Consistency, Spec §FR-023c, §FR-026b]
- [ ] CHK021 Does the spec state whether "This Page" and "Saved" remain switchable while the paste composer is open? FR-017b hides the tab panels and FR-017c describes preservation "while it is closed", which together imply but never state that tabs are inert. [Ambiguity, Spec §FR-017b, §FR-017c]

## Accessibility Requirements (WCAG 2.1 AA, Constitution III)

- [x] CHK022 Are keyboard-operability requirements defined for the picker itself? FR-024/FR-025 specify hover, click, and Escape only — a mouse-only path to a core function is a WCAG 2.1.1 failure, and no requirement anywhere provides a keyboard alternative. [Gap, Spec §FR-024, Constitution III]
      **Resolved 2026-07-26** — FR-024a puts the keyboard path in the *panel* (an in-page overlay cannot take focus from a panel control, so key handlers on the overlay would not have fixed this); FR-024b specifies the candidate list; FR-025 adds focus restoration; SC-011 and T064a gate it with a pointer-event-free test.
- [ ] CHK023 Is the accessible announcement of the picker's current highlight a *requirement*, or only a plan-level intention? It appears in plan.md's Constitution Check and in T069 but in no FR. [Gap, Spec §FR-024, Plan §Constitution Check III]
- [ ] CHK024 Are contrast requirements specified for the picker's highlight treatment, which is non-text UI drawn over arbitrary third-party pages (WCAG 1.4.11)? [Gap, Constitution III]
- [ ] CHK025 Is the picker's highlight required to be perceivable without relying on color alone (WCAG 1.4.1)? [Gap, Constitution III]
- [ ] CHK026 Are focus-management requirements defined for the paste composer — where focus lands on open, and that it returns to the header button on Escape or close? FR-017b specifies dismissal but not focus. [Gap, Spec §FR-017b]
- [ ] CHK027 Is the composer required to be an accessibly-labeled region, so its opening is perceivable to a screen-reader user beyond the button's `aria-pressed` state change? [Completeness, Spec §FR-017b]
- [ ] CHK028 Are accessible-label requirements defined for the learned-region badge (FR-032) and for the disabled scoping controls with their stated reason (FR-036a), so the reason is programmatically available and not visual-only? [Gap, Spec §FR-032, §FR-036a]
- [ ] CHK029 Is the header row's keyboard focus order specified, now that a non-tab button sits beside a tablist whose arrow-key behavior differs from Tab? FR-017a fixes the semantics but says nothing about traversal. [Gap, Spec §FR-017a]

## Feedback, Progress & Error Requirements

- [ ] CHK030 Is a requirement stated that the progress indicator appears within constitution III's 300 ms threshold *from the trigger*, now that up to 6 s of readiness waiting precedes the model call? plan.md asserts the existing spinner "already covers" it without a requirement backing the claim. [Gap, Constitution III, Plan §Constitution Check III]
- [ ] CHK031 Is the spinner's copy required to remain accurate across both phases, or may a page still be waiting on readiness while the user is told it is being analyzed? [Ambiguity, Constitution III]
- [ ] CHK032 Are requirements defined for the *action hierarchy* of the thin-content error card, which now hosts Retry, Pick region, and a paste shortcut? The three-actions-in-one-red-box concern is recorded as a plan watch item with no governing requirement. [Gap, Spec §FR-005, §FR-037, Plan §Constitution Check III]
- [ ] CHK033 Does FR-005 specify what Retry actually re-runs after a budget expiry — a fresh readiness cycle, or the same failed extraction — so its label can be honest? [Ambiguity, Spec §FR-005]
- [ ] CHK034 Does FR-037 enumerate the new error and empty states it binds, or must a reviewer derive the list themselves? A requirement that names no states cannot be checked for coverage. [Completeness, Spec §FR-037]
- [ ] CHK035 Are requirements defined for the feedback shown after the user accepts the learning offer — a confirmation, and whether it names the host? [Gap, Spec §FR-026b]

## Scenario & Edge Case Coverage

- [ ] CHK036 The spec lists "'Analyze selection' invoked on a page whose analysis is already open in the panel for a *different* tab" as an edge case but states no expected user-visible outcome. Is the resolution specified anywhere? [Gap, Spec §Edge Cases]
- [ ] CHK037 Are requirements defined for the user-visible outcome when a selection lands in a shadow root or cross-origin iframe? The edge case requires failing "with an explanation" without specifying what the explanation must convey or whether the learning offer is suppressed. [Clarity, Spec §Edge Cases]
- [ ] CHK038 Is the user-visible behavior specified when a learned selector is silently retired after 3 misses — is the user told the learning is gone, or does the host quietly revert to automatic extraction? FR-029's "silently" governs the fallback, not the retirement. [Ambiguity, Spec §FR-029]
- [ ] CHK039 Are requirements defined for the case where the user cancels during the readiness wait and then immediately re-triggers analysis on the same page? [Gap, Spec §FR-006]
- [ ] CHK040 Are recovery requirements defined for a scoped analysis that fails *after* the region was committed (network error, allowance exhausted) — does the user return to a state where the region is still selected, or start over? [Gap, Exception Flow, Spec §FR-026]
- [ ] CHK041 Is the interaction between the paste composer's retained draft (FR-017d) and an exhausted monthly allowance (FR-022) specified — is the user warned before composing, or only on submit? [Coverage, Spec §FR-017d, §FR-022]

## Dependencies, Assumptions & Traceability

- [ ] CHK042 Is the assumption that the existing "Analyzing page…" spinner satisfies constitution III for a 6 s pre-model wait recorded as an assumption to be validated at QG-3, rather than as settled fact? [Assumption, Plan §Constitution Check III]
- [ ] CHK043 Is the dependency of US4's honest degradation on US3 shipping first (FR-036a points unreadable pages at paste) reflected in the requirements, so US4 cannot ship alone with a dead-end message? [Dependency, Spec §FR-036a]
- [ ] CHK044 Do the UX-bearing requirements carry acceptance criteria a non-author reviewer can apply without reading `tasks.md`? Several user-visible decisions (400 ms stability window, 3-miss retirement, 200-host cap, the 20 000-char structured cap) exist only in plan/contracts/tasks. [Traceability, Spec §FR-029, §FR-030]

## Notes

- Check items off as completed: `[x]`
- A failing item is fixed by amending `spec.md` (or recording the decision in `plan.md`), not by adjusting the implementation.
- **CHK022 is the highest-risk item**: a mouse-only picker is a WCAG 2.1 AA conformance failure, and no requirement currently prevents one from being built.
- CHK016 and CHK032 correspond to constitution III obligations (stable terminology; plain-language errors with a stated next action) that QG-3 is explicitly the gate for.
- Items referencing findings from the `/speckit-analyze` run: CHK004 (D2), CHK012 (A2), CHK044 (A1).
