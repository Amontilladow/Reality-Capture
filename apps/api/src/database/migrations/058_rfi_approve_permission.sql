-- RBAC Phase 2: splits the single 'manage_rfis' permission's review/approval
-- transitions (submit-for-review, decide-review -- the PMC/client sign-off
-- stage) out into a distinct, narrower grant. Purely additive: 'manage_rfis'
-- still covers every RFI action it always did (nothing is removed from it),
-- so no existing grant loses access. 'approve_rfis' lets an admin instead
-- grant *only* the PMC review/approval step to someone who should not also
-- be able to answer or close RFIs directly -- see ProjectPermissionGuard and
-- rfis.controller.ts's submitForReview/decideReview routes, both now gated
-- on ('manage_rfis' OR 'approve_rfis').
ALTER TYPE project_permission_enum ADD VALUE IF NOT EXISTS 'approve_rfis';
