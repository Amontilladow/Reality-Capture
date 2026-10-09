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

## Phase 3C — Microsoft Outlook connection — IMPLEMENTED BUT NOT VERIFIED (code-complete, no real Entra App Registration exists to test against)

Connect/status/test/disconnect are fully implemented end to end (backend +
frontend). Sending mail itself is deferred to Phase 3E (the composer) —
this stage delivers the connection and the one piece sending will need
(`ensureFreshAccessToken()`), not a send endpoint yet, since there is
nothing to send from until the composer exists.

**OAuth design decisions, with rationale:**
- **Delegated permissions only** — the brief's own instruction ("do not
  request application-wide mailbox access merely to simplify
  implementation"). `MicrosoftGraphClient` requests
  `openid email offline_access https://graph.microsoft.com/Mail.Send`,
  nothing broader.
- **Why no `User.Read`**: the connected mailbox address comes from the ID
  token's own `email` claim (requested via the standard OIDC `openid
  email` scopes), not a separate Graph `/me` call — one fewer scope, one
  fewer round trip.
- **Why no `Mail.Read`/`Mail.ReadWrite`**: reading messages/replies is
  Phase 3H, not yet built. Requesting that scope now, before the feature
  exists to use it, would be exactly the "request broader permissions
  only if the relevant feature genuinely requires them" the brief warns
  against.
- **Account type default**: `MICROSOFT_OAUTH_TENANT=organizations` —
  accepts any Microsoft 365 work/school account from any organization,
  deliberately excludes personal `@outlook.com`/`@hotmail.com` accounts.
  Settable to a specific Entra tenant ID/domain to restrict to one
  organization only. **Not yet tested against a real account of any
  kind** — per the brief's "do not claim support for every Microsoft
  account type until tested," no account-type claim is made beyond "the
  code requests this scope"; a single-tenant vs multi-tenant app
  registration is also not yet tested, see below.
- **Refresh token rotation**: Microsoft rotates the refresh token on
  every use (unlike Google, which only issues one on initial grant) —
  `MicrosoftGraphClient.refreshAccessToken()`'s returned token is always
  persisted, not just the access token.

**Microsoft Entra administrator-consent requirement — documented, not
assumed either way:** `Mail.Send` (delegated) is classified by Microsoft
as not requiring admin consent *by default*. However, many
organizations — especially newer Microsoft 365 tenants — have tightened
their tenant-wide user-consent policy to block all user consent
regardless of a permission's own default classification, requiring an
admin to grant consent once for the whole org (or per-user) before
anyone can connect. **This can only be confirmed by checking the actual
target tenant's "User consent settings" in Entra, or by attempting a
real connection and observing whether a consent-blocked error appears**
— neither has been done, since no App Registration exists yet. Do not
treat "no admin consent needed" as established fact for your tenant
specifically.

**Exact Entra App Registration setup steps** (for when you're ready to
test with a real account):
1. [entra.microsoft.com](https://entra.microsoft.com) (or Azure Portal →
   Microsoft Entra ID) → **App registrations** → **New registration**.
2. Name it anything recognizable, e.g. "EngineeringOS Email Integration".
3. **Supported account types**: choose "Accounts in this organizational
   directory only (Single tenant)" if this is only for your own company
   (recommended, matches "respect organization policies" and needs the
   least admin-consent friction), or "Accounts in any organizational
   directory (Any Microsoft Entra ID tenant — Multitenant)" to match this
   code's `organizations` default across any org.
4. **Redirect URI**: platform "Web", value
   `https://engineeringos-api.onrender.com/api/v1/email-integration/outlook/callback`
   (add `http://localhost:3000/api/v1/email-integration/outlook/callback`
   too if you want local-dev testing).
5. After creation, copy the **Application (client) ID** — this is
   `MICROSOFT_OAUTH_CLIENT_ID`. If you chose single-tenant, also copy the
   **Directory (tenant) ID** — this is `MICROSOFT_OAUTH_TENANT`.
6. **Certificates & secrets** → **New client secret** → copy the secret
   **value** immediately (shown exactly once) — this is
   `MICROSOFT_OAUTH_CLIENT_SECRET`. Paste it directly into Render's
   environment-variable dashboard for `engineeringos-api`, never into
   this chat or into the repository.
7. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Delegated permissions** → search `Mail.Send` → **Add permission**.
   (`openid`/`email`/`offline_access` are standard OIDC scopes requested
   directly via the authorize URL and don't need a separate entry here.)
8. If you're a tenant admin (or can ask one): **API permissions** →
   **Grant admin consent for [org]** — pre-consents for the whole
   organization so individual users don't hit a consent-blocked error if
   your tenant restricts user consent (see the paragraph above).
9. Set `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`,
   `MICROSOFT_OAUTH_TENANT` (only if single-tenant), and
   `MICROSOFT_OAUTH_REDIRECT_URI` on `engineeringos-api` in the Render
   dashboard — not committed to `render.yaml` with a real value, per the
   brief's "never commit real secrets to Git."

**Files added**: `apps/api/src/config/microsoft-graph.config.ts`,
`apps/api/src/modules/email-integration/outlook/` (client, service,
controller, module, DTO, tests), `apps/web/src/lib/email-integration.api.ts`,
`apps/web/src/pages/EmailSettingsPage.tsx` (new `SETTINGS → EMAIL
INTEGRATION` route and nav entry, both providers shown per the brief —
Gmail's card is visually present but not yet functional, see Phase 3D),
`apps/api/.env.example` (documented, unset by default).

**Tests**: 11 new tests (`outlook-integration.service.spec.ts`) covering
authorize-URL state signing, cross-provider state-replay rejection
(reused from 3B's util, re-verified at this service's own call site),
successful connect/upsert, `testConnection()`'s three outcomes (not
connected / refresh succeeds / refresh fails and records an error — and
an explicit assertion that it never calls any send-mail capability, per
Section 13's "never send test messages... without explicit approval"),
and `ensureFreshAccessToken()`'s reuse-without-refreshing path.
`MicrosoftGraphClient` itself is not unit-tested, matching
`GoogleCalendarClient`'s own precedent (network glue to a live
third-party API this sandbox has no real credentials for).

**Verified**: `tsc --noEmit` clean (api + web), `eslint` clean (api + web,
same 2 pre-existing unrelated warnings in apps/web), full Jest suite
passing (529/529), full Vitest suite passing (20/20), both production
builds succeed.

**Not verified** (requires the account owner's own Entra App
Registration, per above): an actual OAuth consent screen reached, a real
token exchange, a real connected-account email confirmed, a real test
connection against a live Microsoft account, or anything about which
Microsoft account types actually work end to end.

## Phase 3D — Gmail connection — IMPLEMENTED BUT NOT VERIFIED (code-complete, no real Google Cloud OAuth client exists to test against)

Mirrors Phase 3C's Outlook implementation exactly — same
`EmailProviderClient` contract, same `EmailTokenStore` composition, same
five routes, same frontend card shape. `EmailSettingsPage` now has both
providers fully wired.

**OAuth design decisions:**
- **Scope**: `openid email https://www.googleapis.com/auth/gmail.send` —
  the brief's own "prefer sending-only authorization if a user only
  needs to send email" and "request minimum scopes necessary," directly.
  Not `gmail.readonly`, `gmail.modify`, or the full `https://mail.google.com/`
  scope — reading mail is Phase 3H, not built yet.
- **Connected email from the ID token**, same reasoning as Outlook's
  client: no separate People API call needed.
- **Refresh token behavior differs from Microsoft's**: Google only issues
  a refresh token on the *initial* grant (`access_type=offline` +
  `prompt=consent`), never on a refresh response — `GmailClient.refreshAccessToken()`
  correctly never expects one back, unlike Outlook's rotating-refresh-token
  handling.

**Google OAuth consent-screen, verification, and publishing status —
investigated, not assumed either way (per the brief's explicit "do not
assume verification is unnecessary"):**

Google classifies OAuth scopes into three tiers (non-sensitive, sensitive,
restricted), and Gmail API scopes — including `gmail.send`, even though
it's send-only and cannot read mail — are my best understanding of
Google's own documented policy as falling under the Gmail API's
restricted-scope requirements, not merely "sensitive." In practice this
determines what's needed before real users beyond a small test group can
connect, and depends on which of three paths you're on — **this needs
your decision, since it depends on facts only you know (whether you have
a paid Google Workspace, and who the real users are):**

1. **Internal app type** (only available if EngineeringOS's users are on
   a paid **Google Workspace** organization, not personal `@gmail.com`
   accounts) — restricted to users within that one Workspace
   organization. **No Google verification or security assessment is
   required at all**, regardless of scope. This is very likely the right
   choice if your actual users are your own company's Workspace accounts,
   and avoids the entire verification question below.
2. **External app type, Testing mode** — up to 100 explicitly-added test
   users, no verification required, but each test user sees an
   "unverified app" warning screen during consent and must click through
   it. Fine for an internal pilot/rollout even without Workspace, not
   fine for a public-facing product.
3. **External app type, Production (published) status** — required once
   you exceed 100 users or want to remove the warning screen for
   non-added users. Since `gmail.send` is a Gmail API scope, this
   requires Google's full OAuth verification process, which **for a
   restricted scope specifically includes a CASA (Cloud Application
   Security Assessment) third-party security audit** — real cost and a
   multi-week turnaround, on top of Google's own verification review.

**This is a decision only you can make**, since it depends on whether
your Google accounts are Workspace or personal, and who the real users
will be. I have not assumed path 1 (even though it's likely the best
fit) — tell me which applies and I'll note it here, or you can confirm
it directly in Google Cloud Console's own OAuth consent screen setup,
which states scope sensitivity live in its UI as you configure it.

**Exact Google Cloud Console setup steps:**
1. [console.cloud.google.com](https://console.cloud.google.com) → select
   or create a project → **APIs & Services** → **Enabled APIs** → enable
   the **Gmail API** (search "Gmail API", click Enable — required before
   `gmail.send` can be granted at all).
2. **APIs & Services** → **OAuth consent screen** → choose **Internal**
   or **External** per the decision above. Fill in the required app
   name/support email/logo (minimal for Internal or Testing mode).
3. **APIs & Services** → **Credentials** → **Create Credentials** →
   **OAuth client ID** → Application type **Web application**.
4. **Authorized redirect URIs**: add
   `https://engineeringos-api.onrender.com/api/v1/email-integration/gmail/callback`
   (and `http://localhost:3000/api/v1/email-integration/gmail/callback`
   for local dev if wanted).
5. After creation, copy the **Client ID** (`GMAIL_OAUTH_CLIENT_ID`) and
   **Client secret** (`GMAIL_OAUTH_CLIENT_SECRET`) directly into Render's
   environment-variable dashboard for `engineeringos-api` — never into
   this chat or the repository.
6. If External + Testing mode: **OAuth consent screen** → **Test users**
   → add each real person who needs to connect Gmail before verification
   is pursued (if ever).
7. Set `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, and
   `GMAIL_OAUTH_REDIRECT_URI` on `engineeringos-api` in the Render
   dashboard.

**Files added**: `apps/api/src/config/google-gmail.config.ts`,
`apps/api/src/modules/email-integration/gmail/` (client, service,
controller, module, DTO, tests), Gmail functions added to
`apps/web/src/lib/email-integration.api.ts`, `EmailSettingsPage`'s Gmail
card now fully wired, `apps/api/.env.example` documented (unset by
default).

**Tests**: 11 new tests (`gmail-integration.service.spec.ts`), same
coverage shape as Outlook's — state signing, cross-provider replay
rejection, connect/upsert, `testConnection()`'s three outcomes, and
`ensureFreshAccessToken()`'s both branches (reuse and refresh-then-persist).

**Verified**: `tsc --noEmit` clean (full recursive workspace typecheck),
`eslint` clean (api + web, same 2 pre-existing unrelated warnings), full
Jest suite passing (540/540), production builds succeed for both apps.

**Not verified**: any real OAuth flow against an actual Google account —
no Google Cloud OAuth client exists in this environment. No claim is made
about which account types (Workspace vs. personal Gmail) actually work
end to end, per the brief's own standard.

## Phase 3E — Reusable email composer — IMPLEMENTED BUT NOT VERIFIED (code-complete; no live backend/DB in this environment to exercise a real send against)

**Built, bottom-up, in one verified pass:**

- **Audit trail**: migration `066_email_messages.sql` — `email_messages`
  table, metadata-only by deliberate design (see the migration's own
  header comment): company/project/related-record IDs, initiating user,
  provider, sender/recipient addresses, subject, provider message/thread
  IDs, status, failure reason, attachment metadata (filename/size/type,
  never bytes), `UNIQUE(initiating_user_id, idempotency_key)`. RLS
  `tenant_isolation` policy, same as every other tenant table.
- **Provider send capability**: `EmailProviderClient.sendMail()` added to
  the Phase 3C/3D interface and implemented by both concrete clients --
  `MicrosoftGraphClient.sendMail()` (create-draft-then-send, two Graph
  calls, needed to get a real `messageId`/`conversationId` for the audit
  trail) and `GmailClient.sendMail()` (hand-built RFC 2822 MIME message,
  base64url-encoded, since Gmail's API takes a raw message, not structured
  JSON). `OutlookIntegrationService.sendMail()` /
  `GmailIntegrationService.sendMail()` compose `EmailTokenStore` +
  the provider client identically, returning the connected sender address
  alongside the provider's result.
- **Orchestration**: `EmailComposerService` (new,
  `apps/api/src/modules/email-integration/email-composer.service.ts`) --
  the one place a `send()` actually happens. In order: (1) project
  membership check (mirrors `ChatService.canAccessChannel`'s own
  super_admin-bypass + `project_members` lookup -- Section 10's "only
  authorized project members"), (2) idempotency check (a retried request
  under an already-*sent* key returns the existing row unchanged without
  touching the provider again; a previously *failed* attempt is retried,
  since nothing was actually sent), (3) attachment re-validation against
  the real stored object (`StorageService.getObjectSize`/`.download()`,
  same `ATTACHMENT_MAX_SIZE`/`ATTACHMENT_ALLOWED_EXTENSIONS` allow-list
  RFI attachments use -- ticket 2b's constants, not a second copy), (4)
  **auto-match by reference number** (the user's own chosen design,
  confirmed via `AskUserQuestion`): an explicit `relatedRecordType`/Id is
  verified to actually belong to the project before being trusted; absent
  that, the subject is scanned for a reference-number-shaped token
  (`[A-Z0-9]{2,}(-[A-Z0-9]{1,10}){2,}`, matching every numbering scheme
  this codebase actually uses -- `PRJ-GEN-RFI-STR-0001`, `PRJ-STR-0001`,
  `PRJ-SUB-0001`, `PRJ-<snag>-0001`) and looked up across
  rfis/issues/submittals/snag_items; more than one hit or zero is left
  unmatched rather than guessed, per the brief's own "do not silently
  associate the wrong record" caution, (5) dispatch to the selected
  provider's `sendMail()`, (6) persist the outcome to `email_messages`
  (`INSERT ... ON CONFLICT (initiating_user_id, idempotency_key) DO
  UPDATE` -- the same row a failed-then-retried attempt eventually lands
  on). A provider error is never stored or returned raw -- only a
  truncated `Error.message`, never the full response body, which can echo
  request content.
- **API surface**: `EmailComposerController` --
  `POST /projects/:projectId/emails/attachments/upload-url` (presigned
  PUT, step 1, same shape as `RfisService.getAttachmentUploadUrl`) and
  `POST /projects/:projectId/emails` (send). `SendEmailDto` validates
  provider/to/cc/bcc (email format, size caps)/subject/bodyText/
  attachments (nested, max 10)/optional related record/idempotency key.
- **Frontend**: `EmailComposerModal` (new,
  `apps/web/src/components/EmailComposerModal.tsx`) -- To/CC/BCC (CC/BCC
  collapsed by default)/Subject/Message/Attachments (immediate presigned
  upload per file, same two-step flow as RFI attachments)/provider picker
  (only shown when more than one mailbox is connected; a clear "connect a
  mailbox first" prompt linking to Email Integration settings when
  neither is). A client-generated idempotency key is created once per
  compose session and only replaced after a successful send -- a retried
  submit (e.g. after a network timeout) reuses it, so a duplicate click
  can't double-send. Wired into `ProjectDetail`'s own action bar
  ("Email" button) as the one general-purpose entry point for this
  stage; Phase 3F adds the RFI/Issue/Submittal-specific entry points with
  prefilled subject/related record (the modal's `prefill` prop already
  supports this).

**Verified**: `tsc --noEmit` clean (full recursive workspace typecheck,
both apps), `eslint` clean (api + web, same 2 pre-existing unrelated
warnings as every prior stage), full Jest suite passing (551/551, 10 new
tests for `EmailComposerService` covering membership, idempotency replay
vs. retry-after-failure, provider dispatch, attachment validation, and
auto-match), production builds succeed for both apps. Dev server starts
and serves the app; the composer's own render path was not exercised
against a live backend.

**Not verified**: an actual end-to-end send, or even opening the compose
modal against a running API -- this environment has no live Postgres
(`pg_isready` reports no response) and no OAuth credentials for either
provider (same account-level blocker as 3C/3D, Section 1). No claim is
made that a real send, auto-match lookup, or attachment round-trip works
beyond what the unit tests exercise against mocked collaborators.

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
