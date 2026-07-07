# Contract: Authentication & Authorization

Applies to **every** HTTP-triggered function: `analyze-job` (existing) and all endpoints in [storage-api.md](./storage-api.md). Implemented once as `withAuth(handler)` in `functions/src/services/auth.ts` (mirrors ytsummary's `withAuth`).

## Request requirements

| Element | Requirement |
|---|---|
| Function key | Unchanged: `?code=` query param or `x-functions-key` header (`authLevel: "function"`) |
| `Authorization` header | `Bearer <Google ID token>` — an OIDC ID token (JWT) issued by Google for this app's OAuth client |

## Token validation (in order, all offline after JWKS cache warm)

Steps 1–4 are one `google-auth-library` call: `OAuth2Client.verifyIdToken({ idToken, audience })` (JWKS fetched and cached in-process; `GOOGLE_OAUTH_CERTS_URL` env override points it at a stub in integration tests).

1. **Signature**: RS256 against Google's published JWKS.
2. **`iss`**: must be `https://accounts.google.com` or `accounts.google.com`.
3. **`aud`**: must equal the app's OAuth client ID (`GOOGLE_OAUTH_CLIENT_ID` app setting).
4. **`exp`**: enforced by `verifyIdToken`.

Any failure in 1–4, or a missing/malformed header → **401**. No allowlist read, no handler execution, no OpenAI call.

5. **`email_verified`**: must be `true` — `false` → **403** (ytsummary convention: the token is authentic, but the account is not authorizable).

## Authorization

6. Point-read `AllowedUsers` table: `PartitionKey = "AllowedUser"`, `RowKey = lowercase(email claim)`. Uncached — a removed row takes effect on the very next request.
7. Row absent → **403**. Row present → record the account's `sub` on the row if not yet set (Merge update, first sign-in only), then invoke handler with `AuthedUser { sub, email }`.

## Error responses

Same envelope as existing endpoints: `{ "error": { "code", "message" } }`.

| Status | `code` | When | Client behavior |
|---|---|---|---|
| 401 | `UNAUTHENTICATED` | Missing/malformed header, bad signature, wrong `iss`/`aud`, expired | Attempt silent token renewal once; on failure show the sign-in gate |
| 403 | `NOT_AUTHORIZED` | Valid token but `email_verified` false, or email not in `AllowedUsers` | Show the invitation message (access is by invitation + how to request it); end the session |

401/403 bodies MUST NOT reveal whether an email exists on the allowlist beyond the status distinction itself.

## Client-side token acquisition (extension)

- `chrome.identity.launchWebAuthFlow` OIDC implicit flow: `response_type=id_token`, `scope=openid email`, fresh `nonce` per request (verified against the returned token), `redirect_uri = chrome.identity.getRedirectURL()`.
- Interactive on explicit sign-in; `interactive: false` for silent renewal when the cached token is near or past `exp`, or a request returns 401.
- Token + decoded expiry cached in `storage.local` (`auth:*` keys) so the session survives browser restarts, up to ~30 days via silent renewal (FR-014a). Sign-out clears the cache and returns to the gate.
- **Note**: `chrome.identity.getAuthToken()` was named in the technical direction but returns an access token, which cannot satisfy this contract's JWKS verification; see research.md R1 for the reconciliation.

## CORS

Each endpoint keeps the existing pattern: `authLevel: "anonymous"` OPTIONS twin + manual headers. `Access-Control-Allow-Headers` = `Content-Type, x-functions-key, Authorization`.
