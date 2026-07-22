# Quickstart & Validation: Companion Web Application

How to run the new `web/` SPA against the local Functions API and validate every user story. Implementation details live in the contracts and data-model; this is the run/verify guide.

## Prerequisites

- Node 20, npm.
- The existing `functions/` and `extension/` packages install and build (per their READMEs).
- A **web OAuth client ID** (Google Cloud console → OAuth 2.0 Client, type *Web*, with the local dev origin and the Azure Static Web Apps origin as authorized JavaScript origins).
- Azurite for storage integration tests (`functions` already depends on it).

## One-time setup

```bash
# Backend env delta (functions/local.settings.json):
#   GOOGLE_OAUTH_CLIENT_IDS = "<extension-client-id>,<web-client-id>"   # falls back to GOOGLE_OAUTH_CLIENT_ID if unset
#   ALLOWED_ORIGINS         = "http://localhost:5173"                   # local Vite origin
#   REQUIRE_AUTH=true and METERING_ENFORCED=true to exercise the real gates

# Web package:
cd web
npm install
# web/.env.local:
#   VITE_GOOGLE_OAUTH_CLIENT_ID=<web-client-id>
#   VITE_API_BASE_URL=http://localhost:7071/api
```

## Run locally

```bash
# Terminal 1 — storage + API
cd functions && npm run azurite &        # local tables
cd functions && npm start                # Functions host on :7071

# Terminal 2 — web SPA
cd web && npm run dev                     # Vite on http://localhost:5173  (base "/", clean paths)
```

Open `http://localhost:5173/`.

## Validate by user story

### US1 — Sign in and see the same data (P1)
1. Signed out, load `/` → **landing page** renders, no account data, no API calls fire (check network tab).
2. Sign in with a Google account that has saved postings + a profile in the extension.
3. Expect the **same** library and profile to appear. Edit a posting in the extension, refresh web → change shows (and vice-versa).
4. Sign in with an unverified-email Google account → `403` plain-language verify-email message; no data shown.

### US2 — Search / filter / sort / compare (P2)
1. With a multi-posting library, type in search → list narrows; clear → restores.
2. Apply status + arrangement + seniority + a fit-score range together → only matching postings; filters are visible and removable.
3. Change sort (fit score / saved date) → reorders.
4. Select several postings → **side-by-side compare** shows their analyses together. Empty filter combo → empty-state message, not blank.

### US3 — Profile + account (P3)
1. Open profile → same content as extension. Edit + save → appears in extension; a subsequent analysis scores against the new text.
2. Paste > 20,000 chars → save blocked with the limit message.
3. Open account view → current plan, analyses used this month vs cap, renewal state — matches `GET /api/account`.

### US4 — Document analysis (P4)
Fixtures live in `functions/tests/fixtures/documents/`.
```bash
# Valid docx/pdf → 200 with same analysis shape, source="document", filename, saveKey, usage echo.
# Drive to cap then upload → 429 "allowance used, resets on <date>" + upgrade path.
```
1. Upload a valid `.docx` and a valid `.pdf` job description → structured analysis with the **same fields** as a page analysis; source shows the filename, not a URL.
2. Upload each invalid fixture and confirm the specific error **before** any allowance is consumed:
   - `encrypted.pdf` / `encrypted.docx` → `422 FILE_PASSWORD_PROTECTED`
   - `image-only.pdf` → `422 FILE_NO_TEXT`
   - `oversized.pdf` (> 10 MB) → `413 FILE_TOO_LARGE`
   - `renamed.txt.pdf` / mislabeled → `415 UNSUPPORTED_FILE_TYPE` or `422 FILE_UNREADABLE`
   - verify the usage counter did **not** move for any of these.
3. Exhaust the monthly allowance, upload a valid doc → `429` exhaustion state with reset date + upgrade path.

### US5 — Save a document analysis (P5)
1. Save a document-sourced analysis → appears in the web library **and** the extension, showing the filename as source; participates in search/filter/sort.
2. Fill the library to the tier cap, try to save → `409` at-cap message; nothing dropped.
3. Reopen the saved doc posting → analysis + filename present, **no** original-file download offered.

## Automated test commands

```bash
# Backend unit + the new endpoint's real-extraction + metering integration tests
cd functions && npm test
cd functions && npm run test:integration      # Azurite: reject-before-increment + parallel-race for analyze-document

# Web unit (filter/sort/search, auth store, save-key) + MSW contract tests
cd web && npm test
cd web && npm run build                        # base "/" static build → dist/
```

**Coverage gate**: ≥ 80% on changed modules (constitution QG-2), enforced in `ci.yml`'s new `web/` job and the existing `functions/` job.

## Key invariants to assert

- Rejected/failed uploads consume **zero** allowance (SC-005); parallel uploads at 1-remaining → exactly 1 success (SC-006).
- **Zero** uploaded document bytes persist after any request (SC-008) — assert storage holds only the analysis + filename for *saved* results.
- Signed-out visitor reaches **zero** account data (SC-010).
- Document analysis output shape is byte-identical to a page analysis (SC-004).

## Deploy (CI/CD)

- `ci.yml` gains a `web-ci` job (lint + test + build) on feature branches.
- `cd.yml` gains a `deploy-web` job that ships `web/dist` to a dedicated **Azure Static Web Apps (Free tier)** resource (`job-posting-analyzer-web`, `job-posting-analyzer-rg`, East US 2) via `Azure/static-web-apps-deploy@v1`, authenticated with a deployment token stored as the `AZURE_STATIC_WEB_APPS_API_TOKEN` GitHub secret. This is a deliberate exception to the "no new Azure resources" habit, permitted under constitution Principle V (Cost Discipline) — Free tier, $0, no metered overage at this traffic scale. GitHub Pages' `publish-coverage` job no longer bundles `web-dist`; it continues to serve only the marketing landing page, legal pages, and coverage reports.
