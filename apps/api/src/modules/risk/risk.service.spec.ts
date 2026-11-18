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

describe('RiskService.recalculateProject — orphan pruning', () => {
  // The real bug this covers: every PR-156-era delete() calls
  // removeEntityNode() going forward, but a deletion made before that
  // wiring existed (or before it reached a given module) left its node
  // behind forever -- extractProject() above only upserts from rows that
  // still exist, so it was never going to notice. This is the retroactive
  // half: recalculateProject() ("Refresh") must now also remove any node
  // whose source row is gone, not just skip touching it.
  it("deletes a node whose entityId findExistingEntityIds says is gone, and leaves one that's still live", async () => {
    const graph = {
      getNodesByProject: jest.fn((_companyId: string, _projectId: string, nodeTypes: string[]) => {
        if (nodeTypes.length === 1 && nodeTypes[0] === 'rfi') {
          return Promise.resolve([
            { id: 'node-gone', entityId: 'rfi-gone', nodeType: 'rfi' },
            { id: 'node-live', entityId: 'rfi-live', nodeType: 'rfi' },
          ]);
        }
        // Every other per-type pruning pass finds nothing, and the final
        // full-list call (for the recalculateForNode loop) finds nothing
        // either, so that loop never runs in this test.
        return Promise.resolve([]);
      }),
      deleteNode: jest.fn().mockResolvedValue(undefined),
    };
    const extraction = {
      extractProject: jest.fn().mockResolvedValue(undefined),
      findExistingEntityIds: jest.fn().mockResolvedValue(new Set(['rfi-live'])),
    };
    const signals = { detectSignalsForProject: jest.fn().mockResolvedValue(undefined) };

    const svc = new RiskService(
      {} as DatabaseService,
      graph as unknown as RiskGraphService,
      extraction as unknown as RelationshipExtractionService,
      signals as unknown as SignalsService,
      {} as ScoringService,
      {} as AiClientService,
      {} as AiUsageService,
    );

    await svc.recalculateProject('company-1', 'project-1');

    expect(extraction.findExistingEntityIds).toHaveBeenCalledWith('company-1', 'rfi', ['rfi-gone', 'rfi-live']);
    expect(graph.deleteNode).toHaveBeenCalledTimes(1);
    expect(graph.deleteNode).toHaveBeenCalledWith('company-1', 'rfi', 'rfi-gone');
  });

  it('skips the existence check entirely for a node type with no nodes at all', async () => {
    const graph = {
      getNodesByProject: jest.fn().mockResolvedValue([]),
      deleteNode: jest.fn(),
    };
    const extraction = {
      extractProject: jest.fn().mockResolvedValue(undefined),
      findExistingEntityIds: jest.fn(),
    };
    const signals = { detectSignalsForProject: jest.fn().mockResolvedValue(undefined) };

    const svc = new RiskService(
      {} as DatabaseService,
      graph as unknown as RiskGraphService,
      extraction as unknown as RelationshipExtractionService,
      signals as unknown as SignalsService,
      {} as ScoringService,
      {} as AiClientService,
      {} as AiUsageService,
    );

    await svc.recalculateProject('company-1', 'project-1');

    expect(extraction.findExistingEntityIds).not.toHaveBeenCalled();
    expect(graph.deleteNode).not.toHaveBeenCalled();
  });
});
