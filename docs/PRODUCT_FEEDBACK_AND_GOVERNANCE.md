# EngineeringOS — Product Feedback and Governance

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Confirmed via code search: **no feedback, bug-report, or feature-request mechanism exists anywhere in this codebase today.** This is a greenfield design proposal, not a review of an existing system. Nothing in this document has been implemented in this engagement — it's scoped as a deliberately small, low-cost addition for your approval, consistent with this brief's own instruction that "feedback must not automatically create production changes or grant elevated permissions."

---

## 1. Design principles

- **Lightweight, not a help-desk platform.** No new third-party service (no Zendesk/Intercom/Jira integration) — a new first-party table plus a small UI surface, consistent with this phase's "use existing infrastructure" theme elsewhere.
- **Feedback is data, never an instruction.** A submitted bug report or feature request is a row in a table for a human to triage — it must never itself trigger a code change, a permission grant, or an automated action. This is a hard boundary, not a convenience.
- **Company/project-scoped, same as everything else.** Feedback rows inherit the same `company_id`/`project_id` RLS pattern as every other table in this codebase.

## 2. Proposed data model

```sql
CREATE TABLE IF NOT EXISTS product_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  project_id      UUID REFERENCES projects(id),
  submitted_by    UUID NOT NULL REFERENCES users(id),
  category        VARCHAR(20) NOT NULL CHECK (category IN ('bug', 'feature_request', 'satisfaction', 'other')),
  module          VARCHAR(40),              -- e.g. 'issues','rfis','risk','ai_assistant' -- a closed set matching this app's own module names, for triage grouping
  severity        VARCHAR(10) CHECK (severity IN ('low','medium','high','critical')),  -- only meaningful for 'bug'
  title           VARCHAR(200) NOT NULL,
  description     TEXT NOT NULL,
  diagnostic_info JSONB,                    -- OPT-IN only (see §4) -- browser/app version, current route, never request bodies or form contents
  status          VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','planned','in_progress','resolved','declined','duplicate')),
  duplicate_of    UUID REFERENCES product_feedback(id),
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,                     -- shown back to the submitter once resolved, per §8 below
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_product_feedback_company_status ON product_feedback(company_id, status, created_at DESC);
CREATE INDEX idx_product_feedback_module         ON product_feedback(module, category);
-- Same tenant_isolation RLS policy as every other company-scoped table --
-- a company only ever sees and manages its OWN submitted feedback.
```

A separate, platform-wide (not per-company) view is needed for whoever triages feedback across all customers — this is explicitly an internal/platform-operator surface, not something any single company's admin sees (a company should not see another company's bug reports).

## 3. Submission UX (proposed, not built)

- A small "Send Feedback" entry point in the app shell (same visual tier as the existing Help Centre link, per Phase 4's work), opening a short form: category, module (pre-filled from the current route where the user clicked it from), title, description, and — for bugs only — an optional "include diagnostic info" checkbox (opt-in, see §4).
- No screenshot/screen-recording capture in v1 — real value, but meaningfully more engineering effort (client-side capture, storage, and critically, a serious risk of accidentally capturing confidential on-screen project data in the screenshot). Recommend deferring until there's a clear plan for redacting or warning about what a screenshot might contain.

## 4. Privacy and data minimization

- **Diagnostic info is opt-in, not automatic.** If included: browser/OS, app version, the current route path (e.g. `/projects/:id/issues`, with the UUID, not the project name), and the error message if the report followed a visible error. **Never**: form field contents, request/response bodies, other users' names beyond the reporter's own, or anything resembling project engineering content (issue descriptions, RFI text, document contents).
- **No confidential project data is ever required to submit feedback** — a user reporting "the RFI form doesn't save" needs to describe the problem, not paste the RFI's actual content.
- Same company-scoped RLS boundary as the rest of the platform — one company's admins can never see another company's submitted feedback, even in aggregate.

## 5. Duplicate detection

Proposed as a simple, transparent mechanism — not an AI-judgment call: when submitting a `bug` report, run a basic text-similarity check (e.g., PostgreSQL's built-in `pg_trgm` trigram similarity, already achievable with the existing Postgres instance, no new infrastructure) against open reports in the same `module`, and surface "this looks similar to an existing report" to the submitter with a one-click "add my vote instead" option (incrementing a `votes` counter rather than creating a true duplicate row) rather than silently merging — the submitter should see and confirm the match, not have their report disappear into another one without their knowledge.

## 6. Prioritization framework (for whoever triages, not automated)

Per the brief's required dimensions, a simple weighted scoring rubric for the platform operator's triage process (not an in-app automated score — human judgment applies the rubric):

| Dimension | Low | Medium | High |
|---|---|---|---|
| Business value | Minor convenience | Meaningful workflow improvement | Blocks or meaningfully slows a core workflow |
| Affected users | One company, few users | Multiple companies or many users in one company | Affects most/all companies |
| Safety/security/contractual risk | None | Data-quality concern | Security vulnerability, data-integrity risk, or contractual-compliance risk (e.g., affects RFI/approval audit trail) |
| Implementation effort | Hours | Days | Weeks+ |
| Operational cost | None | Minor (e.g., a new index) | New infrastructure or recurring cost |
| Maintenance burden | Self-contained | Touches 1-2 modules | Cross-cutting (touches auth, tenancy, or the AI module) |

A `critical` severity bug report (data loss, security, or a company fully blocked) should be escalated outside this queue entirely, not left to wait in a backlog — the same judgment already applied informally in this engagement's own Phase 6 security findings.

## 7. Release notes and change communication

Proposed, not built: a simple `release_notes` table (or even a static Markdown changelog served from the Help Centre, reusing Phase 4's existing content infrastructure rather than building a new system) — version, date, a short list of changes, linked where relevant to resolved `product_feedback` rows (closing the loop: "you reported X, it's fixed in v1.3").

## 8. Tracking resolution — closing the loop with the reporter

The `resolved_at`/`resolution_note` columns above exist specifically so a submitter can be told what happened to their report, even if only "not planned, here's why" — a silent backlog that submitters never hear from again actively discourages future feedback. A simple in-app notification (reusing the existing `MessagingService`, already used for RFI/issue notifications per Phase 6's findings) when a user's own submitted feedback changes status is low-cost and closes this loop without new infrastructure.

## 9. Explicit non-goals (per this brief's own constraints)

- Feedback submission **never** triggers an automated code change, deployment, or permission grant — it only ever creates a row for a human to read.
- No AI-automated triage/prioritization in v1 — the rubric in §6 is a human tool, not an automated decision-maker. (A future "AI suggests a priority score" assist tool is plausible later, but should be clearly labeled as a suggestion a human can override, never an automatic action — consistent with this platform's existing AI Assistant design principle of never making unapproved decisions.)
- No satisfaction-survey automation (e.g., auto-emailing users) in v1 — an opt-in, manually-triggered survey link is simpler and avoids any email-frequency/consent concern.

## 10. Implementation status

**Nothing in this document has been built in this engagement.** This is a complete, ready-to-approve design (schema, UX sketch, privacy rules, prioritization framework) for your decision — see `ENGINEERINGOS_30_60_90_DAY_ROADMAP.md` for where this is recommended to sit in the priority order (P2: valuable but not urgent, no existing pain signal yet since there's currently no way to even measure how much feedback volume to expect).
