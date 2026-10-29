# Follow-up Backlog — RealityCapture Platform Audit

Scoped strictly to what this audit actually found (not a general wishlist — see `docs/ENGINEERINGOS_30_60_90_DAY_ROADMAP.md` and `docs/CONSTRUCTION_WORKFLOW_IMPROVEMENT_ROADMAP.md` for the broader product roadmap, unrelated to this pass). Ordered by priority; each item states what's blocking it.

## P0 — blocked on an external decision, not on engineering

1. **Configure a transactional email provider in production.** Nothing to build — an account-creation + DNS task. See `api-evaluation.md` §1 for the recommendation (Resend, SMTP mode, zero code change) and `implementation-report.md`'s "Remaining blockers" for exactly what's needed from you.

## P1 — scoped, small, needs a go-ahead (not blocked on anything external)

2. **Workforce-agent screenshot interval: make it a server-side, admin-configurable company setting instead of a hardcoded 90-minute default baked in at device enrollment.** Concretely: add a column alongside the existing `screenshots_enabled` company setting (e.g. `screenshot_interval_minutes`, defaulting to 90 to match current behavior exactly — no behavior change until an admin touches it), surface a dropdown (60/90/120 min) next to the existing enable/disable toggle in `WorkforcePage.tsx`'s admin settings panel, and have the agent read it at each poll/heartbeat rather than only at enrollment. Small, additive, backward-compatible (existing enrolled devices keep working at their current interval until they next check in).
3. **Surface last-capture / next-capture timestamps and a per-device health indicator in the Workforce admin view.** The data already exists (every screenshot row has `capturedAt`); this is a read-only query + a small UI addition, not new capture-side work.
4. **Decide whether to build account self-serve signup with email-ownership verification, or keep the current company-signup-code model as-is.** This is the one item on this list that is a product decision before it's an engineering one — building it without confirming it's wanted would be unrequested scope per the audit's own rules. If the answer is yes: the existing password-reset-token design in `AuthService` (opaque, single-use, time-expiring) is the right pattern to mirror, not a new auth system.

## P2 — useful, sequenced after P1 item 4

5. **Disposable-email detection at signup**, once the signup-flow decision above is made — see `api-evaluation.md` §3 for the recommended local-list-first approach (no new account, no per-signup network call, no data sent to a 3rd party).

## P3 — explicitly deferred, not because it's unimportant but because nothing evidenced it this pass

6. **A full Phase 7-style security sweep** (webhook signature validation coverage, rate-limiting coverage, audit-trail completeness across every module) — this audit's own secrets/exposure spot-check (§5 of `realitycapture-audit.md`) found nothing alarming, but it was a spot-check, not the full sweep the original brief describes. Worth its own dedicated pass given its size, rather than folding it into this one.
7. **Re-evaluate `public-apis`-style integrations** only if/when a specific, evidenced problem surfaces elsewhere in the platform — see `api-evaluation.md` §4 for why none was added speculatively this pass.
