# Quickstart: Account-Backed Persistent Storage (dev setup)

## One-time setup

### 1. Google OAuth client

1. In any Google Cloud project → APIs & Services → Credentials → **Create OAuth client ID**, type **Web application**.
2. Add redirect URI `https://<extension-id>.chromiumapp.org/` (get the dev extension ID from `chrome://extensions` after loading the dev build once; add the production ID as a second redirect URI later).
3. Note the client ID — it is used by both packages. No client secret is needed (implicit ID-token flow).

### 2. Extension env (`extension/.env.local`)

```
WXT_AZURE_FUNCTION_URL=http://localhost:7071/api/analyze-job
WXT_AZURE_FUNCTION_KEY=
WXT_API_BASE_URL=http://localhost:7071/api
WXT_GOOGLE_OAUTH_CLIENT_ID=<client-id>.apps.googleusercontent.com
```

### 3. Functions env (`functions/local.settings.json`)

```json
{
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "GOOGLE_OAUTH_CLIENT_ID": "<client-id>.apps.googleusercontent.com"
  }
}
```

(keep the existing `AZURE_OPENAI_*` values; `TABLES_CONNECTION_STRING` is only needed if tables should live somewhere other than `AzureWebJobsStorage`)

### 4. Local Table Storage (Azurite)

```bash
cd functions
npm run azurite        # new script; starts the table emulator on :10002
```

### 5. Allowlist yourself

```bash
cd functions
npm run allowed-users -- add you@gmail.com
npm run allowed-users -- list
```

(uses `TABLES_CONNECTION_STRING`/`AzureWebJobsStorage` from env, or pass `--connection-string`)

## Run

```bash
cd functions && npm start          # Functions host on :7071
cd extension && npm run dev        # WXT dev build → load output/ in chrome://extensions
```

Open the side panel → sign-in gate → **Sign in with Google** → analyze/save as before; data now lands in Azurite tables.

## Verify the feature

1. **Gate**: open panel + options page signed out → sign-in prompt only; no analyze/save/profile UI.
2. **403 path**: `npm run allowed-users -- remove you@gmail.com`, trigger any action → invitation message; `add` back → next action works (no rebuild, no redeploy).
3. **Cross-device**: sign in from a second Chrome profile → same data.
4. **Migration**: on a profile with pre-002 local data, first sign-in offers migration; accept → rows appear in `SavedJobs`/`Profiles`; decline → offer never returns (check `migration:v2` key).
5. **Isolation**: sign in with a second allowlisted account → empty library.

## Production deployment checklist

- Function App settings: add `GOOGLE_OAUTH_CLIENT_ID` (portal → Environment variables). Tables are auto-created on first use in the existing storage account.
- OAuth client: add the published extension ID's `chromiumapp.org` redirect URI.
- Seed `AllowedUsers` with the CLI pointed at the production connection string.
- Extension release: `.env`/CI gains `WXT_API_BASE_URL` + `WXT_GOOGLE_OAUTH_CLIENT_ID`; manifest gains the `identity` permission (release notes must call this out).

## Tests

```bash
cd functions && npm test           # unit; integration tests start/expect Azurite
cd extension && npm test           # unit + msw contract tests
cd extension && npm run e2e        # Playwright, auth stub build
```
