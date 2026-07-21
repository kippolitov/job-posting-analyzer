# Contract: Web Authentication & Backend Auth Delta

The web app authenticates with the **same** Google identity the backend already verifies. The entire backend change is (1) widening the accepted token audience to a set and (2) a CORS origin allowlist. `withAuth`'s signature / `iss` / `exp` / `email_verified` logic is unchanged.

## Client side (`web/`, GIS)

- Sign-in uses **Google Identity Services** (`google.accounts.id`) with the new **web OAuth client ID**. GIS returns a Google **ID token** (JWT) — the same token type the backend verifies (not an access token).
- The ID token is sent as `Authorization: Bearer <idToken>` on every API call.
- **Token storage**: in memory only. Never `localStorage`/`sessionStorage`/cookies (research R2).
- **Session continuity**: ~1 h token; ~1 min before `exp`, attempt silent re-issue via GIS `auto_select`; on failure, show the sign-in prompt (One Tap / button). No refresh token stored.
- **Signed-out**: the public landing route renders with no API calls; no account data is fetched or reachable until a token exists.
- **401/403 handling**: a `401 UNAUTHENTICATED` (expired/invalid) triggers one silent re-auth then retry; a `403 NOT_AUTHORIZED` (unverified email / blocked) shows the server's plain-language message and returns the user to signed-out state.

## Server side — change 1: audience set

`services/auth.ts` today:

```ts
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;         // single
await oauthClient.verifySignedJwtWithCertsAsync(idToken, certs, [clientId], GOOGLE_ISSUERS);
```

becomes:

```ts
// GOOGLE_OAUTH_CLIENT_IDS: comma-separated; falls back to the single GOOGLE_OAUTH_CLIENT_ID.
const clientIds = parseClientIds(process.env.GOOGLE_OAUTH_CLIENT_IDS ?? process.env.GOOGLE_OAUTH_CLIENT_ID);
await oauthClient.verifySignedJwtWithCertsAsync(idToken, certs, clientIds, GOOGLE_ISSUERS);
```

- `verifySignedJwtWithCertsAsync` already accepts an **array** of audiences → a token minted for **either** the extension client ID **or** the web client ID verifies. Missing config → the existing "not configured" error.
- **No other verification change**: signature (JWKS), `iss` ∈ Google issuers, `exp`, and `email_verified === true` are byte-for-byte as shipped. Same `Users` point-read and auto-create on first sign-in — so a user who first appears via the web is created identically to one from the extension (single account, FR-003/FR-004).

## Server side — change 2: CORS origin allowlist

- Current handlers emit `Access-Control-Allow-Origin: *` with **no** `Access-Control-Allow-Credentials` — safe today because the API uses Bearer tokens, not cookies.
- Add `ALLOWED_ORIGINS` (comma-separated, e.g. the Pages origin) consumed in the shared `services/http.ts` CORS helper:
  - request `Origin` ∈ allowlist → echo that origin in `Access-Control-Allow-Origin` and add `Vary: Origin`.
  - no `Origin` (extension, server-to-server) or unmatched → preserve current behavior so the extension keeps working.
- Applies uniformly (shared helper) including the `analyze-document` preflight and response.

## What does NOT change

- No new auth endpoint, no server session, no refresh-token handling, no cookie.
- Metering, jobs, profile, account, billing, and paddle-webhook auth all continue through the same `withAuth`.

## Acceptance

- A valid **web-client** ID token is accepted; a valid **extension-client** ID token is still accepted; a token for an unknown client ID is `401`.
- An unverified-email Google account is `403 NOT_AUTHORIZED` with the existing verify-your-email message (FR-001, spec US1 scenario 5).
- A browser request from the Pages origin receives that origin echoed in `Access-Control-Allow-Origin`; the extension (no browser `Origin`) is unaffected.
