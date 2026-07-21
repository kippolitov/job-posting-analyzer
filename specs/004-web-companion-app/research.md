# Research: Companion Web Application

Phase 0 decisions for `004-web-companion-app`. Each item resolves an open question from the plan input; format is Decision / Rationale / Alternatives considered.

## R1 — SPA routing on GitHub Pages: hash vs 404.html fallback

**Decision**: **Hash-based routing** (`HashRouter`), app served under `/app/` with Vite `base: "/app/"`.

**Rationale**: GitHub Pages serves static files and cannot rewrite unknown paths to `index.html`. The Pages site is **shared** — it already hosts the coverage report, `docs/pages/index.html`, `checkout.html`, and `docs/legal/*`. A root `404.html` SPA-fallback trick would hijack *every* unknown path on the whole domain (including deep coverage-report links) and redirect them into the app — an unacceptable side effect on a shared origin. Hash routing keeps all app state after the `#`, fully self-contained under `/app/`, with zero interaction with the rest of the site and no server config.

**Alternatives considered**:
- *404.html redirect fallback* — rejected: pollutes the shared Pages origin's 404 handling; brittle with the coverage site.
- *Separate Pages site / custom domain for the app* — rejected: new infra/config, contradicts the zero-new-resources posture; `/app/` on the existing site is sufficient.

## R2 — GIS session story: silent re-auth vs prompt; token lifetime

**Decision**: ID token held **in memory only** (never `localStorage`/`sessionStorage`). On load and ~1 min before the ~1 h expiry, attempt **silent re-issue via GIS with `auto_select`** (the user's live Google session re-mints an ID token without interaction). If silent re-issue fails (no Google session, consent revoked), fall back to the GIS button / One Tap **prompt**. No refresh token is stored.

**Rationale**: GIS issues short-lived (~1 h) ID tokens and deliberately provides no long-lived refresh token in the browser. Silent auto-select gives a "stays signed in as long as you're signed into Google" feel that approximates the extension's ~30-day silent-renewal experience *in practice* (a browser signed into Google renews seamlessly), while keeping tokens out of persistent storage removes the XSS token-exfiltration surface. The backend already treats each request statelessly (verifies the Bearer token per call), so nothing server-side changes.

**Note on parity**: This is *not* a literal 30-day session — it is bounded by the Google browser session, not a stored horizon. That is the honest, safe tradeoff for a web origin; the extension's `chrome.identity` + `chrome.storage.local` model (which enables true 30-day silent renewal) is not available to a plain web page. Documented so no one expects a stored long-lived session.

**Alternatives considered**:
- *Persist the token in localStorage for longer sessions* — rejected: XSS exfiltration risk; explicitly ruled out by the plan input.
- *Always prompt on expiry* — rejected: worse UX than silent auto-select when a Google session exists.
- *Roll our own OAuth code flow with a backend token exchange* — rejected: requires backend session/refresh handling and new endpoints; contradicts "the aud set + CORS is the entire backend auth delta."

## R3 — Backend auth delta: aud set + CORS allowlist

**Decision**: Two changes only.
1. **aud set**: introduce `GOOGLE_OAUTH_CLIENT_IDS` (comma-separated; falls back to the existing `GOOGLE_OAUTH_CLIENT_ID`) and pass the parsed array as the audience list to `verifySignedJwtWithCertsAsync(...)`. The extension's client ID and the new web OAuth client ID are both accepted. Signature / `iss` / `exp` / `email_verified` logic is **untouched**.
2. **CORS allowlist**: add `ALLOWED_ORIGINS` (comma-separated) consumed in `services/http.ts`. When the request `Origin` matches, echo it in `Access-Control-Allow-Origin` (plus `Vary: Origin`); otherwise keep the current permissive behavior for the extension / no-Origin callers.

**Rationale**: `verifySignedJwtWithCertsAsync` already takes an **array** of accepted audiences (`[clientId]` today), so widening to a set is a one-line change with no crypto impact — exactly the "change the aud check to accept a set of client IDs" the plan calls for. On CORS: the handlers **currently return `Access-Control-Allow-Origin: *`**, which already works for the web app because the API uses **Bearer tokens, not cookies** (no `Access-Control-Allow-Credentials`), so `*` carries no CSRF risk. The allowlist is therefore a least-privilege hardening rather than a functional unblock: it lets us scope browser access to the known Pages origin while leaving the extension (which sends no `Origin` or an extension origin) working. This keeps the "aud set + CORS = entire backend auth delta" promise literally true.

**Alternatives considered**:
- *Keep `*` and change nothing for CORS* — viable functionally (bearer tokens), but the plan explicitly asks for a Pages-origin allowlist; we honor it as hardening.
- *Per-endpoint CORS config* — rejected: centralizing in `http.ts` (already the shared CORS helper) is DRY and matches existing structure.

## R4 — PDF text-extraction library: pdf-parse vs unpdf vs pdfjs-dist

**Decision**: **`unpdf`** for `.pdf` text extraction (with `mammoth` for `.docx`).

**Rationale**: Evaluated against the three stated criteria:
- *Node 20 / Azure Functions compatibility*: `unpdf` ships a serverless-optimized, pre-patched build of pdf.js with **no native modules and no DOM/worker requirement** — it runs cleanly in the Functions Node 20 sandbox. `pdf-parse` also runs but wraps an old pdf.js and shells through a debug-mode file read that has surprised many serverless users. `pdfjs-dist` runs but needs the `legacy` build and careful worker disabling.
- *Bundle size*: `unpdf` is purpose-built to be small for serverless; full `pdfjs-dist` is the heaviest.
- *Encrypted / image-only detection*: the underlying pdf.js throws a `PasswordException` for password-protected PDFs (→ our "password-protected" rejection), and yields **empty/whitespace-only text** for image-only scans (→ our "no extractable text" rejection). `unpdf` surfaces both (the throw propagates; empty text is observable) so we can reject **before** metering.

**Alternatives considered**:
- *`pdfjs-dist` directly* — rejected as default: maximal control but largest bundle and more setup (worker, legacy build); kept as the fallback if `unpdf` ever hides a needed pdf.js signal.
- *`pdf-parse`* — rejected: unmaintained-ish, wraps old pdf.js, awkward serverless file-read behavior, weakest control over the password/image-only signals.

## R5 — Document dedupe key: content-hash vs always-unique

**Decision**: Row key for document-sourced saved jobs = **`sha256(extracted-text)`** (a content hash), namespaced to avoid collision with URL keys.

**Rationale**: URL-sourced rows key on `sha256(canonicalUrl)` so re-saving the same posting is idempotent (last-write-wins, no duplicate). Documents have no canonical URL, but the **extracted text is a stable content identity**: hashing it reproduces the same URL-like idempotency — re-uploading and re-saving the same document overwrites its existing entry instead of spawning a duplicate, and the client can compute the key the same way it computes `canonicalKey()` today. The hash is filename-independent (renaming the file doesn't fork the entry), which matches user intent ("same document" = same content). `analyze-document` returns the computed `saveKey` so the client PUTs to `/api/jobs/{saveKey}`, and the server recomputes/verifies it exactly as it verifies `sha256(canonicalUrl)` today.

**Alternatives considered**:
- *Always-unique key (e.g., random UUID per save)* — rejected: every save of the same document creates a new library row, silently inflating the library toward the cap with duplicates; breaks the existing "save is idempotent per identity" contract.
- *Hash of filename* — rejected: two different documents sharing a filename would collide; renaming would fork.

## R6 — New runtime dependencies (exception to zero-new-deps posture)

**Decision**: Add exactly **two** runtime dependencies to `functions/`: `mammoth` (.docx → text) and `unpdf` (.pdf → text). No new dependency for file-type sniffing (manual magic-byte check) or multipart parsing (native `request.formData()` via undici in the Functions Node 20 runtime).

**Rationale**: 003 established a zero-new-runtime-deps posture for cost/security/bundle discipline. Server-side text extraction is genuinely new work that cannot reuse an existing dependency, and doing extraction **server-side** is deliberate — it keeps validation and the extension-shared JSON contract in one place (the client never parses documents). Two well-scoped, widely-used, pure-JS libraries are the minimum to support `.docx` and `.pdf`. This is documented here as the explicit, bounded exception; both are dev-audited and isolated to their own dependency-bump PR per the constitution's dependency-upgrade rule.

**Alternatives considered**:
- *Client-side extraction (in `web/`)* — rejected: forks validation/contract across surfaces, ships heavy parsers to every browser, and lets a client submit arbitrary "extracted" text bypassing server validation.
- *A single all-in-one office parser* — rejected: larger surface than two focused libraries; `.docx` and `.pdf` have cleanly separate best-in-class extractors.
- *`file-type` package for sniffing* — rejected: a third new dep for what is a 4-byte magic-number check (PDF `25 50 44 46`, DOCX/zip `50 4B 03 04`); done inline.

## R7 — Metering ordering for document analysis (reject-before-increment)

**Decision**: `analyze-document` does **not** use the existing `withUsageMetering` wrapper (which increments *before* the handler). Instead the handler runs, in order: (1) size-cap + magic-byte sniff, (2) text extraction with encrypted / image-only / corrupt detection, (3) **only on success**, call `checkAndIncrement(sub, tier)` inline, (4) run `orchestrateJobAnalysis` on the extracted text, (5) `refundOnSystemFailure` if the orchestrator returns ≥ 500. All rejections in steps 1–2 return before any increment.

**Rationale**: The spec requires that unreadable / password-protected / image-only / wrong-type / oversized files are rejected **before any allowance is consumed** (FR-020, SC-005). The shared `withUsageMetering` intentionally increments first (fail-closed for the URL path, where the request body *is* the already-validated input). Document validation is expensive and must gate the increment, so the ordering is inverted for this endpoint while **reusing `meteringService` unchanged** — the atomic ETag check-and-increment (SC-006 parallel-race guarantee) and the best-effort refund are called directly. This preserves the "never exceed the cap under parallel requests" property because `checkAndIncrement` itself is the atomic primitive, regardless of what runs before it.

**Alternatives considered**:
- *Reuse `withUsageMetering` and refund on validation failure* — rejected: a validation rejection would momentarily consume then refund allowance, violating "before any allowance is consumed," and a lost refund (best-effort) would wrongly charge a rejected file.

## R8 — Reusing the analyze orchestrator for document text (synthetic extract + profile)

**Decision**: Build a synthetic `AnalyzeJobRequest` from the extracted document text: `extract = { url: "", canonicalUrl: "", title: <filename>, jsonLd: [], mainText: <extractedText capped at MAIN_TEXT_CAP (40,000)>, extractedAt: now }`, `profile = <client-supplied profile text>`, and call `orchestrateJobAnalysis(req, tier, warn)` unchanged. The client supplies the profile in the multipart form, exactly as the extension supplies it in the `analyze-job` body.

**Rationale**: The orchestrator only reads `extract.title`, `extract.jsonLd`, `extract.mainText`, and `profile` to build the model prompt, and it already enforces the strict JSON-schema response and tier-aware deployment selection. Feeding document text through the same function guarantees the **identical output shape and fit scoring** the spec demands (FR-018, SC-004), with the source relabeled to the document downstream. Capping at the existing `MAIN_TEXT_CAP` reuses the established large-input guard. Keeping profile client-supplied matches the existing `analyze-job` contract (no new server-side profile coupling on the analyze path).

**Alternatives considered**:
- *Server fetches the profile from `profileRepository` inside the endpoint* — rejected: diverges from the established analyze contract where the client owns profile passing; adds a storage read to the hot path. (Client already holds the profile it fetched for display.)
- *A separate document-specific orchestrator/prompt* — rejected: would risk output-shape drift from the page path, breaking the "identical shape and fit scoring" guarantee.

## Open items / deferred

- **Exact GIS package vs script tag**: GIS is loaded from Google's script (not bundled); the thin TS wrapper lives in `web/src/auth/`. Finalized during implementation; does not affect the contract.
- **Compare view count**: "several postings side by side" — a small fixed max (e.g., 2–4) chosen during UI build for mobile-through-desktop legibility; not contract-affecting.
