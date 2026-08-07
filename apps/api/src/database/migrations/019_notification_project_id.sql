-- Lets a notification carry which project its resource belongs to, so the
-- client can navigate straight there on click without an extra lookup
-- call. Existing rows get NULL (nothing to backfill from -- the resource
-- type/id alone don't reveal the project without a join per type), which
-- the client already handles as "no navigation, just mark read."
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
