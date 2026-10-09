# Phase 3 — Outlook & Gmail Integration

Tracks the brief's 16 implementation stages (3A–3I) and its Section 16
final-report items against evidence actually gathered and work actually
done. Status values match Phase 2's doc: **VERIFIED COMPLETE**,
**IMPLEMENTED BUT NOT VERIFIED**, **REQUIRES MY ACTION**, **BLOCKED**,
**NOT IMPLEMENTED**. Per the brief's own final rule: do not mark anything
complete without evidence, and never claim a provider is connected merely
because the code compiles.

## Phase 3A — Audit the existing email architecture — VERIFIED COMPLETE

Inspected directly against the current `main` tip (not assumed):

- **Existing email-related modules**: `apps/api/src/modules/email`
  (`EmailService`) — nodemailer/SMTP, used only for the app's own
  transactional email (password reset). This is a single shared outbound
  mailbox the app itself owns, not a per-user authorized mailbox — **not
  reusable** for "send from the user's own connected account," which is
  what this phase needs.
- **Existing OAuth precedent — directly reusable as a template**:
  `apps/api/src/modules/workforce/calendar-integration` implements a
  complete, working Google OAuth connect/callback/status/disconnect
  cycle (`CalendarIntegrationService`, `GoogleCalendarClient`,
  `oauth-state.util.ts`). Raw HTTP via `HttpService`/axios against
  Google's token/API endpoints, no `googleapis` SDK — matches this
  codebase's existing preference for a thin client over a heavy vendor
  SDK (confirmed elsewhere: `apps/browser-extension`, the desktop agent).
  This is the shape Phase 3B generalizes and Phase 3C/3D's provider
  clients follow.
- **Existing encryption-at-rest — directly reusable, and the better
  precedent to follow**: `apps/api/src/common/crypto/credential-encryption.service.ts`
  (`CredentialEncryptionService`, AES-256-GCM), built for the BYO AI
  feature's `user_ai_connections` table. Its own header comment
  explicitly flags that Calendar integration's plaintext token columns
  are the thing *not* to copy forward. This phase's new
  `email_integrations` table uses this service, not Calendar's plaintext
  pattern.
- **Microsoft/Outlook/Graph — nothing exists.** Grepped the entire
  repository (case-insensitive) for `outlook`/`microsoft`/
  `graph.microsoft`/`msal` — no real matches (a handful of unrelated
  substring hits in generated files). This is a from-scratch build; no
  MSAL or Graph SDK is installed.
- **Authentication**: self-hosted JWT (`JwtAuthGuard`), confirmed in the
  Phase 2 review and re-confirmed here — the existing
  `signOAuthState`/`verifyOAuthState` HMAC pattern (signed with the same
  `jwt.accessSecret`, no new required secret) is what Phase 3B's state
  signing follows, generalized with a `provider` field.
- **User/org data models, project/record relationships**: `companies`,
  `users`, `projects`, `project_members` — unchanged by this phase.
  RLS/tenant-isolation (migration 052) applies to the new table the same
  way it applies to every other tenant-scoped table.
- **RFI / issue / snagging workflows**: `modules/rfis`, `modules/issues`,
  `modules/snagging` exist and are untouched by Phase 3B — workflow
  integration is Phase 3F, not yet started.
- **Existing environment variables**: `GOOGLE_OAUTH_CLIENT_ID`/
  `GOOGLE_OAUTH_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI` exist in
  `apps/api/.env.example` for Calendar integration but are **not set in
  `render.yaml`** — confirmed via direct read. This already silently
  blocks Calendar integration from working in production today, and
  would equally block Gmail if it reused the same client. New,
  separately-named env vars are used for this phase's own providers (see
  Phase 3C/3D) rather than coupling to Calendar's — independently
  configurable, zero risk of breaking the existing integration.
- **Existing audit/activity history**: the global `AuditInterceptor`
  (`common/interceptors/audit.interceptor.ts`) already audits every
  mutation automatically — new routes added in 3C/3D pick this up for
  free, no extra wiring needed, consistent with the RBAC Phase 6 pattern.
- **Current production/staging configuration**: per the Phase 2 review,
  there is one production environment, no staging. This phase's new
  routes/tables are additive and inert (no UI entry point exists until
  Phase 3C/3D ships a frontend route) until explicitly wired in, so
  landing this incrementally on `main` carries the same low risk as any
  other additive, flag-off-by-default feature.
- **No unified "Settings" hub page** — `AiSettingsPage`/
  `DeveloperSettingsPage` are separate top-level routes, not sections of
  one page. `SETTINGS → EMAIL INTEGRATION` will be a new
  `EmailSettingsPage` following that same pattern (Phase 3C/3D/3E).

**Real blockers identified (account-level, not code):**
1. No Microsoft Entra App Registration exists — required before Outlook
   can be tested with a real account. Only the account owner can create
   this (see Phase 3C below for exact steps once reached).
2. No real Google Cloud OAuth client is configured for this use —
   Calendar's existing one is unset in production, and this phase uses
   its own separately-named credentials regardless. Only the account
   owner can create this (see Phase 3D).
3. No "associate email with a project record" data model existed before
   this phase — resolved by the account owner's own decision (see
   below): auto-match by reference number (e.g. `RFI-042`) found in the
   subject/body, implemented in Phase 3F.

**Decisions made with the account owner before implementation began:**
- Email-to-record association: **auto-match by reference number**
  (e.g. scanning for `RFI-042`-shaped patterns), not manual-only. This is
  real design work beyond what the brief specifies and will be covered
  in detail when Phase 3F is reached (false-positive handling, which
  modules, confirm-before-link UX).
- Scope for this pass: build the full OAuth backend plumbing and
  frontend UI now, credential-free — exactly the same posture the
  existing Calendar integration already shipped with ("this integration
  has never been exercised against a live Google account"). Each stage
  (3B, 3C, 3D, ...) is still implemented and verified individually, per
  the brief's own "do not implement the entire phase in one uncontrolled
  change."

## Phase 3B — Secure backend OAuth infrastructure — VERIFIED COMPLETE

Provider-agnostic pieces only — no Outlook- or Gmail-specific code yet
(that's 3C/3D). Everything here is shared by both.

**Files added:**
- `apps/api/src/database/migrations/065_email_integrations.sql` — one
  shared table (`provider` column distinguishes Outlook/Gmail rows, not
  two parallel tables), RLS `tenant_isolation` policy (migration 052
  pattern), encrypted token columns (ciphertext/IV/auth-tag triples for
  both access and refresh tokens — never a plaintext token column).
- `apps/api/src/modules/email-integration/email-integration.types.ts` —
  internal `EmailProviderClient` interface every provider client
  implements (`buildAuthorizeUrl`/`exchangeCodeForTokens`/
  `refreshAccessToken`/`fetchConnectedEmailAddress`), and
  `ProviderTokens`/`DecryptedConnection` shapes.
- `apps/api/src/modules/email-integration/oauth-state.util.ts` — signed,
  self-describing OAuth state (same HMAC design as Calendar's, kept as
  its own copy rather than modifying the working original — see the
  file's own comment), with a `provider` field so a state signed for
  Outlook's callback cannot be replayed against Gmail's, or vice versa.
- `apps/api/src/modules/email-integration/email-token-store.service.ts`
  (`EmailTokenStore`) — the one place that encrypts tokens before they
  reach SQL and decrypts them on read, shared by both providers' own
  services (added in 3C/3D) rather than each hand-rolling its own
  encrypted-storage logic. Derives the brief's required status vocabulary
  (`not_connected`/`connected`/`connection_expired`/
  `authorization_required`/`error`) from `token_expires_at` and a
  recorded `last_error_code`, rather than maintaining a separate status
  enum that could drift from reality.
- `apps/api/src/modules/email-integration/email-integration.module.ts` —
  wires `EmailTokenStore` behind the existing `CryptoModule`; imported by
  `OutlookModule`/`GmailModule` once those exist (3C/3D), not yet
  registered in `app.module.ts` itself since there is no
  provider-agnostic controller to expose.
- `packages/types/src/email-integration.types.ts` — the shared
  `EmailProvider`/`EmailIntegrationStatus` shapes the frontend will
  consume once 3C/3D add routes.

**Tests**: 16 new tests (`oauth-state.util.spec.ts`,
`email-token-store.service.spec.ts`) covering state signing/verification
(valid round-trip, wrong secret, malformed, cross-provider replay
rejection, expiry), and the token store (encryption happens before SQL —
asserted by checking the bound query values never contain the plaintext
token strings, round-trip decryption, every derived status branch,
disconnect scoped to the calling user, error recording, last-used
touch).

**Verified**: `tsc --noEmit` clean, `eslint` clean, full Jest suite
passing (518/518 — 502 prior + 16 new), production build succeeds.

## Phase 3C — Microsoft Outlook connection and sending — NOT IMPLEMENTED

## Phase 3D — Gmail connection and sending — NOT IMPLEMENTED

## Phase 3E — Reusable email composer — NOT IMPLEMENTED

## Phase 3F — Project-workflow integration — NOT IMPLEMENTED

## Phase 3G — Email history and audit logging — NOT IMPLEMENTED

## Phase 3H — Incoming replies / threading — NOT IMPLEMENTED

Per the brief's own Section 9: implement only if the infrastructure,
permissions, provider configuration, and security controls support it
reliably, and do not claim it works unless tested end to end. Given
Phase 3C/3D's real credentials don't exist yet (account-level blocker,
Section 1 above), this is expected to land after 3G at the earliest, and
may end up architecturally designed-for but not fully implemented in
this environment, consistent with the brief's own allowance for that
outcome.

## Phase 3I — Security, permission, and regression tests — NOT STARTED

## Open items requiring the account owner's action (running list)

1. **Microsoft Entra App Registration** — needed before Phase 3C can be
   tested with a real account. Exact steps will be given when Phase 3C
   is implemented.
2. **Google Cloud OAuth client** (separate from Calendar's existing,
   still-unconfigured one) — needed before Phase 3D can be tested with a
   real account. Exact steps will be given when Phase 3D is implemented.
3. **Google OAuth verification / Microsoft admin consent** — to be
   investigated and documented precisely in 3C/3D, per the brief's
   explicit "do not assume verification is unnecessary" instruction.
