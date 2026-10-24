BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Site Drawing Hub, Phase 2 — SharePoint adapter support
--
-- source_revision_id: a provider's own revision/version identifier, for a
-- provider whose revision history lives on ONE source file (SharePoint's
-- own version history on a driveItem) rather than as separate standalone
-- files the way 'internal' revisions each have their own storage_key.
-- NULL for every existing (internal) row and stays NULL for any future
-- internal revision -- see SiteDrawingRevision's own comment in
-- site-drawing.types.ts.
--
-- doc_integrations gains last_attempted_sync_at / last_sync_error alongside
-- the table's existing last_synced_at, so "last successful" and "last
-- attempted" can be tracked separately (brief section 6) -- last_synced_at
-- alone can't distinguish "never synced" from "every attempt since has
-- failed."
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS source_revision_id VARCHAR(500);

ALTER TABLE doc_integrations ADD COLUMN IF NOT EXISTS last_attempted_sync_at TIMESTAMPTZ;
ALTER TABLE doc_integrations ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

INSERT INTO _migrations (filename) VALUES ('073_site_drawing_sharepoint.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
