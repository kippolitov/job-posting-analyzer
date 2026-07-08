# Feature Specification: Account-Backed Persistent Storage

**Feature Branch**: `002-account-persistent-storage`

**Created**: 2026-07-07

**Status**: Draft

**Input**: User description: "Add account-backed persistent storage to replace the current device-local storage (chrome.storage.local) for the candidate profile and saved job postings. Users must sign in with their Google account before using any feature of the extension — analyzing a posting, viewing/saving results, or editing the candidate profile all require an authenticated session. Only Google accounts the developer has explicitly authorized may use the extension; an unauthenticated or non-authorized user attempting to sign in sees a clear message that access is by invitation and how to request it, and is not able to reach any analysis feature. Once signed in with an authorized account, the user's candidate profile and saved job postings persist on the server, are scoped strictly to that user (no user can ever see another user's profile or postings), and are available across any device/browser where they sign in with the same account — not tied to a single Chrome installation the way today's local storage is. On first sign-in, if the user has existing data in local storage from before this change, that data should be offered for one-time migration into the new persistent store rather than silently lost. The developer needs a way to add or remove authorized users without publishing a new extension build or redeploying the backend. Existing behavior for saved-job limits (soft cap, export, archive/prune) should carry over unchanged, just backed by server-side storage instead of local storage."

## Clarifications

### Session 2026-07-07

- Q: How long should a signed-in session last on a device before the user must interactively sign in again? → A: ~30 days, survives browser restarts (silent renewal; mimics ytsummary FR-006a)
- Q: Adopt ytsummary's implementation conventions where 002's plan differed (google-auth-library verification, AllowedUsers schema with sub recorded on first sign-in, services/auth.ts middleware location, manage-allowed-users.ts CLI, 403 for unverified email)? → A: Adopt all five verbatim

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Invitation-Gated Google Sign-In (Priority: P1)

A person opens the extension. Before they can analyze a posting, view or save results, or edit their candidate profile, they must sign in with their Google account. If their account is on the developer's authorized list, they get a working session and reach all features. If they are not signed in, or they sign in with a non-authorized account, every feature entry point is replaced by a clear message that access is by invitation, including how to request access — and no analysis, saving, or profile editing is reachable.

**Why this priority**: This is the access-control foundation. Every other story (server persistence, migration, allowlist management) presupposes an authenticated, authorized identity to scope data to. It is also the only story that changes behavior for people who should *not* have access, which is the stated intent of the feature.

**Independent Test**: Can be fully tested with no server-side storage at all — sign in with an authorized account and confirm features unlock; sign in with a non-authorized account and confirm the invitation message appears and no feature is reachable; while signed out confirm the same gate applies.

**Acceptance Scenarios**:

1. **Given** a signed-out user, **When** they open any extension surface (side panel, options page, or analysis trigger), **Then** they see a sign-in prompt instead of the feature, and no analysis, saved-postings view, or profile editor is reachable.
2. **Given** a user whose Google account is on the authorized list, **When** they complete Google sign-in, **Then** they land in the extension with all features available and their identity visibly associated with the session (e.g., account email shown, sign-out available).
3. **Given** a user whose Google account is NOT on the authorized list, **When** they complete Google sign-in, **Then** they see a message stating access is by invitation and how to request it, and they cannot reach any analysis, saving, or profile feature.
4. **Given** a signed-in authorized user, **When** they sign out, **Then** the session ends, locally displayed personal data is cleared from view, and the sign-in gate is restored.
5. **Given** a signed-in user whose authorization is revoked while their session is active, **When** they next perform an action that touches the server, **Then** the action is refused, the session is treated as unauthorized, and the invitation message is shown.

---

### User Story 2 - Server-Persisted, User-Scoped Profile and Saved Postings (Priority: P2)

A signed-in authorized user edits their candidate profile and saves analyzed job postings exactly as they do today — but the data now lives on the server, keyed to their account. Signing in on a different browser or machine presents the same profile and saved postings. No user can ever read or affect another user's data. Saved-job limit behavior (soft cap of 1,000, export as JSON, prune-oldest-archived prompt at cap) works as before, just against the server store.

**Why this priority**: This is the core value of the feature — data that survives browser reinstalls and follows the user across devices. It depends on Story 1 for identity but delivers the headline capability.

**Independent Test**: With Story 1 in place, sign in on browser A, edit the profile and save postings; sign in on browser B with the same account and confirm identical data; sign in with a *different* authorized account and confirm none of the first user's data is visible.

**Acceptance Scenarios**:

1. **Given** a signed-in authorized user, **When** they edit and save their candidate profile, **Then** the profile persists on the server and is returned intact on next sign-in from any browser or device.
2. **Given** a signed-in authorized user, **When** they save an analyzed posting, change its status, or edit its notes, **Then** the change persists server-side and is visible after signing in elsewhere with the same account.
3. **Given** two different authorized users, **When** each signs in, **Then** each sees only their own profile and saved postings; no request a user can make returns or modifies another user's data.
4. **Given** a user at the saved-postings soft cap (1,000), **When** they attempt to save another posting, **Then** they are prompted to prune the oldest `archived` entries or export first — the same behavior as the current local-storage flow.
5. **Given** a signed-in user with saved postings, **When** they trigger export, **Then** all their saved postings download as a single JSON file, matching the existing export behavior.
6. **Given** a temporary inability to reach the server (offline, server error), **When** the user attempts to view or change persisted data, **Then** the failure is surfaced clearly, no data is silently lost, and the operation can be retried once connectivity returns.

---

### User Story 3 - One-Time Migration of Existing Local Data (Priority: P3)

A user who used the extension before this change has a candidate profile and/or saved postings in device-local storage. On their first sign-in with an authorized account on that device, the extension detects the legacy local data and offers to migrate it into their server-backed store. If they accept, the data appears in their account; if they decline, they are told the data will not follow them and the offer is not repeated on that device. Either way, nothing is silently lost.

**Why this priority**: Only affects the existing install base at the moment of transition; new users and new devices never hit this path. Valuable, but the product is functional without it.

**Independent Test**: Seed a browser profile with pre-existing local-storage data, sign in for the first time with an authorized account, and verify the migration offer, the accept path (data present server-side, visible on a second device), and the decline path (offer not re-shown, local data untouched).

**Acceptance Scenarios**:

1. **Given** a device with pre-existing local profile and/or saved postings, **When** an authorized user completes their first sign-in on that device, **Then** they are offered a one-time migration of that data into their account before proceeding.
2. **Given** the migration offer, **When** the user accepts, **Then** the local profile and saved postings are copied into their server-backed store, a success confirmation is shown, and the migrated data is subsequently visible on any device they sign in from.
3. **Given** the migration offer, **When** the user declines, **Then** no data is uploaded, the user is informed the local data will not be available across devices, and the offer is not shown again on that device.
4. **Given** an accepted migration where the user's account already holds server-side data (e.g., they migrated from another device first), **When** the migration runs, **Then** the two data sets are combined without silently overwriting or duplicating postings (same canonical URL resolves to one entry), and the profile conflict is resolved with explicit user choice.
5. **Given** a migration that fails partway (e.g., connectivity loss), **When** the failure occurs, **Then** the local data remains intact, the user is informed, and the migration can be retried.
6. **Given** a device with no pre-existing local data, **When** a user signs in for the first time, **Then** no migration offer appears.

---

### User Story 4 - Developer Manages Authorized Users Without Redeploying (Priority: P4)

The developer adds or removes an authorized Google account through an administrative mechanism (not a code change). The change takes effect for sign-ins without publishing a new extension build or redeploying the backend: a newly added user can sign in and use the extension; a removed user loses access on their next server-touching action.

**Why this priority**: Operationally necessary for the invitation model to be practical, but the gate itself (Story 1) can initially ship with a manually seeded list.

**Independent Test**: Add a previously unauthorized account via the admin mechanism, confirm that account can now sign in and use features without any build/deploy; remove it and confirm access is refused on the next action.

**Acceptance Scenarios**:

1. **Given** an account not on the authorized list, **When** the developer adds it via the admin mechanism, **Then** that account's next sign-in attempt succeeds with no extension update or backend redeploy.
2. **Given** an authorized account, **When** the developer removes it, **Then** that account's next sign-in or server-touching action is refused and the invitation message is shown.
3. **Given** a removed account that previously stored data, **When** the removal happens, **Then** the stored data is retained server-side (not deleted by removal), and becomes accessible again if the account is re-authorized.

---

### Edge Cases

- **Session expiry mid-task**: an authenticated session expires while the user is composing profile edits or notes — the user is re-prompted to sign in and their in-progress input is not lost.
- **Authorization revoked mid-session**: handled per Story 1, scenario 5 — refusal on next server action, no partial access lingers.
- **Same account, two devices concurrently**: edits from two simultaneous sessions on the same account must not corrupt data; last write wins per record is acceptable, silent data corruption is not.
- **Migration source larger than the soft cap**: legacy local data with more postings than remaining server capacity — migration must apply the same cap behavior (prompt to prune/export) rather than silently dropping records.
- **Google sign-in succeeds but the identity cannot be verified server-side** (e.g., token validation failure): treated as not signed in, with a retryable error message — never as an authorized session.
- **Offline use**: with no server connectivity, no persisted data is readable or writable; the extension must say so plainly rather than showing empty states that look like data loss.
- **Sign-in with a second, different Google account on the same device**: the new session sees only the new account's data; nothing from the previous account's session remains visible.
- **Legacy local data on a device where migration was already completed or declined**: the one-time offer must not reappear, including after extension updates.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST require a signed-in, authorized session before any feature is usable — posting analysis, viewing or saving results, editing the candidate profile, and any other extension feature are all inaccessible while signed out or unauthorized.
- **FR-002**: The system MUST authenticate users exclusively via Google account sign-in.
- **FR-003**: The system MUST verify on the server, for every data-access or analysis request, that the request carries a valid authenticated identity that is on the authorized-user list; client-side checks alone MUST NOT be the enforcement boundary.
- **FR-004**: The system MUST show an unauthenticated user, or an authenticated user who is not on the authorized list, a clear message that access is by invitation and how to request access, and MUST NOT expose any analysis, saving, or profile capability to them.
- **FR-005**: The system MUST persist each user's candidate profile and saved job postings in server-side storage keyed to their account, replacing device-local storage as the system of record for this data.
- **FR-006**: The system MUST scope all persisted data strictly per user: no request, under any account, may return or modify another user's profile or postings.
- **FR-007**: A user signing in on any device or browser MUST see the same profile and saved postings as on any other device where they use the same account.
- **FR-008**: The system MUST carry over existing saved-job limit behavior unchanged against the server store: soft cap of 1,000 saved postings per user; at cap, a save prompts the user to prune the oldest `archived` entries or export first.
- **FR-009**: The system MUST preserve the existing export capability: all of the signed-in user's saved postings download as a single JSON file.
- **FR-010**: On an authorized user's first sign-in on a device holding pre-existing local-storage data (candidate profile and/or saved postings), the system MUST offer a one-time migration of that data into the user's server-backed store before it is otherwise discarded or ignored.
- **FR-011**: Migration MUST be lossless on failure (local data intact, retry possible), MUST merge without silent overwrites or duplicates when the account already has server-side data (postings deduplicated by canonical URL; profile conflicts resolved by explicit user choice), and MUST NOT re-offer after the user has completed or declined it on that device.
- **FR-012**: The developer MUST be able to add and remove authorized Google accounts through an administrative mechanism that requires neither publishing a new extension build nor redeploying the backend, with additions effective for the account's next sign-in and removals effective no later than the account's next server-touching action.
- **FR-013**: Removing an account from the authorized list MUST revoke access but MUST NOT delete that account's stored data; re-authorizing the account restores access to it.
- **FR-014**: Ending a session (sign-out or expiry) MUST remove the user's personal data from view on that device and restore the sign-in gate; expiry during data entry MUST NOT destroy the user's in-progress input.
- **FR-014a**: A signed-in session MUST persist across browser restarts on the same device, kept alive by silent (non-interactive) credential renewal, for up to approximately 30 days from the interactive sign-in; interactive re-sign-in is required only after that horizon or when silent renewal fails.
- **FR-015**: When the server is unreachable, the system MUST surface the failure explicitly, MUST NOT present empty states that misrepresent stored data as absent, and MUST NOT silently drop attempted writes.

### Key Entities

- **User Account**: An authorized identity, anchored to a Google account (stable account identifier plus email for display). Owns exactly one candidate profile and a collection of saved postings.
- **Authorized-User List**: The developer-managed set of Google accounts permitted to use the extension; editable at runtime without build or deploy; membership checked server-side on every request. Each entry records the account's stable identifier on that account's first successful sign-in.
- **Candidate Profile**: The existing profile entity (skills, seniority, domains, dealbreakers, etc.), now stored server-side and scoped to one user account.
- **Saved Job**: The existing saved-posting entity (canonical URL, source URL, analysis snapshot, status, notes, timestamps), now stored server-side, scoped to one user account, deduplicated per user by canonical URL, subject to the 1,000-record soft cap per user.
- **Migration Record**: Per-device marker of the one-time migration outcome (offered/accepted/declined) that prevents re-offering.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 extension features are reachable without an authenticated, authorized session — verified by exercising every entry point signed out and as a non-authorized account.
- **SC-002**: A user who signs in on a second browser or device sees 100% of the profile fields and saved postings they created on the first, with no manual steps beyond signing in.
- **SC-003**: No user can retrieve or modify another user's data: cross-account access attempts (including direct requests with a valid session for a different user) return zero records belonging to the other user.
- **SC-004**: An existing user with legacy local data who accepts migration retains 100% of their profile and saved postings in the new store; a user who declines loses nothing locally and is never re-prompted on that device.
- **SC-005**: The developer can grant or revoke a user's access in under 5 minutes end-to-end, with zero extension releases and zero backend deployments involved.
- **SC-006**: A revoked user's server-touching actions are refused no later than their next request after revocation.
- **SC-007**: Saved-job cap behavior matches the previous local-storage behavior exactly: the prompt to prune/export appears at the same threshold (1,000) with the same options.

## Assumptions

- "Any feature of the extension" is taken literally: the sign-in/authorization gate covers every extension surface — the side panel, the options page (profile editor), and the background-triggered posting analysis flow — and gated features' internal behavior is otherwise unchanged.
- Google sign-in is the only supported identity mechanism; there is no email/password or other provider, and no self-service sign-up — access is granted solely by the developer adding an account to the authorized list.
- The existing analysis backend is extended to host per-user storage and identity verification; this feature does not introduce a separate user-facing service.
- The analysis cache (LRU, 200 entries, 14 days, keyed by canonical URL) remains device-local and is not part of the server-side persistence scope; it is a performance cache, not user data.
- The expected user population is small (personal / invited users), so the authorized list is a simple developer-curated set; roles, teams, or self-service invitation flows are out of scope.
- The one-time migration marker is per device (a device that never signs in never migrates); migrating from multiple old devices is supported via the merge rules in FR-011.
- Removal from the authorized list is an access decision, not a data-deletion request; account data deletion (e.g., privacy requests) is handled out of band by the developer and is out of scope for this feature.
- Existing spec 001 behavior not touched by this feature (extraction, fit scoring, caching, panel UX) is unchanged.
