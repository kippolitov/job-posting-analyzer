# Implementation Plan: Companion Web Application with Document-Upload Analysis

**Branch**: `004-web-companion-app` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-web-companion-app/spec.md`

## Summary

Add a third monorepo package, `web/` — a static React 18 + TypeScript 5 (strict) + Tailwind SPA built with Vite — that signs users in with Google Identity Services (GIS) and reads/writes the **same** server-side account data as the extension. Library, profile, and account views are pure consumers of the existing `/api/profile`, `/api/jobs`, and `/api/account` endpoints (no backend changes); search / filter / sort / side-by-side comparison run client-side over the fetched library. One genuinely new capability — **document-upload analysis** — is a single new Functions endpoint, `POST /api/analyze-document`, that extracts text from an uploaded `.docx`/`.pdf` server-side, validates it (magic-byte sniff, 10 MB cap, encrypted / image-only rejection) **before** consuming allowance, then reuses the existing metering service and analyze orchestrator unchanged. Saved document-sourced analyses get a small `SavedJobs` schema extension (a `source` discriminator, `filename`, and a synthetic dedupe key). The entire backend auth delta is two lines of policy: widen the token `aud` check to a set of client IDs and add a CORS origin allowlist. Deployment extends `cd.yml`'s existing GitHub Pages job to publish the SPA under `/app/` — **zero new Azure resources**, consistent with 003's cost posture.

## Technical Context

**Language/Version**: TypeScript 5.x (strict) on both sides; Node 20 for Azure Functions; React 18 in `web/`.

**Primary Dependencies**:
- `web/`: React 18, Vite, Tailwind CSS, React Router (HashRouter), `google-accounts` / GIS script (loaded from Google, not bundled), MSW (dev/test only).
- `functions/` new runtime deps (the feature's **only** additions to the zero-new-deps posture, documented in research.md R6): `mammoth` (.docx text extraction) and `unpdf` (.pdf text extraction, serverless-friendly pdfjs wrapper). No new dep for type sniffing (manual magic-byte check) or multipart (native `request.formData()`).

**Storage**: Existing Azure Table Storage (`Users`, `Usage`, `SavedJobs`, `Profile`). No new tables. Uploaded document bytes are **never persisted** — held in memory for extraction only.

**Testing**: Vitest everywhere; Azurite table integration tests for the new endpoint's metering interaction; real `.docx`/`.pdf` fixtures driven through the true extraction path; MSW contract tests in `web/`. ≥80% changed-module coverage bar (constitution QG-2).

**Target Platform**: Static GitHub Pages hosting under `/app/` (SPA); Azure Functions (Linux, Node 20) for the API. Web views must be fully usable on mobile viewports.

**Project Type**: Monorepo with three packages — `extension/` (WXT), `functions/` (Azure Functions), `web/` (new Vite SPA) — plus a new shared-types location both `extension/` and `web/` import.

**Performance Goals**: Document analysis shares the analyze path budget — ≤ 8 s p50, 30 s ceiling (constitution QG-4) — with text extraction adding a sub-second budget at the 10 MB cap. Any operation > 300 ms shows a progress indicator (constitution III). Landing + library first render usable on a mobile viewport.

**Constraints**: GitHub Pages cannot rewrite paths → **hash-based routing** (research R1). Functions process memory ceiling 512 MB (constitution IV) bounds in-memory PDF parsing at 10 MB. GIS ID tokens live ~1 hour and are held **in memory only, never localStorage** (research R2). Backend auth delta limited to: `aud` set + CORS allowlist (research R3).

**Scale/Scope**: Per-user library ≤ 1,000 postings (premium cap) — comfortably within client-side search/filter/sort/compare over a single fetched list. Single new endpoint; ~6 new web views (landing, library, posting detail, compare, profile, account, upload/analyze).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Derived from `.specify/memory/constitution.md` v1.0.0:

| Principle | Gate | Status |
|-----------|------|--------|
| **I. Code Quality** | Meaningful naming, no dead code, single responsibility, review before merge. Shared analysis/job types extracted to one location — no duplication between `extension/` and `web/`. | ✅ PASS — extraction of shared types actively removes duplication; new endpoint is one focused handler delegating to existing services. |
| **II. Testing Standards** | Test-first (Red-Green-Refactor); ≥80% coverage on changed modules; integration tests use real fixtures/stubs not hollow mocks; E2E covers every P1 journey. | ✅ PASS — plan mandates real `.docx`/`.pdf` fixtures through the true extraction path, Azurite metering integration tests (reject-before-increment + parallel races), MSW contract tests; P1 (sign-in + see shared data) gets an E2E path. |
| **III. UX Consistency** | Progress indicator for > 300 ms ops; plain-language errors + next action, no raw traces; stable terminology; WCAG 2.1 AA labels/contrast. | ✅ PASS — upload/analyze and library fetch show progress; all validation/quota/cap errors are plain-language with an action (reuses 003's exact messages); web reuses the extension's design tokens for consistent terminology; a11y labels required on interactive elements. |
| **IV. Performance** | Analysis ≤ 30 s; UI async/non-blocking; ≤ 512 MB memory; reject ≥ 20% p95 regression. | ✅ PASS — document path shares the analyze budget + sub-second extraction; upload/analyze is async with progress; 10 MB cap enforced at the boundary bounds memory; no change to the analyze latency path itself. |

**Quality Gates**: QG-1 (lint zero-warnings — `web/` gets its own lint gate in ci.yml), QG-2 (≥80% coverage — enforced in ci.yml for `web/`), QG-3 (UX review of error/loading states), QG-4 (latency benchmark — document path inherits the analyze scenario budget).

**Development Workflow**: Feature branch `004-web-companion-app` ✅; dependency additions (`mammoth`, `unpdf`) isolated and documented as the deliberate zero-new-deps exception (research R6); docs updated in-PR (contracts/ + quickstart.md).

**Result**: No violations. Complexity Tracking table omitted (nothing to justify). A third monorepo package is an extension of the existing two-package layout, not new architectural complexity.

## Project Structure

### Documentation (this feature)

```text
specs/004-web-companion-app/
├── plan.md              # This file
├── research.md          # Phase 0 output — R1..R8 decisions
├── data-model.md        # Phase 1 output — SavedJobs source extension + entities
├── quickstart.md        # Phase 1 output — run/validate guide
├── contracts/
│   ├── analyze-document.md   # New POST /api/analyze-document (multipart) contract
│   ├── web-auth.md           # GIS client flow + aud-set + CORS allowlist delta
│   └── consumed-endpoints.md # Existing /api/profile, /api/jobs, /api/account reused as-is
└── checklists/
    └── requirements.md  # From /speckit-specify (all items pass)
```

### Source Code (repository root)

```text
web/                                # NEW package — static Vite SPA
├── index.html
├── package.json                    # React 18, Vite, Tailwind, react-router, msw (dev)
├── vite.config.ts                  # base: "/app/"
├── tailwind.config.cjs             # imports shared design tokens
├── tsconfig.json                   # strict; path alias to shared/
├── src/
│   ├── main.tsx                    # HashRouter root
│   ├── auth/                       # GIS init, in-memory token store, silent refresh
│   ├── api/                        # fetch client (Bearer token) for profile/jobs/account/analyze-document
│   ├── pages/                      # landing, library, posting-detail, compare, profile, account, upload
│   ├── components/                 # library table/cards, filters, compare grid, upload dropzone, usage/plan banner
│   └── lib/                        # client-side search/filter/sort, doc-source save-key helper
└── tests/
    ├── unit/                       # filter/sort/search, auth store, save-key
    └── contract/                   # MSW: auth 401/403, quota 429+resetDate, cap 409, upload error states

shared/                             # NEW — single source of shared TS types + design tokens
├── types/                          # Arrangement, Seniority, JobStatus, Fit, Salary, SavedJob*, analysis shapes
└── tokens/                         # design tokens consumed by both extension/ and web/ Tailwind configs

functions/                         # EXISTING — minimal additions
├── src/
│   ├── analyze-document/
│   │   └── index.ts                # NEW endpoint: multipart → sniff → validate → meter → orchestrate
│   ├── services/
│   │   ├── documentExtraction.ts   # NEW: magic-byte sniff, size cap, mammoth/unpdf, encrypted/image-only detection
│   │   ├── auth.ts                 # EDIT: aud → set of client IDs (GOOGLE_OAUTH_CLIENT_IDS)
│   │   ├── http.ts                 # EDIT: CORS origin allowlist (ALLOWED_ORIGINS)
│   │   ├── meteringService.ts      # UNCHANGED — reused (checkAndIncrement/refundOnSystemFailure)
│   │   ├── jobExtractionOrchestrator.ts  # UNCHANGED — reused via synthetic extract
│   │   └── savedJobsRepository.ts  # EDIT: document source discriminator + synthetic key path
│   └── models/
│       ├── user.ts                 # EDIT: SavedJob{Entity,Payload} += source/filename; relax PUT validation for doc source
│       └── job.ts                  # (types migrate toward shared/; re-export to avoid churn)
└── tests/
    ├── integration/                # NEW: analyze-document metering (reject-before-increment, parallel races)
    └── fixtures/documents/         # NEW: valid/encrypted/image-only/oversized/mislabeled .docx & .pdf

extension/                          # EXISTING — imports migrate to shared/ types (no behavior change)

.github/workflows/
├── ci.yml                          # EDIT: add web/ lint+test+build job; keep ≥80% coverage gate
└── cd.yml                          # EDIT: publish-coverage job also builds web/ → pages/app/
```

**Structure Decision**: Three-package monorepo. `web/` is a standalone Vite SPA deployed statically under `/app/`; `shared/` holds the analysis/job TypeScript types and design tokens that both `extension/` and `web/` import (replacing the current duplication between `extension/types/job.ts` and `functions/src/models/job.ts`). All backend work is additive except two small policy edits (`auth.ts` aud-set, `http.ts` CORS allowlist) and one small model/repository extension for document-sourced saved jobs.

## Complexity Tracking

No constitution violations — table omitted.
