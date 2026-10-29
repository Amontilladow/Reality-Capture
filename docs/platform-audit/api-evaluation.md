# API Evaluation — RealityCapture Platform Audit

Scope note up front, per the audit brief's own rule against padding: Phase 1 found exactly **two** evidenced problems that an external API could plausibly help with — transactional email delivery, and (optionally, downstream of that) disposable/low-quality email detection at signup. It found **zero** evidenced problem in screenshots/scheduling/maps/monitoring/etc. that would justify a new integration (see `realitycapture-audit.md` §2 — the existing desktop-agent screenshot feature already works; it needs a small config enhancement, not an API). This document therefore evaluates those two areas only, plus records why a broader sweep of `public-apis` wasn't performed.

## 1. Transactional email

### Candidates assessed

| Candidate | Auth method | Free tier (per public docs, verify before committing — pricing changes) | Domain verification | Notes |
|---|---|---|---|---|
| **Keep generic SMTP, just configure a provider** (current code path, `nodemailer`) | SMTP user/password | Depends entirely on which provider you point it at | Depends on provider | Zero code change. The existing `EmailService` already works against *any* SMTP-speaking provider — this isn't really a 4th candidate so much as "don't replace the code, just finish the account setup." |
| **Resend** | API key (HTTP API) or SMTP relay | 100 emails/day, 3,000/month free | Required (SPF/DKIM via DNS `TXT`/`CNAME` records on your sending domain) | Modern, good docs, has an SMTP mode too so it can plug into the existing `EmailService` with zero code change if you'd rather not touch the transport layer. Delivery-event webhooks available on free tier. |
| **SendGrid** | API key (HTTP API) or SMTP relay | 100 emails/day free (Twilio SendGrid's free tier has shrunk over the years — confirm current allowance before committing) | Required | Mature, widely used, heavier dashboard/docs than Resend for a simple use case. Also has SMTP relay mode. |
| **Mailtrap** | API key or SMTP | Free tier, but **its "Sandbox" mode never delivers to real inboxes by design** — it's an email-testing tool, not a production sender. Mailtrap does have a separate production-sending product, but that's a different thing from what most people reach for it for. | Required for the production-sending product only | Right tool for **development/testing** (catch outgoing emails without ever risking a real send) — the audit brief explicitly asks for "sandbox credentials" in testing; Mailtrap's sandbox mode is the correct fit for that, not for production delivery. |

### Recommendation

**Use Resend in SMTP mode**, which means **zero application code changes** — just:
1. Create a Resend account (free tier) and verify a sending domain (adds SPF/DKIM DNS records to whichever domain M4/EngineeringOS settles on — ties back to the still-open domain question from earlier in this session).
2. Fill in Render's existing `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` placeholders with Resend's SMTP credentials.
3. Done — `EmailService` already works.

Rationale: the brief's own rule says "prefer repairing the existing provider if it can reliably meet our requirements" and "do not select a provider merely because it advertises a free tier." The existing code is provider-agnostic SMTP; Resend's SMTP mode requires the least change of any option while still giving a modern dashboard and delivery-event visibility if you later want it. SendGrid is an equally valid, slightly more enterprise-flavored alternative with the same SMTP-mode zero-code-change property. **Mailtrap is recommended separately, for local/CI testing only** (point `SMTP_HOST` at Mailtrap's sandbox in development, Resend/SendGrid in production — same code, different env vars, no branching logic needed).

This is a **new account + DNS decision I cannot make or execute for you** (brief rule #17). Needed from you: pick Resend or SendGrid (or another SMTP-speaking provider you already have a relationship with — e.g. if M4 already has Microsoft 365, Outlook's own SMTP relay is also a legitimate zero-new-account option), create the account, verify a domain, and hand me the four SMTP values to put in Render (as `sync: false` dashboard entries, never committed to the repo).

## 2. Email ownership verification

**Not a 3rd-party API question at all.** The brief's own rule #18 is correct and important: no email-validation API can prove ownership — only a successful challenge-response (a verification link or OTP the user must click/enter) can. This is backend logic to build (new verification-token table + endpoints, mirroring the existing, already-solid password-reset-token design in `AuthService`), not something to shop for externally. Scoped as new work in the backlog, pending your confirmation that you actually want to move away from the current signup-code model toward (or alongside) open self-serve signup with email verification — that's a product decision, not just an engineering one, since the current model (company-level signup code) already serves as M4's access control today.

## 3. Disposable/low-quality email detection

### Candidates assessed

| Candidate | Integration | Auth | Detects disposable domains | MX/syntax check | Free tier (per public docs) | Privacy note |
|---|---|---|---|---|---|---|
| **Disify** | REST GET, no key | None | Yes (maintained domain blocklist) | Yes (MX lookup) | Free, no published rate limit in docs — treat as best-effort, not SLA-backed | No account needed means no data-processing agreement either — fine for a low-sensitivity check like "is this domain disposable," since only the domain portion, not the full address, needs to be sent |
| **MailCheck.ai** | REST GET/POST | API key | Yes | Yes | Has a free tier; exact quota should be confirmed at signup, since published numbers on these services change | — |
| **Mailboxlayer (apilayer)** | REST GET, API key | API key | Yes | Yes, plus SMTP-level deliverability check | Free tier historically ~100 requests/month — now part of apilayer's bundled-API pricing, confirm current terms | Sends full email address, not just domain, to a 3rd party on every check |
| **Cloudmersive Validate** | REST POST, API key | API key | Yes | Yes | Free tier (request-count limited, confirm current allowance) | Same full-address consideration as above |

### Recommendation

**Start with a maintained local disposable-domain list, not a live API call**, for exactly the reason the brief itself names: "do not automatically reject a user solely because a third-party API is temporarily unavailable." A local list (e.g. vendoring the widely-used `disposable-email-domains` npm package's domain list, refreshed periodically via a scheduled job or a manual version bump) means:
- Zero per-signup network dependency or added latency.
- Zero per-signup data sent to a 3rd party (meaningful for a construction-management product handling corporate email addresses — nothing sensitive in an email domain alone, but still less surface area than it needs to be).
- A clean fail-open default with nothing to "fail" at all — the check is always available.

If you later want live MX/deliverability checking beyond a static list, **Disify** is the better next step than the paid options: no account, no key to manage, no per-check cost, and it only needs the domain (not the full local-part) to answer "is this domain disposable / does it have MX records." The paid options (Mailboxlayer, Cloudmersive) add SMTP-level deliverability probing, which is meaningfully more invasive (their SMTP probe can itself trigger greylisting/rate-limiting on the target mail server) and not something I'd recommend reaching for until the local-list + Disify combination is confirmed insufficient.

**This stays behind a clean, swappable interface either way** (brief's own requirement) — a single `EmailQualityService` with one method (`classify(domain): 'disposable' | 'ok' | 'unknown'`), so switching from "local list" to "local list + Disify fallback" to "a paid API" later never touches calling code.

## 4. Why no broader `public-apis` sweep was performed

The brief's own Phase 6 instructions say "identify additional APIs only where they solve an evidenced problem" and "prioritize the smallest reliable solution over the largest number of integrations." Phase 1 of this audit did not surface an evidenced problem in maps/geospatial (BIM/drawings/GIS-prep modules already exist and work, per this repo's own extensive prior test coverage), monitoring (no gap identified in this pass — a dedicated Phase 7 sweep would be the right place to look, not a speculative API add here), or construction-workflow integrations (none requested). Padding this document with hypothetical candidates for problems nobody has confirmed exist would violate the brief's own anti-padding rule more than it would help you.
