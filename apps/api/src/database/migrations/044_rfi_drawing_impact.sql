-- RFI drawing impact -- a third impact field, structurally identical to
-- cost_impact_level/time_impact_level (026_rfi_fields.sql / 028_rfi_workflow.sql),
-- but with no amount/currency or days companion column, just level +
-- description (per the ticket: "drawing impact needs neither of those two").
--
-- Also adds the follow-up tracking columns the ticket asks for: who owns
-- getting the drawing actually updated, and whether that update has been
-- applied yet. drawing_update_applied only means anything once
-- drawing_impact_level != 'no' -- there is deliberately no third
-- 'not_applicable' state; an RFI left at 'no' impact just leaves this false
-- and ignored (see RfisService.markDrawingApplied()/getKpiBreakdown()).
--
-- drawing_update_owner_id is NOT backfilled from assigned_to -- it starts
-- NULL for every existing row. The fallback to assigned_to when no owner is
-- set happens at read time in RfisService (remindDrawingUpdate(),
-- getDrawingUpdatesNotApplied()), not by duplicating the value into this
-- column here, so the two columns never silently drift out of sync.
ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS drawing_impact_level       VARCHAR(20) NOT NULL DEFAULT 'no'
    CHECK (drawing_impact_level IN ('no','yes','potential','tbd')),
  ADD COLUMN IF NOT EXISTS drawing_impact_description TEXT,
  ADD COLUMN IF NOT EXISTS drawing_update_owner_id    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS drawing_update_applied      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drawing_update_applied_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drawing_update_applied_by   UUID REFERENCES users(id);
