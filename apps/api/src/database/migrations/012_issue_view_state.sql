-- Lets an issue capture the exact 3D view it was raised from: which model,
-- camera position/target, and an optional screenshot -- so "view in 3D"
-- can restore the original vantage point instead of only re-selecting the
-- linked element. Additive and nullable throughout; flat columns to match
-- this table's existing pos_x_norm/pos_y_norm/hotspot_yaw/hotspot_pitch
-- convention rather than introducing a JSONB shape unique to this table.
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES bim_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS camera_pos_x DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS camera_pos_y DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS camera_pos_z DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS camera_target_x DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS camera_target_y DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS camera_target_z DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS screenshot_storage_key VARCHAR(1000);

CREATE INDEX IF NOT EXISTS idx_issues_model_id ON issues(model_id) WHERE model_id IS NOT NULL;
