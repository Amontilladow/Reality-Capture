-- ══════════════════════════════════════════════════════════════════════════
-- Migration 082: Notification email delivery log
--
-- Part of the Centralized Notification & Communication Engine's Phase 2
-- (real email delivery/templates). Mirrors webhook_deliveries (migration
-- 056) deliberately: same attempts/status/last_error bookkeeping, same
-- reason -- an auditable per-send record independent of Bull's own retry
-- state, read by the (later phase's) admin delivery-log view.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS notification_email_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  notification_id     UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  to_email            VARCHAR(255) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts            INT NOT NULL DEFAULT 0,
  last_attempted_at   TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_email_deliveries_company ON notification_email_deliveries(company_id);
CREATE INDEX IF NOT EXISTS idx_notification_email_deliveries_notification ON notification_email_deliveries(notification_id);

ALTER TABLE notification_email_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_email_deliveries;
CREATE POLICY tenant_isolation ON notification_email_deliveries
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename)
VALUES ('082_notification_email_deliveries.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS notification_email_deliveries;
-- ══════════════════════════════════════════════════════════════════════════
