-- Hotfix for a bug shipped in migration 046: this codebase's rfis table
-- (created by 014_rfis.sql, not migration 001) never actually had
-- closed_at/closed_by columns. Migration 046's own comment claimed "rfis.
-- closed_at/closed_by have existed since migration 001" -- that was wrong;
-- what actually lives in migration 001 at that description is the
-- *issues* table's closed_at/closed_by (a different table entirely).
-- Migration 046 only added closed_as_organization_slot and
-- closed_by_external_email on top of that false assumption, so every
-- query referencing rfis.closed_by (findOne()'s join, close(),
-- decideReview(), buildExternalDetail()) has been raising
-- "column r.closed_by does not exist" in production -- breaking every
-- single-RFI fetch, not just closing one.
ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);
