-- Lets a pin record which page of a multi-page drawing PDF it's on. The
-- viewer previously only ever rendered page 1 of any PDF; pins created
-- before this migration are all implicitly page 1, which the DEFAULT
-- preserves exactly (no backfill needed, no existing behavior changes).
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS page_number INTEGER NOT NULL DEFAULT 1;
