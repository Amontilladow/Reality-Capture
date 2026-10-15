-- ══════════════════════════════════════════════════════════════════════════
-- Scope the Risk Engine's QAQC coverage down to NCR only -- SOR/WIR/MIR are
-- no longer risk-worthy (see risk.service.ts's RISK_WORTHY_NODE_TYPES).
--
-- This is a data cleanup, not a schema change: the risk_node_type enum
-- (migration 050) still carries 'ncr'/'sor'/'wir'/'mir' as values (Postgres
-- can't cheaply drop enum values, and there's no need to -- the application
-- code simply stops creating 'sor'/'wir'/'mir' graph nodes from here on).
-- This migration only deletes any 'sor'/'wir'/'mir' risk_graph_nodes rows
-- that were already created while all four QAQC types fed the Risk Engine.
--
-- Deleting from risk_graph_nodes cascades through every dependent table via
-- their existing ON DELETE CASCADE foreign keys (migration 051):
--   risks.root_node_id, risk_signals.node_id, risk_evidence.node_id,
--   risk_evidence.risk_id -> risks, risk_snapshots.risk_id -> risks,
--   risk_status_history.risk_id -> risks, and both directions of
--   risk_graph_edges (migration 050). No manual multi-table deletes needed.
-- ══════════════════════════════════════════════════════════════════════════

DELETE FROM risk_graph_nodes WHERE node_type IN ('sor', 'wir', 'mir');
