-- Self-selected role with admin approval: the person accepting an
-- invitation now picks their own intended position, which sits here
-- until a company_admin/super_admin approves (or overrides) it via the
-- existing PATCH /users/:id. NULL = nothing pending (either a normal
-- already-resolved account, or one that was never gated this way).
-- Additive, nullable -- no backfill needed for existing rows.
ALTER TABLE users ADD COLUMN requested_company_role company_role_enum;
