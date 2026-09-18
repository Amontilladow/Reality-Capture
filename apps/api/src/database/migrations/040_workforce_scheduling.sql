BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- Workforce Intelligence™ — Shift scheduling + absence calendar
--
-- Reverses this feature's own earlier documented scope call
-- ("attendance/clock-in-clock-out... not this product's job" --
-- docs/workforce-intelligence-implementation-plan.md) at explicit product
-- direction. Kept deliberately minimal per that same doc's other standing
-- principle ("this is not an HRIS"): no leave-balance accrual, no PTO
-- policy engine, no payroll integration. Just three things DeskTime itself
-- ships -- a weekly shift-preference grid, a per-date assigned-shift
-- table, and a simple request/approve absence calendar.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: workforce_shift_preferences
-- One row per (user, day-of-week) they'd prefer to work -- "which days and
-- times they prefer working," matching DeskTime's own shift-scheduling
-- feature description. Not a schedule, just a preference a manager
-- considers when building one (workforce_shift_assignments below).
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workforce_shift_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week   SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, matching JS Date#getDay()
  preferred     BOOLEAN     NOT NULL DEFAULT true,
  start_time    TIME,
  end_time      TIME,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_shift_preferences_company ON workforce_shift_preferences(company_id);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: workforce_shift_assignments
-- The actual schedule -- one assigned shift per (user, calendar date).
-- Admin-managed (see ShiftSchedulingController's @Roles gate), not
-- self-service like the preferences above.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workforce_shift_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date    DATE        NOT NULL,
  start_time    TIME        NOT NULL,
  end_time      TIME        NOT NULL,
  assigned_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_assignments_company_date ON workforce_shift_assignments(company_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_user_date ON workforce_shift_assignments(user_id, shift_date);

-- ══════════════════════════════════════════════════════════════════════════
-- TABLE: workforce_absences
-- Self-requested, admin-decided -- a request/approve calendar, not a leave-
-- balance/accrual system. absence_type/status are plain VARCHAR, validated
-- at the API layer against packages/types const arrays (same
-- extensible-without-a-migration pattern as activity_type).
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workforce_absences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  absence_type  VARCHAR(30) NOT NULL DEFAULT 'other',
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  reason        TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by    UUID REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_absences_date_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_absences_company_dates ON workforce_absences(company_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_absences_user ON workforce_absences(user_id);

-- ══════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY -- identical pattern to every prior migration
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'workforce_shift_preferences', 'workforce_shift_assignments', 'workforce_absences'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = current_setting(''app.current_company_id'', true)::UUID)',
      t
    );
  END LOOP;
END $$;

INSERT INTO _migrations (filename) VALUES ('040_workforce_scheduling.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
