BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Site Drawing Hub, Phase 2b — sync-job support
--
-- site_drawings.created_by was NOT NULL (every Phase 1 drawing had a real
-- uploader). A drawing discovered by the sync job (SiteDrawingSyncService)
-- from an external source has no RealityCapture user behind it at all --
-- forcing a fake user reference here would be dishonest data, not a
-- workaround worth taking. Nullable now; the local-upload path
-- (SiteDrawingsService.registerDrawing) keeps setting a real user id, this
-- only widens what's ALLOWED, nothing existing changes behavior.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE site_drawings ALTER COLUMN created_by DROP NOT NULL;

INSERT INTO _migrations (filename) VALUES ('074_site_drawing_sync_nullable_creator.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
