-- Fix for a bug the blind verifier caught in 028_rfi_workflow.sql: its own
-- CHECK constraint declares 'awaiting_clarification' (22 chars) legal, but
-- the column was never widened past its original VARCHAR(20) -- so any
-- UPDATE trying to set that value fails with a Postgres "value too long"
-- error before the CHECK constraint is even reached. requestClarification()
-- was completely non-functional. VARCHAR(30) covers every current status
-- value with headroom for future ones without needing another migration
-- just for width.
ALTER TABLE rfis ALTER COLUMN status TYPE VARCHAR(30);
