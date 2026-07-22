# Changelog

All notable changes to Job Posting Analyzer are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
match `extension/package.json` (auto-bumped by `cd.yml` on every merge to
`main`, then auto-published to the Chrome Web Store by `release.yml`).

This file starts with the [`004-web-companion-app`](specs/004-web-companion-app/)
release — the first one written up here. For the self-serve freemium/Premium
launch that preceded it, see [`specs/003-freemium-premium-tier/`](specs/003-freemium-premium-tier/)
(shipped as of `v0.0.22`); for the original extension and account storage, see
[`specs/001-job-posting-analyzer/`](specs/001-job-posting-analyzer/) and
[`specs/002-account-persistent-storage/`](specs/002-account-persistent-storage/).

**How this stays current:** every PR with a user-facing or notable change adds
its own bullet points under `## [Unreleased]` below (Added/Changed/Fixed/
Removed, whichever apply — see the `[0.0.29]` entry for the shape). On merge
to `main`, `cd.yml`'s version-bump step automatically renames
`## [Unreleased]` to `## [X.Y.Z] - <date>` matching the version it just
tagged, and opens a fresh empty `## [Unreleased]` above it — the same commit
that bumps `extension/package.json`. If `[Unreleased]` has no entries at
bump time (a pure CI/infra tweak, say), that release simply gets no
changelog section rather than an empty heading.

## [Unreleased]

## [0.0.29] - 2026-07-22

### Companion web app ([`004-web-companion-app`](specs/004-web-companion-app/))

#### Added

- **Companion web app** (`web/`) — a React 18 + TypeScript (strict) + Tailwind SPA, built with Vite, signed in via Google Identity Services. Reads and writes the **same** server-side account, candidate profile, and saved-postings library as the extension through the existing `/api/profile`, `/api/jobs`, and `/api/account` endpoints — no separate copy, no migration.
- Web app pages: **Library** (search, filter by status/work-arrangement/seniority/fit-score range, sort), **Compare** (side-by-side view of several saved analyses), **Upload** (document-based analysis), **Profile** (edit the shared candidate profile), and **Account** (plan, monthly usage, renewal state, upgrade/manage-subscription links).
- **Document-upload analysis** — `POST /api/analyze-document`: upload a `.docx`/`.pdf` (up to 10 MB), extract its text server-side (`mammoth`/`unpdf`), validate it (magic-byte sniff; reject password-protected, image-only, oversized, or unsupported files **before** any monthly allowance is consumed), then reuse the existing analysis orchestrator — identical structured output and fit scoring to a page-based analysis. The uploaded file itself is never retained; only the resulting analysis and filename are stored.
- **`shared/`** package — single-source TypeScript types (job/analysis) and design tokens consumed by both `extension/` and `web/`, replacing the prior duplication between `extension/types/job.ts` and `functions/src/models/job.ts`.
- Extension: `AccountBar` now links to the web app ("Open web app", build-time `WXT_WEB_APP_URL` — never hard-coded).
- Data-practices disclosure and Privacy Policy / Terms of Service links added to the web app itself (shown on the landing page before sign-in, and in a persistent footer on every authenticated page) — previously only the extension had this.
- Constitution **Principle V — Cost Discipline** (v1.0.0 → v1.1.0): reframes the prior ad-hoc "no new Azure resources" habit around cost (free-tier-first) rather than raw resource count, and documents the Azure Static Web Apps exception below.

#### Changed

- **Hosting**: `web/` now deploys to a dedicated **Azure Static Web Apps (Free tier)** resource instead of sharing the GitHub Pages origin — closes a real gap (GitHub Pages can't set response headers, so there was no real CSP for an authenticated surface) at $0 marginal cost. Clean-path routing (`BrowserRouter` + `staticwebapp.config.json`'s `navigationFallback`) is used, since the app no longer shares an origin with the coverage report or legal pages. GitHub Pages now serves only the marketing landing page, legal pages, and coverage reports.
- Paddle's checkout page (`checkout.html`) moved from GitHub Pages onto the Static Web Apps origin, with real per-route CSP for Paddle's domains; the default payment link on the live Paddle account has been switched to the new domain (Apple Pay verification carried over).
- Backend auth: the token `aud` check widened from a single client ID to a set (`GOOGLE_OAUTH_CLIENT_IDS`), and a `ALLOWED_ORIGINS` CORS allowlist was added — this two-line policy change is the **entire** backend auth delta for the companion app; every other endpoint is reused unchanged.
- `SavedJobs` schema extended with a `source` discriminator, `filename`, and a synthetic dedupe key to support document-sourced saves alongside URL-sourced ones.
- Legal pages (`docs/legal/privacy-policy.html`, `docs/legal/terms.html`): broadened from "the extension" to "the extension and the web app"; added a "Document upload" section describing the extract-then-discard handling of uploaded files.
- Marketing landing page (`docs/pages/index.html`): added a "Companion web app" section.
- CWS listing draft and prominent-disclosure compliance docs (`docs/compliance/`) extended to describe the web app surface and its document-upload data practice — the web app isn't itself reviewed by the Chrome Web Store, but the same disclosure principle now applies to it.

#### Fixed

- CI: a Functions perf-test ceiling for document text extraction (2 s p95) was too tight for GitHub-hosted runners and flaked twice in CI (2001.8 ms, then 2131.0 ms on rerun); raised to 4 s with an explanatory comment. The actual constitutional QG-4 gate (p95 ≤ 30 s on the full analyze-document request) was never at risk in either run.
- Resolved a merge conflict in `README.md` against `main`'s independently-landed repo-hygiene changes (`LICENSE.md`, `SECURITY.md`, an earlier README refresh) — no content lost on either side.
- Removed a live Azure Static Web Apps hostname that had been inadvertently included in the pull request's "Test plan" section.
