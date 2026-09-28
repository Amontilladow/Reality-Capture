# EngineeringOS Reality Capture — NEXT_STEPS.md

Prioritized follow-ups identified during the baseline-improvement sprint
(see `CURRENT_STATUS.md` for the verified evidence behind each item).
None of these were implemented this sprint — they were explicitly out of
scope (broad feature work) or too large/risky for a focused pass. This
list exists so the next sprint starts from a real backlog instead of
rediscovering the same gaps.

---

## 1. Product workflow

- **Presigned upload size limits are declared but not enforced anywhere**
  (`StorageService.getUploadUrl()`'s `_maxSizeBytes` parameter is dead).
  Fixing this properly means moving every upload caller from presigned PUT
  to presigned POST with a `content-length-range` condition — a
  cross-cutting change touching `bim.api.ts`, `drawings.api.ts`,
  `issues.api.ts`, `snagging.api.ts`, `documents.api.ts`, and their mobile
  equivalents, plus the corresponding backend `getUploadUrl()` methods.
  Worth a dedicated sprint of its own given the blast radius; not a
  one-file fix.
- `apps/web` has no standalone `typecheck` script (only catches type
  errors as a side effect of `vite build`). Add one
  (`"typecheck": "tsc -b --noEmit"` or equivalent) so `pnpm typecheck`
  actually covers the frontend directly, independent of a full build.
- `apps/browser-extension` and `tools/bim-debug` have no `lint` script at
  all. Worth deciding whether they should follow the same ESLint
  convention as `apps/api`/`apps/web`, or are intentionally out of that
  net (bim-debug is forensic tooling, not shipped product code).

## 2. Reality capture and spatial evidence

- No browser-level verification exists for the BIM viewer, 360° viewer, or
  drawing-pin placement — every frontend check in this repo today is
  `tsc`/`vite build` succeeding, which proves compilation, not rendering
  or interaction correctness. The building/level grouping work on Floor
  Plans/Issues/Snagging this session is the one exception (verified via
  Playwright against a real running app) — that pattern is worth
  formalizing into an actual, repeatable frontend test suite rather than
  a one-off verification step per feature.
- No load testing exists anywhere in the repo. IFC processing throughput
  on multi-GB models, Bull queue behavior under concurrent parse jobs, and
  API behavior under realistic concurrent request volume are all
  unverified assumptions today.

## 3. Workforce/time attribution

- No items surfaced specific to this area in this sprint's scope (the
  module itself was not touched); carried forward as a placeholder
  category per the requested structure.

## 4. BIM performance and scale

- `apps/ifc-service`'s processing pipeline has never been load-tested
  against multi-GB IFC files. `tools/bim-debug`'s one regression test
  (`fragment_determinism.test.ts`, guarding a real geometry-consistency
  finding — see `ROOT_CAUSE_REPORT_BIM_VIEWER.md`) is blocked on both an
  upstream library issue (ThatOpen/engine_fragment#260) and the absence of
  a committed real-world source IFC file (`BIM_DEBUG_SOURCE_IFC` env var).
  Getting a sanitized real-world fixture committed (or synthesized at
  realistic scale) would unblock this.

## 5. AI and search

- `apps/ai-service`'s `ANTHROPIC_API_KEY` is unset in `render.yaml`
  (`sync: false`, explicitly noted as "no key configured yet") — the AI
  assistant is implemented but non-functional in production as configured
  today. This is a configuration/ops task (add the key in the Render
  dashboard), not a code change, and involves a real credential this
  sprint correctly did not touch.

## 6. Security and compliance

- **Production/local/CI Postgres access never uses the restricted
  `app_user` role the schema defines** — see `CURRENT_STATUS.md` §4 for
  the full evidence chain. `app_user` has no password and no grants;
  `render.yaml`'s `DB_USER` is Render's own database-owner credential,
  which bypasses RLS by table ownership regardless. This means Postgres
  RLS is not currently a real defense-in-depth layer anywhere this app
  runs — tenant isolation rests entirely on `WHERE company_id = ...`
  clauses in application code. Properly fixing this requires: creating a
  real production role with a password and explicit `GRANT`s (not
  ownership), pointing `DB_USER`/`DB_PASSWORD` at it instead of Render's
  default credential, and testing the full request surface against it
  (several existing code comments already flag specific crons/lookups
  that assume `app_user`-style enforcement and would need a bootstrap
  mechanism — e.g. a `SECURITY DEFINER` function or dedicated
  cross-tenant service role — to keep working correctly once RLS is
  actually enforced). This is an infrastructure/credential change and was
  correctly left undone by this sprint's own rules; it should be treated
  as a priority, deliberate, tested migration, not a quick fix.
- No documented backup/restore policy or tested restore procedure for the
  production database.
- Login error messages currently distinguish wrong-password from
  deactivated-account from inactive-company from SSO-only-account,
  revealing account state to an anonymous caller. Needs an explicit
  product decision (collapse to one generic message vs. keep the
  friendlier, more enumerable ones) — see `CURRENT_STATUS.md` §3.
- No penetration test has been performed on this codebase.
- `apps/mobile/app.json`'s `expo.extra.apiBaseUrl` is hardcoded to
  `http://localhost:3000/api/v1` with no environment-specific override
  mechanism (e.g. EAS build profiles) visible in the repo. Needs a real
  dev/preview/production config split before any production mobile build
  is cut.

## 7. Browser and mobile verification

- `apps/web` and `apps/mobile` have no automated test suite at all (no
  Vitest/RTL/Detox or equivalent). This is the single largest verification
  gap in the repository today and the most valuable next investment —
  see the sprint report's "Recommended next step."
- No responsive/device-class verification has been performed beyond the
  three building/level-grouping features touched this session.
- No app-store submission readiness review has been performed (icons,
  splash assets, permissions copy, store metadata, EAS build config).
