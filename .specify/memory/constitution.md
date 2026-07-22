<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0
Modified principles: N/A
Added sections:
  - Core Principles: V. Cost Discipline (new) — codifies the "no new Azure
    resources" constraint that features 002–004 applied ad hoc, reframing the
    gate as cost (free-tier-first) rather than raw resource count. Adopted so
    004's hosting switch (GitHub Pages → Azure Static Web Apps Free tier) can
    close a real header/CSP capability gap without violating cost discipline.
Removed sections: N/A
Templates reviewed:
  - .specify/templates/plan-template.md ✅ aligned (Constitution Check section
    dynamically derives gates from this file — no template edit required)
  - .specify/templates/spec-template.md ✅ aligned (no structural change needed)
  - .specify/templates/tasks-template.md ✅ aligned (no structural change needed)
  - .specify/templates/commands/ — directory absent, skipped
Deferred TODOs: None
-->

# Job Posting Analyzer Constitution

## Core Principles

### I. Code Quality

All code MUST meet a consistent quality bar before merging:

- **Meaningful naming**: variables, functions, and modules MUST reflect their purpose
  without unexplained abbreviation.
- **No dead code**: unused imports, commented-out blocks, and orphaned files MUST be
  removed before merge.
- **Single responsibility**: each module, class, and function MUST do one thing;
  cross-cutting concerns MUST be extracted into shared utilities.
- **Code review**: every change MUST be reviewed by at least one other contributor
  before merge.

Rationale: low-quality code compounds technical debt in extraction pipelines where
page parsing, structured-output API calls, and result formatting are tightly coupled.

### II. Testing Standards

All features MUST be covered by automated tests before shipping:

- **Test-first**: tests MUST be written and confirmed to fail before implementation
  begins (Red-Green-Refactor cycle strictly enforced).
- **Coverage floor**: unit test coverage MUST NOT drop below 80% for any changed module.
- **Test pyramid**: each feature MUST include unit tests; integration tests MUST cover
  all external API interactions (Azure OpenAI structured-output calls); end-to-end
  tests MUST cover every P1 user journey.
- **No hollow mocks**: integration tests MUST use real API stubs or recorded fixtures —
  not hand-rolled mocks — to prevent mock/prod divergence.

Rationale: the analyzer depends on an external model API whose output contract can
change silently; tests guard against regressions users would otherwise discover in
production.

### III. User Experience Consistency

Every user-facing interaction MUST follow consistent patterns:

- **Feedback contract**: every operation with latency > 300 ms MUST display a progress
  indicator; users MUST never face a silent, frozen UI.
- **Error presentation**: all errors surfaced to the user MUST include a plain-language
  explanation and a suggested next action; raw stack traces MUST NOT be shown.
- **Consistent terminology**: user-facing copy MUST use stable vocabulary — "summary"
  MUST NOT be interchanged with "transcript", "digest", or "overview" without an explicit
  definition.
- **Accessibility**: all interactive UI elements MUST carry accessible labels; color
  contrast ratios MUST meet WCAG 2.1 AA minimum.

Rationale: users arrive with varying technical literacy; consistent patterns reduce
cognitive load and support overhead.

### IV. Performance Requirements

The system MUST meet the following measurable targets at all times:

- **End-to-end latency**: a job posting analysis MUST be returned in ≤ 30 seconds
  under standard conditions (100 Mbps connection, model API p95 ≤ 5 s).
- **UI responsiveness**: the interface MUST remain interactive during summary generation;
  all long-running operations MUST execute asynchronously without blocking input.
- **Memory ceiling**: the process MUST NOT exceed 512 MB RSS during normal operation.
- **Regression gate**: any PR that introduces a ≥ 20% regression in the p95 latency
  benchmark MUST be rejected until the regression is resolved.

Rationale: summarization is a latency-sensitive task; users abandon tools that feel slow,
making performance a first-class correctness concern.

### V. Cost Discipline

Infrastructure choices MUST optimize for near-zero recurring cost without sacrificing
required capability:

- **Free-tier-first**: new infrastructure MUST default to a provider's genuinely free
  tier (no time-boxed trial, no credit-card-triggered auto-billing) unless the required
  capability is unavailable at that tier.
- **Cost is the gate, not resource count**: adding a new managed resource is permitted
  when it is free (or negligible) and closes a real capability gap — e.g., response
  header control, SLA, edge latency — that a zero-resource baseline cannot provide.
  Avoiding a new resource for its own sake MUST NOT be used to justify a materially
  worse security or reliability posture.
- **Overage awareness**: any resource with metered overage billing MUST have its free
  quota and overage rate documented in the owning feature's `plan.md` before adoption.

Rationale: cost-consciousness has been enforced ad hoc across features 002-004 as
"no new Azure resources." Stated as a resource-count rule, it forced a real security
tradeoff in 004 — GitHub Pages' lack of response-header control on an authenticated
surface — to preserve a $0 outcome that a free-tier managed resource (Azure Static Web
Apps) achieves just as cheaply. Making cost, not resource count, the actual gate keeps
the project's cost discipline intact while removing that false choice.

## Quality Gates

Every feature MUST pass all four gates before it is considered complete:

- **QG-1 Code Quality**: linter passes with zero warnings; no TODO comments committed
  without an associated issue reference.
- **QG-2 Test Coverage**: CI reports ≥ 80% unit test coverage on changed modules; all
  integration tests pass against real API stubs or recorded fixtures.
- **QG-3 UX Review**: at least one non-author contributor confirms that error states and
  loading indicators behave consistently with Principle III.
- **QG-4 Performance Benchmark**: automated latency benchmark runs in CI; p95 latency
  for the job posting analysis scenario MUST be ≤ 30 s; memory peak MUST be ≤ 512 MB.

Exceptions to any gate MUST be documented in the PR description and explicitly approved
by the project maintainer before merge.

## Development Workflow

- **Branching**: all work MUST happen on feature branches following the
  `NNN-short-description` convention; direct commits to `main` are prohibited.
- **Review**: PRs MUST receive at least one approval before merge; self-merge is not
  permitted except for emergency hotfixes, which MUST be followed by a post-hoc review
  within 24 hours.
- **Dependency upgrades**: third-party dependency updates MUST be isolated to their own
  PR and include a full regression test run.
- **Documentation**: public APIs and CLI commands MUST have updated documentation in the
  same PR that introduces or changes them.

## Governance

This constitution supersedes all other development practices for the Job Posting
Analyzer project. Amendments require:

1. A PR updating this file with a version bump and an updated `Last Amended` date.
2. Written justification for the change in the PR description.
3. Approval from the project maintainer.

**Versioning policy** (semantic):
- MAJOR: removal or backward-incompatible redefinition of a principle.
- MINOR: new principle, section, or materially expanded guidance.
- PATCH: wording clarification, typo fix, or non-semantic refinement.

**Compliance review**: all PRs MUST verify the Constitution Check in `plan.md` is
satisfied. Any violation MUST be resolved or explicitly justified in writing before merge.

**Runtime guidance**: for day-to-day development decisions, refer to the active feature's
`plan.md` for context and gate details.

**Version**: 1.1.0 | **Ratified**: 2026-06-05 | **Last Amended**: 2026-07-21
