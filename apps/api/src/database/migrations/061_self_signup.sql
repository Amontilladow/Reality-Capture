-- Self-service signup: lets someone without an account (e.g. an external
-- consultant/PMC/contractor contact) create their own account against an
-- existing company, given that company's own signup code -- rather than
-- requiring an admin to pre-create a per-email invitation row first.
--
-- signup_code: a short, random, company-wide credential a super_admin
-- shares (distinct from companies.slug, which is predictable from the
-- company name and already used in URLs -- a real secret, not a label).
-- NULL until a super_admin generates one via POST /company/signup-code/regenerate;
-- no self-signup is possible for a company until then.
ALTER TABLE companies ADD COLUMN signup_code VARCHAR(20) UNIQUE;

-- organization_name: the free-text external firm the person actually works
-- for (e.g. "AECOM"), distinct from both company_role (their internal job
-- title/hierarchy position) and the project_organization_members slot
-- (migration 060 -- which stakeholder party they represent on one specific
-- project, assigned by an admin once they're added to that project). This
-- is personal/account-level metadata, captured once at signup.
ALTER TABLE users ADD COLUMN organization_name VARCHAR(255);
