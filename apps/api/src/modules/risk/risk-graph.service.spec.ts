import { RiskGraphService, type GraphEdgeRow, type GraphNodeRow } from './risk-graph.service';
import type { DatabaseService } from '../../database/database.service';

const companyId = 'company-1';
const projectId = 'project-1';

function makeNode(id: string, nodeType: GraphNodeRow['nodeType']): GraphNodeRow {
  return {
    id, companyId, projectId, nodeType, entityId: id, entityTable: 'x', label: id,
    discipline: null, status: null, priority: null, dueDate: null, metadata: {},
    createdAt: '', updatedAt: '',
  };
}

function makeEdge(id: string, fromNodeId: string, toNodeId: string): GraphEdgeRow {
  return {
    id, companyId, projectId, fromNodeId, toNodeId,
    relationshipType: 'RELATED_TO', source: 'EXPLICIT', confidence: 1, evidence: {},
    createdAt: '', updatedAt: '',
  };
}

/**
 * Simulates risk_graph_nodes/risk_graph_edges as an in-memory graph rather
 * than a canned response, the same technique used in
 * workforce-visibility.util.spec.ts, since this sandbox has no real
 * Postgres available for the tests CI actually runs (see .github/workflows/
 * ci.yml -- "test in this repo mocks its DB/storage/queue dependencies").
 * This lets the traversal logic itself be genuinely exercised against a
 * constructed graph shape, not just against a hand-written expected result.
 */
function makeGraphSql(edges: GraphEdgeRow[], nodes: GraphNodeRow[]) {
  return jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('');
    if (text.includes('FROM risk_graph_edges') && text.includes('from_node_id = ANY')) {
      const frontier = values[0] as string[];
      return edges.filter(e => frontier.includes(e.fromNodeId) || frontier.includes(e.toNodeId));
    }
    if (text.includes('FROM risk_graph_nodes') && text.includes('id = ANY')) {
      const ids = values[0] as string[];
      return nodes.filter(n => ids.includes(n.id));
    }
    throw new Error(`Unexpected query in test mock: ${text}`);
  });
}

function makeDb(sqlMock: jest.Mock): DatabaseService {
  return { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) } as unknown as DatabaseService;
}

describe('RiskGraphService.getNeighborhood — bounded graph traversal (Scenario H: long risk chain)', () => {
  it('correctly identifies every node reachable through a long connected chain', async () => {
    // A -> B -> C -> D -> E -> F (a 6-node chain, well within default bounds)
    const nodes = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => makeNode(id, 'issue'));
    const edges = [
      makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'C'), makeEdge('e3', 'C', 'D'),
      makeEdge('e4', 'D', 'E'), makeEdge('e5', 'E', 'F'),
    ];
    const sqlMock = makeGraphSql(edges, nodes);
    const svc = new RiskGraphService(makeDb(sqlMock));

    const result = await svc.getNeighborhood(companyId, 'A', { maxDepth: 10 });

    expect(result.nodes.map(n => n.id).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(result.edges).toHaveLength(5);
  });

  it('stops expanding once maxDepth is reached, even if the graph continues further', async () => {
    const nodes = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => makeNode(id, 'issue'));
    const edges = [
      makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'C'), makeEdge('e3', 'C', 'D'),
      makeEdge('e4', 'D', 'E'), makeEdge('e5', 'E', 'F'),
    ];
    const sqlMock = makeGraphSql(edges, nodes);
    const svc = new RiskGraphService(makeDb(sqlMock));

    // depth 2 from A should reach A, B, C only (2 hops)
    const result = await svc.getNeighborhood(companyId, 'A', { maxDepth: 2 });

    expect(result.nodes.map(n => n.id).sort()).toEqual(['A', 'B', 'C']);
  });

  it('stops expanding once maxNodes is reached, even with more graph left to explore', async () => {
    // A star graph: A connects to 10 different nodes.
    const leaves = Array.from({ length: 10 }, (_, i) => `leaf${i}`);
    const nodes = ['A', ...leaves].map(id => makeNode(id, 'issue'));
    const edges = leaves.map((leaf, i) => makeEdge(`e${i}`, 'A', leaf));
    const sqlMock = makeGraphSql(edges, nodes);
    const svc = new RiskGraphService(makeDb(sqlMock));

    const result = await svc.getNeighborhood(companyId, 'A', { maxDepth: 10, maxNodes: 5 });

    expect(result.nodes.length).toBeLessThanOrEqual(5);
  });

  it('never visits or returns a node from a disconnected part of the graph', async () => {
    const nodes = [makeNode('A', 'issue'), makeNode('B', 'issue'), makeNode('Z', 'rfi')];
    const edges = [makeEdge('e1', 'A', 'B')]; // Z is isolated
    const sqlMock = makeGraphSql(edges, nodes);
    const svc = new RiskGraphService(makeDb(sqlMock));

    const result = await svc.getNeighborhood(companyId, 'A', { maxDepth: 10 });

    expect(result.nodes.map(n => n.id).sort()).toEqual(['A', 'B']);
  });
});

describe('RiskGraphService — tenant scoping', () => {
  it('always resolves queries through withTenant with the caller\'s companyId, never a raw query', async () => {
    const sqlMock = makeGraphSql([], []);
    const db = makeDb(sqlMock);
    const svc = new RiskGraphService(db);

    await svc.getNeighborhood('company-42', 'root', {});

    expect(db.withTenant).toHaveBeenCalledWith('company-42', expect.any(Function));
  });
});
