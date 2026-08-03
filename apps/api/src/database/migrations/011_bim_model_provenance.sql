-- Records exactly what produced a given BIM model's generated artifacts,
-- so a future investigation can answer "which input produced this output,
-- in which environment" without guessing. Surfaced by the BIM viewer
-- missing-geometry investigation (ROOT_CAUSE_REPORT_BIM_VIEWER.md) -- the
-- uploaded IFC was never checksummed anywhere, making it impossible to
-- confirm a locally-tested copy actually matched what production received.
-- Additive and nullable throughout -- existing rows simply have NULL until
-- reprocessed; nothing existing changes shape or behavior.
ALTER TABLE bim_models
  ADD COLUMN IF NOT EXISTS original_filename VARCHAR(500),
  ADD COLUMN IF NOT EXISTS source_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS source_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS fragments_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS fragments_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS generation_node_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS generation_fragments_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS generation_web_ifc_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS generation_git_commit VARCHAR(40);

-- generated_at is deliberately not a new column: completed_at already
-- records when a model's processing run finished and is exposed as
-- generatedAt by the provenance endpoint.
