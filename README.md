# Job Posting Analyzer

A Chrome extension that analyzes job postings on any page. Click the toolbar icon on a job listing and get a structured breakdown in the side panel: work arrangement (remote/hybrid/onsite) with evidence and confidence, salary, seniority, tech stack, and — if you configure a candidate profile — a 0–100 fit score.

## How it works

- On toolbar click, the extension reads the active tab's JSON-LD `JobPosting` data and page text (no broad host permissions — just `activeTab`).
- The page content is sent to an Azure Functions backend, which calls Azure OpenAI with a strict JSON-schema response format to extract structured fields.
- Results can be saved to a local library (`chrome.storage.local`) with status and notes; revisiting a saved posting is deduplicated via canonicalized URLs.
- A candidate profile (configured on the extension's options page) can be included in requests to score how well a posting fits.

## Project layout

- `extension/` — WXT (Chrome MV3) + React 18 + Tailwind side panel extension
- `functions/` — Azure Functions v4 (Node 20, TypeScript) backend exposing `POST /api/analyze-job`

## Development

```bash
cd extension && npm install && npm run dev      # extension dev server
cd functions && npm install && npm start          # functions dev server (func CLI)
```

Copy `functions/local.settings.json.example` to `functions/local.settings.json` and fill in your Azure OpenAI endpoint/key. Set `WXT_AZURE_FUNCTION_URL` / `WXT_AZURE_FUNCTION_KEY` in `extension/.env.local` to point the extension at your backend.

## Testing

```bash
cd extension && npm test        # vitest unit tests
cd extension && npm run test:e2e  # playwright e2e (opt-in, requires E2E=1 and a live backend)
cd functions && npm test        # vitest unit tests
```

## CI/CD

- `ci.yml` — lint, unit tests, build on every non-`main` push
- `cd.yml` — CI gate, deploys `functions/` to Azure via OIDC, auto-bumps the extension version and tags a release on `main`
- `release.yml` — builds the extension with production secrets baked in and publishes a zip to the private `job-posting-analyzer-releases` repo
