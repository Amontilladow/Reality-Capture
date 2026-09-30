import { Injectable } from '@nestjs/common';
import type { TransactionSql } from 'postgres';
import type { RiskEdgeSource, RiskNodeType, RiskRelationshipType } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';

export interface GraphNodeRow {
  id: string;
  companyId: string;
  projectId: string;
  nodeType: RiskNodeType;
  entityId: string;
  entityTable: string;
  label: string;
  discipline: string | null;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdgeRow {
  id: string;
  companyId: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: RiskRelationshipType;
  source: RiskEdgeSource;
  confidence: number;
  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertNodeInput {
  projectId: string;
  nodeType: RiskNodeType;
  entityId: string;
  entityTable: string;
  label: string;
  discipline?: string | null;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpsertEdgeInput {
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: RiskRelationshipType;
  source: RiskEdgeSource;
  confidence: number;
  evidence?: Record<string, unknown>;
}

// Bounds for server-side traversal (brief section 42 — never load the whole
// project graph, and never let one query balloon unboundedly).
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_NODES = 500;

/**
 * Thin persistence + traversal layer over risk_graph_nodes/risk_graph_edges
 * (migration 050). Nothing here knows about RFIs, Issues, or any other
 * domain entity — that's RelationshipExtractionService's job. This service
 * only knows how to store and walk a generic node/edge graph, tenant-scoped.
 */
@Injectable()
export class RiskGraphService {
  constructor(private readonly db: DatabaseService) {}

  async upsertNode(companyId: string, input: UpsertNodeInput, sql?: TransactionSql): Promise<GraphNodeRow> {
    const run = async (tx: TransactionSql) => {
      const [row] = await tx<GraphNodeRow[]>`
        INSERT INTO risk_graph_nodes (
          company_id, project_id, node_type, entity_id, entity_table, label,
          discipline, status, priority, due_date, metadata
        )
        VALUES (
          ${companyId}, ${input.projectId}, ${input.nodeType}, ${input.entityId}, ${input.entityTable}, ${input.label},
          ${input.discipline ?? null}, ${input.status ?? null}, ${input.priority ?? null}, ${input.dueDate ?? null},
          ${JSON.stringify(input.metadata ?? {})}
        )
        ON CONFLICT (company_id, node_type, entity_id) DO UPDATE SET
          label = EXCLUDED.label,
          discipline = EXCLUDED.discipline,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          due_date = EXCLUDED.due_date,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING *`;
      return row;
    };
    return sql ? run(sql) : this.db.withTenant(companyId, run);
  }

  async upsertEdge(companyId: string, input: UpsertEdgeInput, sql?: TransactionSql): Promise<GraphEdgeRow> {
    const run = async (tx: TransactionSql) => {
      const [row] = await tx<GraphEdgeRow[]>`
        INSERT INTO risk_graph_edges (
          company_id, project_id, from_node_id, to_node_id, relationship_type, source, confidence, evidence
        )
        VALUES (
          ${companyId}, ${input.projectId}, ${input.fromNodeId}, ${input.toNodeId}, ${input.relationshipType},
          ${input.source}, ${input.confidence}, ${JSON.stringify(input.evidence ?? {})}
        )
        ON CONFLICT (company_id, from_node_id, to_node_id, relationship_type) DO UPDATE SET
          source = EXCLUDED.source,
          confidence = EXCLUDED.confidence,
          evidence = EXCLUDED.evidence,
          updated_at = now()
        RETURNING *`;
      return row;
    };
    return sql ? run(sql) : this.db.withTenant(companyId, run);
  }

  async getNodeByEntity(companyId: string, nodeType: RiskNodeType, entityId: string): Promise<GraphNodeRow | null> {
    const [row] = await this.db.withTenant(companyId, sql => sql<GraphNodeRow[]>`
      SELECT * FROM risk_graph_nodes WHERE node_type = ${nodeType} AND entity_id = ${entityId}`);
    return row ?? null;
  }

  async getNode(companyId: string, nodeId: string): Promise<GraphNodeRow | null> {
    const [row] = await this.db.withTenant(companyId, sql => sql<GraphNodeRow[]>`
      SELECT * FROM risk_graph_nodes WHERE id = ${nodeId}`);
    return row ?? null;
  }

  async getNodesByProject(companyId: string, projectId: string, nodeTypes?: RiskNodeType[]): Promise<GraphNodeRow[]> {
    return this.db.withTenant(companyId, sql => nodeTypes && nodeTypes.length > 0
      ? sql<GraphNodeRow[]>`SELECT * FROM risk_graph_nodes WHERE project_id = ${projectId} AND node_type = ANY(${nodeTypes})`
      : sql<GraphNodeRow[]>`SELECT * FROM risk_graph_nodes WHERE project_id = ${projectId}`);
  }

  /** Edges pointing out of nodeId (this node AFFECTS / REFERENCES / ... something). */
  async getOutgoingEdges(companyId: string, nodeId: string): Promise<GraphEdgeRow[]> {
    return this.db.withTenant(companyId, sql => sql<GraphEdgeRow[]>`
      SELECT * FROM risk_graph_edges WHERE from_node_id = ${nodeId}`);
  }

  /** Edges pointing into nodeId — the inverse direction (e.g. "affected by"), derived rather than duplicated (see migration 050). */
  async getIncomingEdges(companyId: string, nodeId: string): Promise<GraphEdgeRow[]> {
    return this.db.withTenant(companyId, sql => sql<GraphEdgeRow[]>`
      SELECT * FROM risk_graph_edges WHERE to_node_id = ${nodeId}`);
  }

  /**
   * Bounded-depth, bounded-size BFS neighborhood of a node in both
   * directions (brief section 42 — "graph neighborhood queries", never the
   * whole project graph). Batches one query per depth level instead of one
   * query per node.
   */
  async getNeighborhood(
    companyId: string,
    rootNodeId: string,
    opts: { maxDepth?: number; maxNodes?: number; relationshipTypes?: RiskRelationshipType[] } = {},
  ): Promise<{ nodes: GraphNodeRow[]; edges: GraphEdgeRow[] }> {
    const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;

    return this.db.withTenant(companyId, async (sql) => {
      const visitedNodeIds = new Set<string>([rootNodeId]);
      const collectedEdges = new Map<string, GraphEdgeRow>();
      let frontier = [rootNodeId];

      for (let depth = 0; depth < maxDepth && frontier.length > 0 && visitedNodeIds.size < maxNodes; depth++) {
        const edgeRows = opts.relationshipTypes && opts.relationshipTypes.length > 0
          ? await sql<GraphEdgeRow[]>`
              SELECT * FROM risk_graph_edges
              WHERE (from_node_id = ANY(${frontier}) OR to_node_id = ANY(${frontier}))
                AND relationship_type = ANY(${opts.relationshipTypes})`
          : await sql<GraphEdgeRow[]>`
              SELECT * FROM risk_graph_edges
              WHERE from_node_id = ANY(${frontier}) OR to_node_id = ANY(${frontier})`;

        const nextFrontier = new Set<string>();
        for (const edge of edgeRows) {
          collectedEdges.set(edge.id, edge);
          for (const candidate of [edge.fromNodeId, edge.toNodeId]) {
            if (!visitedNodeIds.has(candidate) && visitedNodeIds.size < maxNodes) {
              visitedNodeIds.add(candidate);
              nextFrontier.add(candidate);
            }
          }
        }
        frontier = [...nextFrontier];
      }

      const nodeIds = [...visitedNodeIds];
      const nodes = nodeIds.length > 0
        ? await sql<GraphNodeRow[]>`SELECT * FROM risk_graph_nodes WHERE id = ANY(${nodeIds})`
        : [];

      return { nodes, edges: [...collectedEdges.values()] };
    });
  }

  /**
   * Builds one representative, explainable chain of connected nodes
   * starting at rootNodeId (brief sections 8/13/30 — "Risk Chain"). This is
   * a greedy walk, not a true optimal path: at each step it follows the
   * outgoing (or, if none, incoming) edge that leads to the node with the
   * most further connections — i.e. it keeps walking toward the most
   * "downstream-connected" part of the graph, which is what the brief's
   * own examples (RFI -> Issue -> Location -> Elements -> Activity) are
   * describing. It never revisits a node, and stops at maxSteps or when no
   * unvisited neighbor remains.
   */
  async buildRepresentativeChain(
    companyId: string,
    rootNodeId: string,
    maxSteps = 6,
  ): Promise<{ nodeId: string; viaEdge: GraphEdgeRow | null }[]> {
    return this.db.withTenant(companyId, async (sql) => {
      const chain: { nodeId: string; viaEdge: GraphEdgeRow | null }[] = [{ nodeId: rootNodeId, viaEdge: null }];
      const visited = new Set<string>([rootNodeId]);
      let current = rootNodeId;

      for (let step = 0; step < maxSteps; step++) {
        const edges = await sql<GraphEdgeRow[]>`
          SELECT * FROM risk_graph_edges WHERE from_node_id = ${current} OR to_node_id = ${current}`;
        const candidates = edges
          .map(edge => ({ edge, nextId: edge.fromNodeId === current ? edge.toNodeId : edge.fromNodeId }))
          .filter(c => !visited.has(c.nextId));
        if (candidates.length === 0) break;

        // Rank candidates by how many further connections their target has
        // (a cheap proxy for "leads to more downstream exposure").
        const degrees = await sql<{ nodeId: string; degree: string }[]>`
          SELECT node_id, COUNT(*) AS degree FROM (
            SELECT from_node_id AS node_id FROM risk_graph_edges WHERE from_node_id = ANY(${candidates.map(c => c.nextId)})
            UNION ALL
            SELECT to_node_id AS node_id FROM risk_graph_edges WHERE to_node_id = ANY(${candidates.map(c => c.nextId)})
          ) t GROUP BY node_id`;
        const degreeByNode = new Map(degrees.map(d => [d.nodeId, Number(d.degree)]));

        candidates.sort((a, b) => (degreeByNode.get(b.nextId) ?? 0) - (degreeByNode.get(a.nextId) ?? 0));
        const chosen = candidates[0];
        chain.push({ nodeId: chosen.nextId, viaEdge: chosen.edge });
        visited.add(chosen.nextId);
        current = chosen.nextId;
      }

      return chain;
    });
  }

  /**
   * Deletes every node for one real entity and its incident edges (edges
   * cascade via FK). Used when re-extracting a single entity's
   * relationships from scratch (event-driven recalculation, section 41) so
   * stale edges from a since-changed record don't linger.
   */
  async deleteNode(companyId: string, nodeType: RiskNodeType, entityId: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      DELETE FROM risk_graph_nodes WHERE node_type = ${nodeType} AND entity_id = ${entityId}`);
  }
}
