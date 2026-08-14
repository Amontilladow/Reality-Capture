-- Project-level stakeholder directory, set once per project rather than
-- re-typed on every RFI (client/consultant/contractor names don't change
-- per document, they're fixed for the life of the project). RFI PDFs pull
-- these automatically instead of asking for them again on every RFI.
-- All nullable -- a project can exist before its stakeholders are known.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS org_code         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS client_name      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS lead_designer    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS consultant_name  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS technical_advisor VARCHAR(255),
  ADD COLUMN IF NOT EXISTS pmc_name         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS main_contractor  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS subcontractor    VARCHAR(255);
