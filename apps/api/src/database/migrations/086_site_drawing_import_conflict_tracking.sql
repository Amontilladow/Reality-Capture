BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Migration 086: Site Drawing Hub -- import batch conflict/unsupported counts
--
-- Site Drawing Hub integrity hardening. SiteDrawingImportProcessor.reconcile()
-- used to promote EVERY new revision to "current" unconditionally, even when
-- it had already flagged that same revision CONFLICT (a title mismatch or a
-- revision-number collision). The flag was purely cosmetic: the register's
-- current_revision_id/is_superseded already changed before any human ever
-- saw the Review Queue. This release stops promoting on uncertain identity
-- or unconfirmed revision chronology (see the processor's own comments), and
-- a revision stuck in that pending state is a THIRD outcome a batch can
-- have, distinct from "revision_added" (auto-promoted) and "error" (the file
-- genuinely couldn't be processed). Additive only: file_count/created_count/
-- revision_count/skipped_count/error_count keep their existing meaning
-- exactly as before; nothing is renamed, nothing is backfilled, no existing
-- row's CURRENT counts are reinterpreted.
--
-- unsupported_count fills a separate, pre-existing gap: a batch's fileCount
-- only ever counted PDF entries attempted; a ZIP's non-PDF entries (a stray
-- readme.txt) and oversized-entry rejections were silently invisible in the
-- batch record itself (zip-extraction.util.ts's own skippedNonPdf/
-- rejectedUnsafe were computed but never persisted).
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE site_drawing_import_batches ADD COLUMN IF NOT EXISTS conflict_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_drawing_import_batches ADD COLUMN IF NOT EXISTS unsupported_count INTEGER NOT NULL DEFAULT 0;

INSERT INTO _migrations (filename) VALUES ('086_site_drawing_import_conflict_tracking.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
