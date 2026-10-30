# EngineeringOS / Reality Capture — Data Inventory & Privacy Readiness Gaps

**Prepared 2026-10-29, as part of a broader security/readiness pass.** This is a
**product-readiness and data-mapping exercise, not legal advice.** Every row
below is grounded in a direct read of the current source (migrations, DTOs,
service code) or a configuration file (`app.json`, `render.yaml`) — nothing
here asserts a legal basis, a subprocessor relationship, a retention promise,
a certification, or a jurisdictional compliance claim. Where something could
not be verified from code alone, it says so rather than guessing.

---

## 1. Data inventory

| Data category | Source / collection point | Purpose as implemented | Storage | Retention / deletion as implemented | Who can access it | Optional? How disabled |
|---|---|---|---|---|---|---|
| Account credentials (email, password hash) | Signup / invite flow | Authentication | Postgres (`users` table), bcrypt-hashed password, never stored/logged in plaintext | No deletion path exists — see §3. Deactivation (`is_active=false`) is the only lifecycle action. | Company admins (profile fields only, never the hash); the user themself | Not optional — required to use the product |
| Project/issue/RFI/QAQC/snag content (titles, descriptions, comments, assignees) | User-entered via the web/mobile app | Core product function (construction QA/issue tracking) | Postgres, company/project-scoped (RLS) | Hard-deleted with no undo for issues/RFIs/submittals/snags/captures (documented gap, M-8 in `KNOWN_ISSUES_AND_REMEDIATION.md`); no retention schedule | Company users per their project/role permissions (enforced server-side, see `H-1` fix this session) | Not optional — core product data |
| Site photos / 360° captures, incl. EXIF/GPS where present | Mobile app camera, or direct web upload | Visual site documentation, evidence, floor-plan pin placement | Object storage (S3-compatible / Cloudflare R2), metadata in Postgres | No automatic deletion found; manual delete only where a delete endpoint exists for that record type | Project members per role; presigned URLs are short-lived and scoped (server-generated, never a raw bucket URL) | Capture itself is core product function; GPS tagging is tied to the OS-level location permission (user can deny it — see mobile permissions below) |
| Drawings / site-engineering documents | Upload via web (drawings/documents modules) or Site Drawing Hub (SharePoint/provider sync) | Core product function | Object storage + Postgres metadata | No deletion path for Documents (confirmed — no delete endpoint exists at all, M-8) | Project members per role (H-1 fix this session closed a same-company cross-project gap here) | Not optional — core product data |
| Workforce activity data (app/window usage, idle time) | Desktop/background agent (`apps/agent`) | Productivity reporting for company admins | Postgres, company-scoped | Enforced per-company `retention_days` (default in `workforce_privacy_settings`), auto-purged by a daily cron (`ScreenshotsService.cleanupExpiredScreenshots`, `17 3 * * *`) — **confirmed this applies to screenshots; not independently verified whether the same job purges the underlying `activities` rows on the same schedule** | Company admins/managers per the workforce module's own role gates; the monitored employee can see their own data if `self_view_enabled` is on | **Yes — configurable per company**: `workforce_privacy_settings.monitoring_level`, toggled via `PATCH` on the privacy settings endpoint (company-admin only) |
| Workforce screenshots | Desktop/background agent, only when `screenshot_enabled` is on for the company | Productivity verification | Object storage, namespaced per company/user (`${companyId}/workforce-screenshots/${userId}/`, server-validated this boundary — fixed in an earlier sprint per `LAUNCH_READINESS.md`) | Per-company `retention_days`, auto-purged daily (confirmed, code-read) | Company admins/managers; the monitored employee if `self_view_enabled` | **Yes — off by default** (`screenshot_enabled` defaults to off per the schema's own `DEFAULT`), company-admin togglable |
| Window titles | Desktop/background agent | Productivity context | Postgres, company-scoped | Same retention as activity data | Same as workforce activity | **Yes**, `window_title_enabled` — separate toggle from screenshots |
| Precise/coarse device location | Mobile app, at the moment of capturing a photo/video | Geotagging site captures (not continuous tracking) | Embedded in capture metadata, Postgres | Tied to the capture's own lifecycle (no separate retention) | Same as capture data above | **Yes** — standard OS permission prompt (`ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`, foreground-only — **no background/"always" location permission is declared in `app.json`**, confirmed by its absence); denying it just means captures aren't geotagged |
| Camera / microphone | Mobile app | Capturing site photos/video/360°/audio | Not stored beyond the resulting capture itself | N/A | N/A | **Yes** — standard OS permission prompt; declared purpose strings exist in `app.json` for both (`cameraPermission`, `microphonePermission`) |
| Google Calendar OAuth tokens (access + refresh) | User-initiated OAuth connect, Workforce → Calendar Integration | Read the user's "today" calendar events for workforce context | Postgres, AES-256-GCM encrypted at rest (fixed this session — see `KNOWN_ISSUES_AND_REMEDIATION.md` H-4) | No row expires on its own; deleted on explicit user disconnect (confirmed: `disconnect()` issues a real `DELETE`) | Only the connecting user's own calendar is ever read; no other user/admin can read another user's connected tokens (not independently re-verified this pass that no admin-facing endpoint exposes them — the service's own `getDecrypted`-equivalent is only ever called by the owning user's own request context) | **Yes, fully opt-in** — nothing is connected unless the user initiates the OAuth flow themselves |
| Outlook/Gmail OAuth tokens | User-initiated OAuth connect, Settings → Email Integration | Send email on the user's behalf (notifications, etc.) | Postgres, AES-256-GCM encrypted at rest (confirmed correct from day one, unlike Calendar) | Deleted on explicit disconnect (confirmed, real `DELETE`) | Only the connecting user | **Yes, fully opt-in** |
| BYO AI provider API keys (Anthropic/OpenAI/Gemini/etc.) | User-entered in Settings → AI Provider | Let a user route AI Assistant requests through their own provider account/billing | Postgres, AES-256-GCM encrypted at rest | No automatic deletion found; presumably deleted when the user disconnects (not independently traced this pass) | Never returned in any API response (confirmed by the 2026-10-09 audit); only used server-side to make the provider call on the user's behalf | **Yes, fully opt-in** |
| AI Assistant prompts/responses | User questions to the in-app AI Assistant | Answering user questions about their own project's data | Not persisted as conversation history in any table found this pass (the assistant is stateless per-request; `ai_usage_log` records metadata — status/provider/token counts/timing — not the prompt or response text, per its own schema) | N/A (not stored) | N/A | The AI Assistant itself is a feature the user chooses to use; BYO-provider routing is separately opt-in (see above) |
| Risk assessments, overrides, AI risk briefings | Generated by the Risk module from other project data, or a human override | Risk/management reporting | Postgres, project-scoped | Follows the parent project's lifecycle (no separate deletion path) | Project members per role | Not optional — core product feature |
| Audit log (actor, action, resource, timestamp) | Automatic, on most mutating API calls | Internal audit trail | Postgres | No retention/purge job found for `audit_log` specifically | Not exposed via any API found this pass (no `audit_log` read endpoint located) — **internal/operational only, not user-facing** | Not optional, not user-visible |
| Company-level settings (risk-matrix thresholds, signup codes) | Company admin input | Product configuration | Postgres, company-scoped | Follows company lifecycle | Company admins | N/A — administrative configuration, not personal data |

---

## 2. Missing product controls and user-facing materials

Confirmed **absent** by searching the repository (no file, no route, no DB table/column found for any of these):

| Item | Status |
|---|---|
| Privacy notice / privacy policy | **Does not exist** anywhere in the product or repo (confirmed by `LAUNCH_READINESS.md`'s own prior pass, re-confirmed by this session's own search — no `privacy-policy` route, page, or static document found) |
| Terms of service | **Does not exist** |
| Data Processing Agreement (DPA) / subprocessor list | **Does not exist** — and this document makes no attempt to invent one; what subprocessors are actually in use (Render for hosting, the object-storage provider, whichever AI provider's platform key is configured, Postgres itself) would need to be compiled and reviewed by whoever owns those vendor relationships |
| Account-level data export | **Does not exist** — no "export my data" endpoint found anywhere |
| Account-level data deletion | **Does not exist** — users have no self-service way to delete their own account; a company admin can only deactivate (`is_active=false`), never delete |
| Company-level data export | **Does not exist** (confirmed independently by `SAAS_COMMERCIAL_READINESS.md`'s own §6 finding — "no single mechanism for a company to get a complete export of their own data") |
| Company-level data deletion | **Does not exist** (confirmed independently by `SAAS_COMMERCIAL_READINESS.md`'s own §5 finding — no company deactivation *or* deletion path exists in code, short of a manual database edit) |
| Workforce monitoring disclosure to the monitored employee | **A technical control exists** (`self_view_enabled` lets an employee see their own tracked data if the company admin turns it on), **but no disclosure/consent document or in-product notice was found** stating that monitoring occurs, what's collected, or how to request it stop — this is a real gap distinct from the technical control, and in many jurisdictions workforce monitoring has its own notice/consent requirements independent of general privacy-policy obligations |
| Support / contact channel for a privacy or data request | **Does not exist** in-product — consistent with `SAAS_COMMERCIAL_READINESS.md`'s separate finding that no support-ticketing, live chat, or in-product support email exists at all (Help Centre is static content only) |
| Cookie/tracking disclosure (web) | Not assessed this pass — no analytics/tracking script search was performed; if any third-party analytics (e.g. a product-analytics SDK) is added to `apps/web` in the future, it would need its own disclosure |

---

## 3. What this document deliberately does NOT do

- It does not draft privacy-policy, terms-of-service, or DPA text. Doing so
  credibly requires knowing the company's actual legal entity, jurisdiction,
  subprocessor contracts, and data-subject population — none of which is
  determinable from source code. A policy written from code alone would be
  guesswork dressed as authority, which is worse than no policy.
- It does not assert a legal basis (consent, legitimate interest, contract,
  etc.) for any processing activity above — that is a legal determination,
  not a code-reading one.
- It does not claim GDPR, CCPA, or any other framework's compliance, in
  whole or in part.

---

## 4. Counsel-review checklist

Decisions below require the company's lawyer and/or product owner — each is
a real, concrete question raised directly by the data inventory above, not a
generic template:

1. **Jurisdiction(s) of operation and of the company's customers.** Determines which privacy framework(s) apply (GDPR, CCPA/CPRA, others) and therefore what the privacy notice must actually say.
2. **Data-subject roles.** Is EngineeringOS the data controller for company/user account data, and a data processor for each company's own project data (issues, drawings, captures) created by their employees? This shapes who owes notice/consent obligations to whom.
3. **Subprocessor list.** Confirm and formally document: Render (hosting/compute/Postgres), the object-storage provider (S3-compatible/Cloudflare R2), the configured AI provider(s) (Anthropic/OpenAI/Gemini — note: BYO-AI means some processing may go through a *customer's own* provider account, not EngineeringOS's — this distinction matters for the DPA), the email provider (SMTP), and any OAuth providers (Google, Microsoft) whose tokens are stored.
4. **Workforce monitoring notice requirements.** Several jurisdictions (e.g. several US states, parts of the EU) require specific advance written notice to employees before activity/screenshot monitoring begins, sometimes separate from a general privacy policy. Decide what's required for the company's actual employee/customer population and build the disclosure the technical `self_view_enabled` control currently has no accompanying notice for.
5. **Data retention policy.** Workforce data has a configurable, enforced retention period; everything else (issues, drawings, captures, audit log) has none. Decide whether other categories need a retention policy, and if so, direct engineering to build the enforcement (the workforce module's own cron-job pattern is a ready-made template).
6. **Right to deletion / export.** Both account-level and company-level export/deletion are entirely unbuilt. Decide whether to build them proactively or reactively (on a verified legal request) — this is a product scoping decision once the legal requirement is known.
7. **Transfer arrangements.** If customers or their data are in a different jurisdiction than where Render/the storage provider/the AI provider process the data, standard contractual clauses or an equivalent transfer mechanism may be needed — depends on question 1's answer.
8. **BYO-AI data flow disclosure.** When a user connects their own AI provider key, their prompts and the project data referenced in them flow to *that provider*, under *that provider's own terms*, not EngineeringOS's. This should be disclosed plainly to users choosing that option, distinct from the platform's own default AI provider.

---

## 5. If/when a privacy notice or ToS is drafted

Any resulting document must be clearly labeled **"Draft — for qualified
counsel review, not yet approved"** until a lawyer signs off, and must be
built only from the verified product behavior in §1 above — never from
assumed features, planned-but-unbuilt controls (export/deletion), or
boilerplate claims the product doesn't actually back up (e.g. a specific
certification, a specific retention promise beyond what's actually
enforced in code). No such document was drafted in this pass — the
inventory and checklist above are the deliverable.
