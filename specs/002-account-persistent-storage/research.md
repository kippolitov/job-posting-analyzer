# Phase 0 Research: Account-Backed Persistent Storage

Decisions resolving the unknowns in the technical direction. Each entry: Decision → Rationale → Alternatives considered.

## R1 — Token acquisition: `launchWebAuthFlow` (OIDC ID token), not `getAuthToken`

**Problem**: The technical direction says "use `chrome.identity.getAuthToken()` to obtain a Google ID token" and verify it against Google's JWKS with `aud`/`iss`/`exp` checks. These two halves are incompatible as stated: `getAuthToken()` returns an **OAuth 2.0 access token**, never an ID token. Access tokens are opaque strings — they cannot be verified against JWKS; they can only be introspected by calling Google's `tokeninfo` endpoint per request (or cached).

**Decision**: Keep the middleware design verbatim (JWKS signature verification, `aud`/`iss`/`exp` validation — it is the security architecture of the feature) and acquire a real **Google ID token** client-side with `chrome.identity.launchWebAuthFlow()` running an OIDC implicit flow (`response_type=id_token`, `nonce`, scope `openid email`), exactly as ytsummary's `authClient.ts` does (clarification 2026-07-07: mimic `kippolitov/ytsummary` 008-auth-saved-history throughout). Silent renewal uses `launchWebAuthFlow({ interactive: false })`; when silent renewal fails (Google session gone), the UI returns to the sign-in gate per FR-014.

- OAuth client type: **Web application**, redirect URI `chrome.identity.getRedirectURL()` (the `https://<extension-id>.chromiumapp.org/` pattern).
- The client ID is compiled into both the extension (`WXT_GOOGLE_OAUTH_CLIENT_ID`) and the Function App (`GOOGLE_OAUTH_CLIENT_ID`, used as the expected `aud`).
- **Token persistence (clarified, FR-014a)**: token + decoded `exp` live in `chrome.storage.local` (not `.session`) so the session survives browser restarts; silent renewal keeps it alive up to ~30 days from interactive sign-in, mirroring ytsummary.
- Server verification: Google's official **`google-auth-library`** — `OAuth2Client.verifyIdToken({ idToken, audience })` fetches and caches Google's JWKS in-process and validates signature, `aud`, `iss`, and `exp` in one call, returning `sub`/`email`/`email_verified`. A `GOOGLE_OAUTH_CERTS_URL` env override lets integration tests point verification at a locally served stub JWKS (ytsummary's test seam). `email_verified` must be `true`; failures map to 403 per the auth contract.

**Rationale**: Verification is offline and stateless (no per-request Google call), exactly matching the described middleware; `sub`/`email` arrive as signed claims; the extension still uses the `chrome.identity` API — only the method differs. Every choice here is production-proven in ytsummary, so both repos share one auth architecture and one mental model.

**Alternatives considered**:
- **`getAuthToken()` + server-side `tokeninfo` introspection**: honors the named client API, but verification becomes a network dependency on Google per request (or a token-hash cache with its own invalidation semantics), `iss` is not checkable, and there is no signature to verify — a materially weaker and slower realization of the stated middleware. Rejected.
- **`getAuthToken()` + trust client-supplied email**: never acceptable; the server must derive identity from a verifiable credential (spec FR-003).

## R2 — Table Storage access: `@azure/data-tables` against the existing storage account

**Decision**: Use the official `@azure/data-tables` SDK, connecting with the Function App's existing `AzureWebJobsStorage` connection string (same storage account already provisioned — no new Azure resources). An optional `TABLES_CONNECTION_STRING` override exists solely so tests and local dev can point at Azurite (`UseDevelopmentStorage=true`). Tables are created lazily on first use (`createTable` if-not-exists at client init).

**Rationale**: Zero new infrastructure; connection string is already present in every deployed environment; SDK is the maintained first-party client with typed entities and ETag support.

**Alternatives**: raw REST against the Tables endpoint (needless hand-rolled auth signing); Cosmos DB Table API (new resource — explicitly excluded by the directive).

## R3 — Table layout and keys

**Decision**: Three tables in the one storage account:

| Table | PartitionKey | RowKey | Purpose |
|---|---|---|---|
| `AllowedUsers` | `"AllowedUser"` (single partition; ytsummary's constant) | lowercased email | developer-managed allowlist |
| `Profiles` | Google `sub` | `"profile"` (one row per user) | candidate profile |
| `SavedJobs` | Google `sub` | SHA-256 hex of canonical URL | saved postings |

- **Allowlist keyed by email**: the developer knows invitees' emails, not their `sub`s; the middleware matches the token's verified `email` claim (lowercased). A single partition is fine at invited-users scale and makes `list` trivial for the CLI. A `sub` column is populated (Merge update) on the account's first successful sign-in — ytsummary's `recordSignIn` pattern — giving the developer the email→sub mapping for support/debugging.
- **Data keyed by `sub`**: `sub` is Google's stable, never-reassigned account identifier (emails can change); partitioning by `sub` makes per-user isolation structural — every query the endpoints issue is scoped to `PartitionKey = sub` derived from the verified token, so cross-user reads are impossible by construction (spec FR-006).
- **Job RowKey = SHA-256(canonicalUrl)**, computed **server-side** from the `canonicalUrl` field in the request body. The client already uses the same digest (`canonicalKey()` in `extension/lib/canonicalUrl.ts`), so client-side keys and server-side keys agree; the server recomputing it means a malicious client cannot plant mismatched keys. Canonicalization itself stays client-side (unchanged from 001).

**Entity size check**: Table Storage limits — 1 MB/entity, 64 KB per string property. A `SavedJob`'s `JobAnalysis` snapshot serializes to well under 8 KB; `notes` gets an explicit 10,000-char cap (client + server) to stay clear of the property limit. The profile is already capped at 4,000 chars. No property-splitting needed.

## R4 — Auth middleware shape (Azure Functions v4 has no middleware pipeline)

**Decision**: A higher-order wrapper `withAuth(handler)` in `functions/src/services/auth.ts` (ytsummary's location — cross-cutting services live in `services/`). It: (1) extracts `Authorization: Bearer <idToken>`; (2) verifies signature/`aud`/`iss`/`exp` via `google-auth-library` (JWKS cached in-process); (3) checks `email_verified` (false → 403, matching ytsummary); (4) point-reads `AllowedUsers` for the token's email; (5) records the account's `sub` on first sign-in; (6) on success invokes the wrapped handler with an `AuthedUser { sub, email }` argument; on failure returns `401 UNAUTHENTICATED` (missing/invalid/expired token) or `403 NOT_AUTHORIZED` (unverified email, or valid token not on the allowlist) **before any handler logic runs** — for `analyze-job`, that is before any OpenAI call.

**Allowlist lookup is a per-request point read, no cache.** A single-entity point read on Table Storage is single-digit milliseconds; caching would violate SC-006 (revocation effective no later than the next request). JWKS caching is safe (public keys, `google-auth-library` handles fetching and rotation).

**Alternatives**: in-memory allowlist cache with TTL (rejected — revocation latency); Azure API Management / Easy Auth in front of the Function App (rejected — new Azure configuration surface, and Easy Auth's Google provider does not do table-driven allowlisting).

## R5 — Keep function-key auth and the manual-CORS pattern on all endpoints

**Decision**: New endpoints use `authLevel: "function"` plus an `authLevel: "anonymous"` OPTIONS preflight twin, exactly like `analyze-job` today. The Google ID token rides in the `Authorization` header on top of the function key. `Access-Control-Allow-Headers` gains `Authorization`. The Bearer token is added to `analyze-job`'s allowed headers too.

**Rationale**: Defense in depth at zero cost — the key is already embedded at build time and the release process doesn't change; the middleware is the real gate. Consistency with the existing endpoint keeps the codebase single-pattern (Constitution I).

## R6 — Client repository swap: same interfaces, fetch-backed implementations

**Decision**: `JobRepository` and the profile functions keep their exact signatures. New `extension/services/api/` module provides an authenticated `fetch` helper (attaches function key + `Authorization` header, maps 401/403/409 to typed errors). `jobStorage.ts` and `profileStorage.ts` swap their bodies from `chrome.storage.local` calls to endpoint calls; `LibraryFullError` is now thrown on the server's `409 LIBRARY_FULL`. UI code above the repository does not change shape (the directive's constraint). The analysis cache (`jobAnalysisCache`, `storage.session`) stays device-local — it is a performance cache, not user data.

**Interface parity note**: `pruneArchived(count)` and `clearProfile()` exist in the current interfaces, so the API must cover them (`POST /api/jobs/prune`, `DELETE /api/profile`) even though the directive's endpoint list didn't name them.

## R7 — One-time migration mechanics

**Decision**: Client-side orchestration in a new `migrationService`:

- **Trigger**: after first successful authorized sign-in on a device, if `chrome.storage.local` still contains `profile` or `job:*` keys and no `migration:v2` marker exists → show the migration prompt (blocking card in the panel, Accept / Decline).
- **Accept**: upload profile (if the server already has one that differs, ask the user which to keep — explicit choice per FR-011); bulk-save jobs via `PUT /api/jobs/{key}` — server-side existing entries win, skipped duplicates are counted and reported in the completion summary. Cap overflow surfaces the standard prune/export prompt. On full success: write `migration:v2 = { status: "completed", at }` and **delete** legacy `profile`/`job:*` keys (server is now the source of truth; stale local copies would only mislead).
- **Decline**: write `migration:v2 = { status: "declined", at }`, leave local data untouched, never re-offer on this device.
- **Failure**: no marker written, local data untouched, retry available (FR-011 losslessness). Uploads are idempotent PUTs, so a partial retry converges.

**Alternatives**: server-side bulk-import endpoint (rejected — a loop of idempotent PUTs at ≤1,000 records is simple, resumable, and reuses the contract; a special endpoint is more surface to secure and test).

## R8 — Developer allowlist CLI

**Decision**: `functions/scripts/manage-allowed-users.ts` (ytsummary's name) run via `npx tsx` with an `npm run allowed-users -- add|remove|list` alias: `add <email>`, `remove <email>`, `list`. Connection string from `TABLES_CONNECTION_STRING` / `AzureWebJobsStorage` env or `--connection-string`. It ships in `scripts/`, which is not part of the deployed package — not an endpoint, no HTTP surface (per directive). Changes are effective on the user's next request because the middleware reads the table per request (R4) — no build, no deploy (SC-005).

## R9 — Testing real-stub strategy (Constitution II: no hollow mocks)

**Decision**:
- **Table Storage**: integration tests run against **Azurite** (official emulator, devDependency + npm script); the storage service is exercised against the real wire protocol.
- **Google tokens**: tests generate an RSA keypair once, serve its certs from a local stub, and point `google-auth-library` at it via the `GOOGLE_OAUTH_CERTS_URL` env override (ytsummary's test seam); test JWTs are really signed with controllable `aud`/`iss`/`exp`/`email` — expired/foreign-audience/unsigned cases are actual cryptographic failures, not mock returns.
- **Extension**: repository contract tests hit msw-served endpoint fixtures (same pattern as `jobAnalysisClient` tests today). The Playwright P1 journey covers the sign-in gate UI with a **dev-build auth stub** (test-only token provider injected via WXT env), because driving real Google OAuth in CI is not feasible — recorded in Complexity Tracking as the one gate exception, mirroring 001's eval exception.

## R10 — What "every feature" means in this repo

Repo scan: the extension's user surfaces are the side panel (JobPanel: analyze/this-page/saved) and the options page (profile editor). There is no YouTube/chat surface in this codebase (the 001 plan's references to an existing video flow do not correspond to code in this repo). The auth gate therefore wraps: side-panel root, options-page root, and the background analyze flow (which also carries the token server-side). Spec assumption about YouTube/chat features is vacuously satisfied.
