-- Lets a Location (including a floor-plan pin) optionally point at a
-- specific BIM element, so a pin and a 3D element can refer to the same
-- Place instead of being tracked as two unrelated things. Additive and
-- nullable -- nothing existing changes shape or behavior.
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS element_id UUID REFERENCES bim_elements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_locations_element_id ON locations(element_id) WHERE element_id IS NOT NULL;
