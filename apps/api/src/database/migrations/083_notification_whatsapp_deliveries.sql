-- ══════════════════════════════════════════════════════════════════════════
-- Migration 083: Notification WhatsApp delivery log
--
-- Part of the Centralized Notification & Communication Engine's Phase 3
-- (WhatsApp Business API channel). Mirrors notification_email_deliveries
-- (migration 082) / webhook_deliveries (migration 056): same
-- attempts/status/last_error bookkeeping. provider_message_id is new here
-- (Meta's Cloud API returns one per send) -- the inbound webhook that
-- reports delivered/read/failed status looks a row up by it (carried back
-- via biz_opaque_callback_data at send time) to update status without any
-- other correlation.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS notification_whatsapp_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  notification_id     UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  to_phone            VARCHAR(20) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'skipped_not_configured')),
  provider_message_id VARCHAR(100),
  attempts            INT NOT NULL DEFAULT 0,
  last_attempted_at   TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_whatsapp_deliveries_company ON notification_whatsapp_deliveries(company_id);
CREATE INDEX IF NOT EXISTS idx_notification_whatsapp_deliveries_notification ON notification_whatsapp_deliveries(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_whatsapp_deliveries_provider_msg ON notification_whatsapp_deliveries(provider_message_id);

ALTER TABLE notification_whatsapp_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_whatsapp_deliveries;
CREATE POLICY tenant_isolation ON notification_whatsapp_deliveries
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

INSERT INTO _migrations (filename)
VALUES ('083_notification_whatsapp_deliveries.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback (if ever needed):
--
--   DROP TABLE IF EXISTS notification_whatsapp_deliveries;
-- ══════════════════════════════════════════════════════════════════════════
