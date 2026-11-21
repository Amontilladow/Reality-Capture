BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Migration 087: Site Drawing Hub -- per-revision source tracking, so the
-- same physical drawing synced from TWO different external sources (e.g.
-- both Procore and SharePoint) stops creating two separate register
-- entries.
--
-- Root cause: SiteDrawingSyncService.reconcileDrawing() has only ever
-- looked up an existing drawing by (project_id, source_provider,
-- source_file_id) -- site_drawings' own UNIQUE constraint (migration 072).
-- A drawing number already registered from Procore was therefore invisible
-- to a SharePoint sync pass over the identical physical drawing: neither
-- provider's lookup could ever match the other's row, so a second,
-- independent site_drawings row was created every time, with no
-- cross-source dedup or conflict flag at all (confirmed against production
-- data: SD-05729/05730/05731 each registered twice, once per source).
--
-- Fix: site_drawing_revisions now also carries its OWN source_provider/
-- source_file_id (previously this identity lived ONLY on site_drawings,
-- implicitly assuming a drawing has exactly one source forever). The sync
-- service can now recognize "has THIS exact (provider, file) been synced
-- before, regardless of which drawing it is attached to" independently of
-- site_drawings' own source columns, which keep their original meaning
-- (a drawing's ORIGINAL registering source) unchanged. When a sync pass
-- finds a drawing_number already registered from a DIFFERENT provider, the
-- incoming file's revision is now attached to that EXISTING drawing --
-- auto-promoted only when the title also matches and chronology is
-- unambiguous, otherwise left as a CONFLICT for the existing Review Queue
-- to resolve (the same confirm-as-revision/split-as-new-drawing flow the
-- RAR import pipeline already uses for an identical ambiguity).
--
-- Backfill: every revision that exists today was created under the
-- single-source model this migration replaces, so it inherits its
-- source_provider/source_file_id from its own parent drawing -- lossless,
-- since that was always implicitly true until now.
--
-- conflicts_created on site_drawing_sync_log is the sync job's own analog
-- of site_drawing_import_batches.conflict_count (migration 086): a sync
-- pass that leaves a cross-source match un-promoted, pending review, is a
-- distinct, worth-tracking outcome from drawings_created/revisions_created.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS source_provider doc_source_enum;
ALTER TABLE site_drawing_revisions ADD COLUMN IF NOT EXISTS source_file_id VARCHAR(500);

UPDATE site_drawing_revisions r
SET source_provider = d.source_provider, source_file_id = d.source_file_id
FROM site_drawings d
WHERE r.drawing_id = d.id AND r.source_provider IS NULL;

-- A given source file can only ever be linked to one revision row -- what
-- the sync service's new lookup relies on to recognize a file it has
-- already reconciled (on whichever drawing it ended up attached to), so a
-- re-run sync tick never creates a second conflict revision for the same
-- file. Partial (WHERE source_provider IS NOT NULL): a manually-registered
-- or RAR-imported revision has no source file at all, and must not be
-- treated as colliding with every other such revision's NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_drawing_revisions_source_file
  ON site_drawing_revisions (project_id, source_provider, source_file_id)
  WHERE source_provider IS NOT NULL AND source_file_id IS NOT NULL;

ALTER TABLE site_drawing_sync_log ADD COLUMN IF NOT EXISTS conflicts_created INTEGER NOT NULL DEFAULT 0;

INSERT INTO _migrations (filename) VALUES ('087_site_drawing_cross_source_identity.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
