-- rfis.closed_at/closed_by have existed since migration 001 but were never
-- written to -- close() and decideReview()'s approve branch only ever did
-- `UPDATE rfis SET status = 'closed'`. This adds the two fields needed to
-- show "closed by X, as which party, when" prominently rather than leaving
-- that buried in the audit_log feed.
--
-- closed_as_organization_slot: the dropdown's selection (§3) -- reuses the
-- existing PROJECT_ORGANIZATION_SLOTS vocabulary already used by
-- rfi_comments.organization_slot and rfi_external_access.organization_slot.
-- Nullable (not NOT NULL) -- a historical RFI closed before this shipped
-- has no value here, and the UI must degrade to showing nothing extra, not
-- an error.
--
-- closed_by_external_email: display fallback for when closed_by points at
-- the reserved per-company external-actions system account (migration 043)
-- rather than a real named user -- that account has no real human name.
-- Snapshotted from ExternalActorAttribution.recipientEmail at the moment
-- of closing (the same "capture identity now, don't join back later"
-- approach writeRfiAudit()'s metadata already uses for external actors),
-- since a given RFI can have several rfi_external_access tokens issued
-- over its lifetime and there would be no unambiguous way to pick "the"
-- one to join back to afterward.
ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS closed_as_organization_slot VARCHAR(20)
    CHECK (closed_as_organization_slot IN ('client','pmc','ldc','main_contractor','subcontractor')),
  ADD COLUMN IF NOT EXISTS closed_by_external_email    VARCHAR(255);
