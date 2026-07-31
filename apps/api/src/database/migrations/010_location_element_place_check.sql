-- Widens the "a location must have a place" rule to include a BIM element
-- as a valid place, not just a level or a floor-plan position -- so a pin
-- can be created starting from an element in the 3D viewer, with no
-- drawing position yet, and still be a real, listable pin.
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_has_a_place_check;

ALTER TABLE locations ADD CONSTRAINT locations_has_a_place_check
  CHECK (level_id IS NOT NULL OR drawing_id IS NOT NULL OR element_id IS NOT NULL);
