# Job Posting Analyzer

> A Chrome extension that turns any job listing into a structured, scored breakdown — allowing the user to analyze and manage job listings, rank them against your profile (resume/considerations) to help them find the right job.

![Demo](demo.gif)

Job Posting Analyzer is a **WXT (Manifest V3) + React 18 + TypeScript** side-panel extension backed by an **Azure Functions** API that calls **Azure OpenAI** with strict JSON-schema outputs. Click the toolbar icon on a job listing and the side panel shows work arrangement (remote/hybrid/onsite) with evidence and confidence, salary, seniority, and tech stack — plus a 0–100 fit score against your candidate profile.

Access is by invitation: every feature requires signing in with a Google account the developer has allowlisted. Profiles and saved postings live server-side per account, so they follow you across devices and browsers.

---

## What it does

| Surface | Capability |
|---|---|
| **Analyze** | One click extracts work arrangement, salary, seniority, and tech stack from any job page — with evidence quotes and confidence levels |
| **Fit score** | 0–100 match against your candidate profile, with a detailed breakdown of matching skills, gaps, and strengths/weaknesses of the role for you |
| **Candidate profile** | Paste your résumé / background (up to 20,000 chars) on the options page; stored per account and included in every analysis |
| **Saved library** | Save postings with status and notes; deduplicated by canonicalized URL; export and import as JSON; soft cap of 1,000 with prune-at-cap |
| **Account sync** | Google sign-in via `chrome.identity`; data saved before sign-in is offered a one-time migration into the account |

---

## Architecture

### The stack

- **Extension**: WXT (Chrome MV3), React 18, TypeScript 5 (strict), Tailwind CSS — side panel + options page
- **Backend**: Azure Functions v4 (Node 20, TypeScript) exposing `POST /api/analyze-job` plus profile and saved-jobs endpoints
- **AI**: Azure OpenAI with a strict JSON-schema response format — the model cannot return anything the extension can't render
- **Storage**: Azure Table Storage — per-account candidate profiles, saved postings, and the developer-managed allowlist
- **Auth**: Google OIDC (`chrome.identity.launchWebAuthFlow`); the backend verifies every ID token's signature/`aud`/`iss`/`exp` and checks the allowlist before doing any work

### Design decisions that matter

**Minimal permissions, maximal paranoia.** The extension asks for `activeTab` and `identity` — no broad host permissions. It reads the active tab's JSON-LD `JobPosting` data and page text only when you click the icon.

**The LLM is behind a contract.** Azure OpenAI is called with a strict JSON-schema response format, so extraction output is structurally validated before it ever reaches the UI. Prompt changes are regression-tested with an eval script (`npm run eval:postings`) against a corpus of real postings.

**Auth is enforced where it can't be bypassed.** The extension never holds secrets; every request carries a Google ID token that the Functions backend independently verifies and checks against an `AllowedUsers` table. Sessions survive browser restarts for ~30 days via silent renewal.

**Access control is data, not code.** The allowlist is a Table Storage table edited with a local CLI — no rebuild or redeploy; changes take effect on the account's next request:

```bash
cd functions
npm run allowed-users -- add someone@gmail.com --note "who this is"
npm run allowed-users -- remove someone@gmail.com   # access revoked; their data is retained
npm run allowed-users -- list
```

---

## AI-assisted workflow

This project was built using **Spec Kit** — a structured AI-assisted workflow that keeps every decision traceable from natural-language idea to running code.

```
spec.md → plan.md → tasks.md → implement (per ticket)
```

Every feature lives in `specs/`:

- **[`001-job-posting-analyzer`](specs/001-job-posting-analyzer/)** — the core extension: extraction, side panel, fit scoring
- **[`002-account-persistent-storage`](specs/002-account-persistent-storage/)** — Google sign-in, allowlisting, server-side profiles and saved postings, migration

Each feature carries its full paper trail: `spec.md` (user stories and acceptance scenarios), `plan.md` (stack and architecture decisions), `tasks.md` (dependency-ordered tickets), plus `research.md`, `data-model.md`, API `contracts/`, and a `quickstart.md`. Every decision is auditable because it's in a file — not buried in a chat log.

---

## CI/CD — nothing ships from a laptop

All three workflows live in [`.github/workflows/`](.github/workflows/):

```
Push (non-main)
  └── ci.yml ──► lint → unit tests → build

Merge to main
  └── cd.yml ──► CI gate → deploy functions/ to Azure via OIDC
                  → auto-bump extension version → tag a release

Release tag
  └── release.yml ──► build the extension with production secrets baked in
                       → publish a zip to a private releases repo
```

### Security posture

- **OIDC deploys** — no long-lived Azure credentials in GitHub
- **Secrets are never committed** — `local.settings.json` is gitignored; the template documents every setting
- **Staged auth rollout** — `REQUIRE_AUTH` gates enforcement server-side, so older extension versions keep working until the sign-in-gated version is the released floor
- **Really-signed JWTs in tests** — token verification is tested against a locally served certs stub, not mocks; the one browser-interactive OAuth hop is covered by a manual smoke test before each release

---

## Project structure

```
extension/
├── entrypoints/        # background.ts, sidepanel/, options/ (WXT MV3 entrypoints)
├── components/         # React UI components
├── services/           # Auth, API client, analysis cache, storage, migration, import
├── hooks/              # React hooks
└── tests/              # vitest unit + msw contract tests, playwright e2e

functions/
├── src/                # analyze-job, jobs, profile endpoints + services and models
├── scripts/            # allowlist CLI, posting eval harness
└── tests/              # vitest unit + integration tests (against Azurite)

specs/                  # Spec Kit artifacts — the paper trail for every feature
.github/workflows/      # CI/CD pipeline
```

---

## Running locally

```bash
cd extension && npm install && npm run dev       # extension dev server (WXT)
cd functions && npm install && npm start         # functions dev server (func CLI)
```

Copy `functions/local.settings.json.example` to `functions/local.settings.json` and fill in your Azure OpenAI endpoint/key plus `GOOGLE_OAUTH_CLIENT_ID` (a Web-application OAuth client whose redirect URI is `https://<extension-id>.chromiumapp.org/`). Point the extension at your backend via `WXT_AZURE_FUNCTION_URL` / `WXT_AZURE_FUNCTION_KEY` / `WXT_API_BASE_URL` / `WXT_GOOGLE_OAUTH_CLIENT_ID` in `extension/.env.local`. For local tables, run `npm run azurite` in `functions/` and allowlist yourself with the CLI. Full walkthrough: [`specs/002-account-persistent-storage/quickstart.md`](specs/002-account-persistent-storage/quickstart.md).

Tests:

```bash
cd extension && npm test                    # vitest unit + msw contract tests
cd extension && npm run test:e2e           # playwright e2e (opt-in: E2E=1 + a live backend)
cd functions && npm test                    # vitest unit tests (starts Azurite automatically)
cd functions && npm run test:integration   # endpoint/auth/perf tests against Azurite
```
