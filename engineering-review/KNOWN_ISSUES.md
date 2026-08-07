# EngineeringOS — KNOWN_ISSUES.md

Updated after an independent third-party AI audit of the codebase.
Findings from that audit are marked **[Audit]** below, each independently
re-verified against the actual source (not taken on faith from the
audit's own claims, and not taken on faith from this project's prior
claims either).

## Critical
None open — none found by this project's own testing, and none found by
the independent audit after a source-level security/architecture review.

## Major
- **Production deploys never run new migrations.** `apps/api/Dockerfile`'s
  `CMD` is just `node apps/api/dist/main` — no migration step. Root cause
  of a real production incident: migration `013_drawing_page_pins.sql`
  (`page_number` column) shipped in the same deploy as the multi-page
  drawings feature but was never applied to the production DB, so
  `GET .../drawings/:id/pins` 500'd (`column loc.page_number does not
  exist`) for every drawing from that deploy onward until run manually via
  Render's Shell (`node apps/api/dist/database/run-migrations.js`).
  Confirmed fixed 2026-08-06. The underlying gap is still open — any
  future migration (014/015/016 included) needs the same manual step
  after every deploy until this gets wired into the deploy process itself
  (e.g. a Render pre-deploy command, or a startup check).

## Minor

- **[Audit] Rate limiting exists but isn't applied to the sensitive
  endpoints it was built for.** A stricter rate-limit bucket (10
  requests/minute) is defined in configuration specifically for
  authentication endpoints, but checking the actual controller, it's
  never applied to `login`, `forgot-password`, `reset-password`, or
  `refresh` — they all fall through to the general 100/minute limit
  instead. Confirmed by reading `app.module.ts` (bucket defined) against
  `auth.controller.ts` (never referenced). Easy, low-risk fix: add the
  decorator to those four endpoints.
- **[Audit] IFC model upload accepts any file type/size up to 500MB with
  no validation before generating the upload link.** Not dangerous on its
  own — a non-IFC file just fails cleanly later in the pipeline (verified
  behavior, see the malformed-file resilience test) — but it means the
  storage bucket can be used to store arbitrary files via this endpoint
  before that check ever happens. Worth adding an extension/MIME
  allowlist at the point the upload URL is issued, not after.
- **[Audit] A handful of endpoints skip the DTO-based validation used
  everywhere else.** Confirmed: `bim.controller.ts` (4 endpoints) plus
  one method each in `issues`, `buildings`, `drawings`,
  `subscription`, and `documents` controllers accept the request body as
  a plain inline TypeScript type instead of a `class-validator`-decorated
  DTO class. TypeScript types are compile-time only — the app's global
  strict validation (reject unknown fields, enforce types) does **not**
  actually apply to these specific request bodies at runtime. Not a
  security hole by itself, but a real inconsistency with the "everything
  is strictly validated" pattern used elsewhere, and an easy, well-scoped
  fix (convert each to a proper DTO class).
- **[Audit] Some login error messages reveal account state.** Trying to
  log into a deactivated account, an inactive company, or an
  SSO-only account returns a specific message saying so, rather than a
  generic "invalid credentials." Good for legitimate confused users;
  technically discloses to anyone probing an email address that the
  account exists and in what state. A real, deliberate tradeoff to
  reconsider, not an oversight.
- **[Audit] A minor race condition in "accept invitation."** The flow
  checks the invitation token is still valid, then updates the user row,
  without wrapping both steps in a transaction or lock. In the unlikely
  event the same invitation link is submitted twice at nearly the same
  instant, both requests could succeed instead of the second being
  cleanly rejected. Doesn't corrupt data or create duplicate accounts —
  worst case is a redundant token issued — but it's a real gap in
  strict one-time-use enforcement. Low severity, straightforward fix.

- **Persistent zero-geometry `IFCMECHANICALFASTENER`.** GUID
  `32$ek4m5rEgvoHmkRSTjkO` ("Bolt assembly") on LATEST STAIR-03
  consistently showed 0 vertices/triangles across the checks performed
  during the BIM viewer root-cause investigation — unlike the 27 weld
  fasteners found alongside it, which turned out to be victims of the
  `@thatopen/fragments` generation nondeterminism documented in
  `ROOT_CAUSE_REPORT_BIM_VIEWER.md` and filed upstream as
  [engine_fragment#260](https://github.com/ThatOpen/engine_fragment/issues/260).
  This one did not flip to correct geometry on retest, suggesting a
  separate cause. Status: not yet investigated — deliberately not
  combined with the #260 finding without evidence they share a root
  cause.

(The 8 bugs found and fixed during this project's own development —
spanning the IFC engine and BIM viewer integration — remain fixed and
re-verified; see `COMPLETED_WORK.md` for that list. Nothing above
overlaps with those.)

---

## Technical debt

- **Pre-existing `postgres.js` generic-typing noise** in 5 files across
  `apps/api`/`apps/ifc-service` (`database.service.ts` in both apps,
  `auth.service.ts`, `captures.service.ts`, `audit.interceptor.ts`).
  `tsc --noEmit` flags these; `nest build` (SWC, what actually runs) does
  not. Predates the IFC engine work; deliberately deferred, consistent
  with the repo's existing "quality/lint sprint comes later" policy.
- **`strictPropertyInitialization`/`noUnusedLocals`** disabled repo-wide —
  same deferred-quality-sprint policy, predates this phase.
- **`apps/web` production bundle size** — ~6.8MB main JS
  (~1.3MB gzipped) due to Three.js + `@thatopen/components` +
  `@thatopen/fragments`. Functionally fine; code-splitting the viewer
  route (dynamic `import()`) would improve initial page load. Not done —
  would be an optimization, not a defect.
- **Stage-level (not element-level) resume** in the IFC pipeline — a
  deliberate, documented design tradeoff (see `TECHNICAL_DECISIONS.md`),
  not a defect, but worth knowing before assuming finer-grained recovery
  than actually exists.
- **[Audit] Zero automated tests exist anywhere in the repository.**
  Confirmed by searching the entire project for `.spec.ts`/`.test.ts`
  files — none found. Every verification performed throughout this
  project was manual/live (real commands against real infrastructure,
  documented as it happened), which is genuine verification but leaves
  nothing that automatically catches a regression the next time code
  changes. Independently flagged by the audit as the single largest
  engineering-maturity gap, and confirmed accurate. Highest-priority
  investment before relying on this for ongoing client work.
- **[Audit] No CI pipeline, linter config, or static analysis tooling
  found.** No `.eslintrc`/`eslint.config.*` exists despite a `lint`
  script being defined in `package.json` (confirmed: running it fails
  with "no configuration file found"). Consistent with the no-automated-
  tests finding above — there's currently nothing that runs automatically
  on a code change to catch mistakes.
- **[Audit, verified] Row-level security is bypassed by superuser
  database connections.** Confirmed real and correctly enabled at the
  Postgres level (not just app-code convention) — but Postgres
  superusers bypass RLS by design, and every test performed throughout
  this project's development used a superuser connection for
  convenience. **Production deployment must create a properly
  restricted, non-superuser database role for the application to use**,
  or this entire protection layer is silently inactive despite being
  correctly built. This is an operational/deployment requirement, not a
  code defect — but it's the kind of detail that's easy to get wrong
  under deployment pressure.
- **[Audit, verified] The IFC engine processes exactly one model at a
  time per worker process — by design, not by accident, but previously
  undocumented.** The parsing engine instance is reused across jobs
  (correct usage per the underlying library), which is only safe because
  the queue consumer is configured with no concurrency (Bull's default:
  1 job at a time per process). Horizontal scaling to handle multiple
  models simultaneously requires running multiple separate worker
  processes — it is not something a configuration value can turn up
  within one process without risking shared-state bugs. Worth stating
  plainly to avoid a surprise in front of a technical audience: "handles
  concurrent imports" means "run more worker processes," not "one worker
  juggles many jobs at once."
- **[Audit, verified] No soft-delete pattern anywhere.** Deleting a
  project, model, issue, etc. is permanent — confirmed zero `deleted_at`
  columns in the schema. For a construction/engineering platform where
  audit trails often matter, this is worth a deliberate decision rather
  than leaving it as an implicit default.

---

## Missing verification

- **No browser-level visual/interaction verification for any frontend
  work.** No browser or screenshot tool is available in this
  environment. Every API contract, database write, and storage artifact
  behind the BIM viewer (and the rest of the frontend) has been verified
  live and independently — but actual WebGL rendering, click/orbit/
  search-to-highlight interaction, and general visual correctness have
  never been confirmed by a human or automated browser tool. **Both this
  project's own documentation and the independent audit agree this is
  the single most important outstanding verification item.**
- **No true multi-GB IFC file** was obtainable in this sandbox, so the
  IFC processing engine's architecture is reasoned about for large-scale
  performance (see `IFC_ENGINE_RELEASE_v1.0.0.md`'s Performance section)
  but has not been empirically load-tested at real-world scale. The
  audit independently flagged the same gap.
- **[Audit] No load/stress testing performed** — concurrent imports,
  high user concurrency, queue backlog behavior under hundreds of queued
  jobs, worker crash/restart recovery under load. All architecturally
  reasoned about, none empirically tested.
- **[Audit] No live penetration testing performed** — XSS, CSRF, SSRF,
  and similar live-attack classes require an actual running, attackable
  instance and/or dedicated security tooling, neither of which is
  available in this environment. Source-level review found no obvious
  issues in these categories, but that is not equivalent to a real
  penetration test.
- **AI search/assistant** (`apps/ai-service`) code has been statically
  reviewed as sound but not live-tested end-to-end, because the
  embedding step needs `huggingface.co`, which is outside this sandbox's
  network allowlist. Qdrant itself IS confirmed reachable (downloaded via
  GitHub release binary). Not a code defect — an environment constraint.
- **IFC2x3 schema** — only IFC4 has been directly tested (via the
  `IfcOpenHouse` fixture and its hand-augmented copy). `web-ifc` supports
  both schemas and the extraction code doesn't assume schema version, but
  no real IFC2x3 sample has been run through the pipeline.
- **Production MinIO/R2 behavior** — all storage verification this phase
  used `s3rver` (a local Node-based S3-compatible emulator) as a stand-in,
  because `dl.min.io` is blocked in this sandbox's network allowlist. The
  API-level logic (presigned URLs, upload/download calls) is verified
  correct against the S3 API surface, but real MinIO/R2 in a real
  deployment should still get a smoke test once reachable.

---

## Areas requiring attention (not bugs, but worth flagging for whoever continues)

- **No dedicated Dashboard page exists.** The Projects list currently
  serves as the landing/dashboard-equivalent page. The fuller KPI
  dashboard from the original spec (Active Projects/Processing Queue/
  Import History/Open Issues/Activity Feed) has not been built. Not a
  defect — just not started yet (see `REMAINING_WORK.md`).
- **[Audit, verified precisely] Three backend feature areas have zero
  working frontend — not just Issues and Timeline.** Confirmed by
  checking `apps/web/src/lib/` for a matching API client file:
  **Issues**, **Timeline**, and **Documents** (distinct from Drawings,
  which does have a working frontend) all have real, working backend
  logic and precisely zero frontend code calling any of it. This project
  had previously only flagged Issues and Timeline — Documents being
  fully unreachable too was found during this audit round and is now
  recorded precisely.
- ~~Issue Management is not integrated into the BIM viewer yet~~ **Shipped**
  (`8f29239`, `apps/web/src/components/bim-viewer/BimViewer.tsx` +
  `apps/web/src/pages/BimViewerPage.tsx` + migration
  `012_issue_view_state.sql`): "Raise issue" from the viewer now captures
  camera position/target and a screenshot, and an issue's "view in 3D"
  link restores that exact vantage point. Not yet verified live in a
  browser — local dev Postgres credentials are broken in this
  environment (same blocker noted on the provenance feature in
  "Future Enhancement" below), so this has only been verified via
  tests/typecheck/build and a full migration-chain dry run, not a real
  click-through.
- **`@thatopen/components`' extended feature APIs** (section planes/box,
  explode, isolation, filters, walk mode) have not been explored in this
  project at all — budget real time for the same empirical
  API-verification practice used for the core viewer (see
  `TECHNICAL_DECISIONS.md`'s closing note) rather than assuming parity
  with other tutorials/examples found online, since this project pins
  specific versions (`3.4.7`/`3.4.6`) that may differ from what's
  commonly documented.
- **Export functionality has not been investigated at all** — first step
  for that item is scoping, not implementation.

## Future Enhancement

- Batch-level (not just stage-level) checkpointing within the IFC
  pipeline's properties stage, for very large models.
- Alerting hook on repeated Fragments-generation failures (currently
  degrades to a warning silently).
- Explicit IFC2x3 regression fixture.
- Parallel processing across multiple workers for a single large model
  (architecture was designed to make this feasible later without a
  rewrite, but isn't implemented).
- Dark/light mode, accessibility pass, mobile layouts, keyboard
  shortcuts — see `REMAINING_WORK.md` item 7.
- Code-splitting the BIM viewer route to reduce initial bundle size.
- **[Audit]** Add CI pipeline with automated tests, linting, and
  dependency vulnerability scanning.
- **[Audit]** Add a proper restricted (non-superuser) database role
  before any real deployment, specifically to make the already-built RLS
  protection actually active.
- ~~Record IFC import provenance at generation time.~~ **Shipped.** Surfaced
  by the BIM viewer geometry investigation (`ROOT_CAUSE_REPORT_BIM_VIEWER.md`):
  there was no way to answer "which exact environment produced this
  `.frag`?" after the fact. Migration `011_bim_model_provenance.sql` adds
  nullable `bim_models` columns (original filename, source/fragments
  SHA-256 + size, Node/`@thatopen/fragments`/`web-ifc` versions, git
  commit); `apps/ifc-service` computes and persists them during normal
  processing; `GET .../models/:modelId/provenance` exposes them
  (metadata only, same auth as the rest of `bim.controller.ts`, never
  storage keys/URLs/credentials/bytes). Models processed before this
  migration have NULL provenance fields until reprocessed. Deployed to
  production and verified against the LATEST STAIR-03 model: not yet —
  see `ROOT_CAUSE_REPORT_BIM_VIEWER.md`'s Open Questions for status.
