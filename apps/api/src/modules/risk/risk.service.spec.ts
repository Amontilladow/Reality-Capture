import { RiskService } from './risk.service';
import type { RiskGraphService } from './risk-graph.service';
import type { DatabaseService } from '../../database/database.service';
import type { RelationshipExtractionService } from './relationship-extraction.service';
import type { SignalsService } from './signals.service';
import type { ScoringService } from './scoring.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import type { AiUsageService } from '../ai/ai-usage.service';

// The other six dependencies are never exercised by removeEntityNode();
// stubbed out purely so the constructor is satisfied.
function makeService(graph: { deleteNode: jest.Mock }) {
  return new RiskService(
    {} as DatabaseService,
    graph as unknown as RiskGraphService,
    {} as RelationshipExtractionService,
    {} as SignalsService,
    {} as ScoringService,
    {} as AiClientService,
    {} as AiUsageService,
  );
}

describe('RiskService.removeEntityNode', () => {
  // The real bug this covers: recalculateForEntity() (the create/update
  // side of event-driven recalculation) upserts a node from the source
  // record's CURRENT row, but nothing ever called the matching removal
  // when that row was deleted -- so a deleted RFI/Issue/Drawing/etc.'s
  // risk, signals and graph edges survived forever, including through a
  // full-project "Refresh". This method is the fix: every module's
  // delete() now calls it.
  it('delegates to RiskGraphService.deleteNode with the given node type and entity id', async () => {
    const graph = { deleteNode: jest.fn().mockResolvedValue(undefined) };
    const svc = makeService(graph);

    await svc.removeEntityNode('company-1', 'rfi', 'rfi-123');

    expect(graph.deleteNode).toHaveBeenCalledWith('company-1', 'rfi', 'rfi-123');
  });

  it('is a no-op, not an error, for an entity that never had a risk node', async () => {
    // deleteNode() itself is just a DELETE ... WHERE node_type = ... AND
    // entity_id = ...; matching zero rows is not an error at the SQL
    // level, so this never throws just because the entity was never
    // risk-worthy or was never extracted into the graph.
    const graph = { deleteNode: jest.fn().mockResolvedValue(undefined) };
    const svc = makeService(graph);

    await expect(svc.removeEntityNode('company-1', 'drawing', 'drawing-never-extracted')).resolves.toBeUndefined();
  });
});
