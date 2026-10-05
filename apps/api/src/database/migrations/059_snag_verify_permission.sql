-- RBAC Phase 3: segregation-of-duties counterpart to migration 058's
-- 'approve_rfis' for snag items. 'verify_snag_items' covers only the
-- fixed -> verified sign-off step (SnaggingController's new POST :id/verify
-- route) -- 'manage_project_records' still covers it too (purely additive,
-- same OR pattern as approve_rfis), so no existing grant loses access.
ALTER TYPE project_permission_enum ADD VALUE IF NOT EXISTS 'verify_snag_items';
