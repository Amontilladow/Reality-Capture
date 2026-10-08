-- AI Assistant rebuild: usage/telemetry log for the new AI Gateway.
--
-- Deliberately a separate table from audit_log, not a reuse of it --
-- audit_log (001_initial_schema.sql) is "who changed what resource" (one
-- row per mutation, resource_type/resource_id-shaped), while this is LLM
-- telemetry (one row per assistant request, allowed or blocked, with
-- token/latency/provider fields audit_log has no columns for and no
-- resource being mutated to attach to). Write-once, fire-and-forget from
-- AiUsageService, same withTenant + tap-on-completion pattern AuditInterceptor
-- already establishes for audit_log.
--
-- project_id is nullable: a question can in principle be asked without a
-- resolved project context failing the whole log write, though every
-- current call site always has one (the route is always
-- /projects/:projectId/assistant).
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id            BIGSERIAL PRIMARY KEY,
  company_id    UUID         NOT NULL REFERENCES companies(id),
  project_id    UUID         REFERENCES projects(id),
  user_id       UUID         NOT NULL REFERENCES users(id),
  user_role     VARCHAR(30)  NOT NULL,
  -- 'allowed' | 'blocked' | 'error' -- blocked = domain guard rejected the
  -- question before any provider call was made (never counts against the
  -- role's daily/per-minute quota -- see AiUsageService.recordAndCheck()).
  status        VARCHAR(10)  NOT NULL CHECK (status IN ('allowed', 'blocked', 'error')),
  -- Coarse bucket for the usage dashboard's "Top Functions" breakdown
  -- (RFIs/Issues/Risk/Progress/Documents/general) -- derived from which
  -- tool(s) the gateway actually invoked for this request, not free text.
  category      VARCHAR(30),
  provider      VARCHAR(20),
  model         VARCHAR(60),
  input_tokens  INT,
  output_tokens INT,
  latency_ms    INT,
  -- Set only on status='blocked' (why the domain guard rejected it) or
  -- status='error' (what failed) -- never populated for 'allowed'.
  block_reason  TEXT,
  error_message TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_company_created ON ai_usage_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created    ON ai_usage_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_project         ON ai_usage_log(project_id);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_usage_log;
CREATE POLICY tenant_isolation ON ai_usage_log
  USING (company_id = current_setting('app.current_company_id', true)::UUID);
