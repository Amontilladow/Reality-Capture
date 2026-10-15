-- ══════════════════════════════════════════════════════════════════════════
-- Camera-location pins ("Buildlense Captures") -- a floor-plan pin today
-- unconditionally also creates an Issue (see drawings.service.ts's
-- createPin()). This adds a purpose discriminator so a pin can instead be a
-- pure camera-location marker with no Issue attached.
--
-- Deliberately a NEW column, not a repurposing of the existing created_via
-- ('manual' | 'floor_plan_tap') column -- created_via means how a location
-- was created, pin_purpose means what it's for. Default 'issue' preserves
-- 100% of existing behavior for every pin placed before and after this
-- migration that doesn't explicitly ask to be a camera-location pin.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS pin_purpose VARCHAR(20) NOT NULL DEFAULT 'issue';

DO $$ BEGIN
  ALTER TABLE locations ADD CONSTRAINT locations_pin_purpose_check
    CHECK (pin_purpose IN ('issue', 'camera_location'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
