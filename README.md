# Job Posting Analyzer

A Chrome extension that analyzes job postings on any page. Click the toolbar icon on a job listing and get a structured breakdown in the side panel: work arrangement (remote/hybrid/onsite) with evidence and confidence, salary, seniority, tech stack, and — if you configure a candidate profile — a 0–100 fit score.

Access is by invitation: every feature requires signing in with a Google account that the developer has allowlisted. The candidate profile and saved postings are stored server-side per account, so they follow you across devices and browsers.

## How it works

- On toolbar click, the extension reads the active tab's JSON-LD `JobPosting` data and page text (no broad host permissions — `activeTab`, plus `identity` for Google sign-in).
- Sign-in uses `chrome.identity.launchWebAuthFlow` (OIDC id_token flow); every backend request carries the Google ID token as a Bearer token, which the Functions backend verifies (signature/`aud`/`iss`/`exp`) and checks against a developer-managed `AllowedUsers` table before doing any work. Sessions survive browser restarts for ~30 days via silent renewal.
- The page content is sent to an Azure Functions backend, which calls Azure OpenAI with a strict JSON-schema response format to extract structured fields.
- Results can be saved with status and notes to a per-account library in Azure Table Storage (soft cap 1,000, export as JSON, prune-archived at cap); revisiting a saved posting is deduplicated via canonicalized URLs. On first sign-in, data saved by pre-sign-in versions is offered for a one-time migration into the account.
- A candidate profile (configured on the extension's options page, stored per account) can be included in requests to score how well a posting fits.

## Managing who can use it

The allowlist is a Table Storage table edited with a local CLI — no rebuild or redeploy; changes take effect on the account's next request:

```bash
cd functions
npm run allowed-users -- add someone@gmail.com --note "who this is"
npm run allowed-users -- remove someone@gmail.com   # access revoked; their data is retained
npm run allowed-users -- list
```

The connection string comes from `--connection-string`, `TABLES_CONNECTION_STRING`, or `AzureWebJobsStorage` (point it at the production storage account to manage the live allowlist).

## Project layout

- `extension/` — WXT (Chrome MV3) + React 18 + Tailwind side panel extension
- `functions/` — Azure Functions v4 (Node 20, TypeScript) backend exposing `POST /api/analyze-job`

## Development

```bash
cd extension && npm install && npm run dev      # extension dev server
cd functions && npm install && npm start          # functions dev server (func CLI)
```

Copy `functions/local.settings.json.example` to `functions/local.settings.json` and fill in your Azure OpenAI endpoint/key plus `GOOGLE_OAUTH_CLIENT_ID` (a Web-application OAuth client whose redirect URI is `https://<extension-id>.chromiumapp.org/`). Set `WXT_AZURE_FUNCTION_URL` / `WXT_AZURE_FUNCTION_KEY` / `WXT_API_BASE_URL` / `WXT_GOOGLE_OAUTH_CLIENT_ID` in `extension/.env.local` to point the extension at your backend. For local tables, run `npm run azurite` in `functions/` and allowlist yourself with the CLI. Full walkthrough: `specs/002-account-persistent-storage/quickstart.md`.

`REQUIRE_AUTH` (Function App setting) gates auth enforcement: it defaults to off so older extension versions keep working, and is flipped to `true` once the sign-in-gated extension version is the released floor (see the rollout notes in `specs/002-account-persistent-storage/plan.md`).

## Testing

```bash
cd extension && npm test        # vitest unit + msw contract tests
cd extension && npm run test:e2e  # playwright e2e (opt-in, requires E2E=1 and a live backend)
cd functions && npm test        # vitest unit tests (starts Azurite automatically)
cd functions && npm run test:integration  # endpoint/auth/perf tests against Azurite
```

Google token verification is tested with really-signed JWTs against a locally served certs stub; the browser-interactive OAuth hop is the one thing not driven in CI — run a manual sign-in smoke test before tagging a release.

## CI/CD

- `ci.yml` — lint, unit tests, build on every non-`main` push
- `cd.yml` — CI gate, deploys `functions/` to Azure via OIDC, auto-bumps the extension version and tags a release on `main`
- `release.yml` — builds the extension with production secrets baked in and publishes a zip to the private `job-posting-analyzer-releases` repo
