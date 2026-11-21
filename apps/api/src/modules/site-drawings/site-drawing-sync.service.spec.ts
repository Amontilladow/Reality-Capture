import { SiteDrawingSyncService } from './site-drawing-sync.service';
import type { DatabaseService } from '../../database/database.service';
import type { SiteDrawingAdapterRegistry } from './adapters/site-drawing-adapter-registry';
import type { DrawingSourceAdapter, DiscoveredDrawing } from './adapters/drawing-source-adapter.interface';

type WithTenantCallback = (sql: unknown) => unknown;

// Same call-count-aware convention site-drawings.service.spec.ts already
// uses; one step per this.db.withTenant(companyId, ...) call, in the
// exact order the service under test issues them.
function single(result: unknown) {
  return (callback: WithTenantCallback) => callback(() => Promise.resolve(result));
}
function multi(results: unknown[]) {
  return (callback: WithTenantCallback) => {
    let i = 0;
    const sql = () => Promise.resolve(results[i++] ?? []);
    return callback(sql);
  };
}

function makeService(withTenantSteps: ((callback: WithTenantCallback) => unknown)[], adapter: Partial<DrawingSourceAdapter>) {
  let call = 0;
  const withTenant = jest.fn((_companyId: string, callback: WithTenantCallback) => {
    const step = withTenantSteps[call];
    call += 1;
    if (!step) throw new Error(`withTenant called more times (${call}) than this test provided steps for`);
    return step(callback);
  });
  const withSystemBypass = jest.fn();
  const db = { withTenant, withSystemBypass } as unknown as DatabaseService;
  const registry = { resolve: () => adapter as DrawingSourceAdapter } as unknown as SiteDrawingAdapterRegistry;
  return { svc: new SiteDrawingSyncService(db, registry), withTenant, withSystemBypass };
}

const companyId = 'company-1';
const projectId = 'project-1';

function discovered(overrides: Partial<DiscoveredDrawing> = {}): DiscoveredDrawing {
  return { sourceFileId: 'item-1', drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan', revisionNumber: 'B', ...overrides };
}

describe('SiteDrawingSyncService', () => {
  describe('syncProject', () => {
    it('creates a new drawing and revision for a source file not already in the register, under a drawing number never seen before', async () => {
      const { svc, withTenant } = makeService([
        // reconcileDrawing: SELECT existingRevision (none), SELECT sameNumberDrawing (none),
        // INSERT drawing, INSERT revision, UPDATE current_revision_id
        multi([[], [], [{ id: 'drawing-1' }], [{ id: 'revision-1' }], []]),
        multi([[]]), // markMissingAsWithdrawn: SELECT stale (none)
        single([]), // writeSyncLog
        single([]), // touchConnectionSyncFacts
      ], { listDrawings: jest.fn().mockResolvedValue([discovered()]) });

      const result = await svc.syncProject(companyId, projectId, 'sharepoint');

      expect(result).toEqual({ status: 'SUCCESS', drawingsSeen: 1, drawingsCreated: 1, revisionsCreated: 0, conflictsCreated: 0 });
      expect(withTenant).toHaveBeenCalledTimes(4);
    });

    it('adds a new, superseding revision from the SAME provider when the discovered revision number differs from the current one', async () => {
      const { svc } = makeService([
        multi([
          [{ id: 'revision-old', drawingId: 'drawing-1', revisionNumber: 'B' }], // SELECT existingRevision
          [{ id: 'drawing-1', currentRevisionId: 'revision-old' }],              // SELECT drawing (isCurrent: true)
          [],                                                                     // UPDATE site_drawings metadata
          [{ id: 'revision-new' }],                                              // INSERT new revision
          [],                                                                     // UPDATE old revision -> superseded
          [],                                                                     // UPDATE site_drawings -> current_revision_id
        ]),
        multi([[]]),
        single([]), single([]),
      ], { listDrawings: jest.fn().mockResolvedValue([discovered({ revisionNumber: 'C' })]) });

      const result = await svc.syncProject(companyId, projectId, 'sharepoint');
      expect(result).toEqual({ status: 'SUCCESS', drawingsSeen: 1, drawingsCreated: 0, revisionsCreated: 1, conflictsCreated: 0 });
    });

    it('acceptance test 6 (idempotency): re-verifies without creating a duplicate when the revision number has not changed', async () => {
      const { svc } = makeService([
        multi([
          [{ id: 'revision-1', drawingId: 'drawing-1', revisionNumber: 'B' }],
          [{ id: 'drawing-1', currentRevisionId: 'revision-1' }],
          [], // UPDATE metadata
          [], // UPDATE revision re-verify
          [], // UPDATE current_workflow_status
        ]),
        multi([[]]),
        single([]), single([]),
      ], { listDrawings: jest.fn().mockResolvedValue([discovered({ revisionNumber: 'B' })]) });

      const result = await svc.syncProject(companyId, projectId, 'sharepoint');
      expect(result).toEqual({ status: 'SUCCESS', drawingsSeen: 1, drawingsCreated: 0, revisionsCreated: 0, conflictsCreated: 0 });
    });

    // Site Drawing Hub: cross-source identity fix (migration 087). Found in
    // production: the same physical drawing (M19-...-SD-05729), synced from
    // both Procore and SharePoint, was registering as two separate drawings
    // -- reconcileDrawing()'s old lookup only ever checked
    // (source_provider, source_file_id), so a Procore sync pass could never
    // see a drawing SharePoint had already registered under the same
    // drawing_number, and vice versa.
    describe('cross-source identity (a drawing_number already registered from a DIFFERENT provider)', () => {
      it('auto-promotes a cross-source match as the SAME drawing\'s new current revision when the title matches and the revision is confidently newer', async () => {
        const { svc } = makeService([
          multi([
            [], // SELECT existingRevision (provider='procore', this file never synced before) -- none
            [{ id: 'drawing-1', drawingTitle: 'BS 60 & 90 Min Fire Rated', currentRevisionId: 'revision-sp-1' }], // SELECT sameNumberDrawing (registered earlier from SharePoint)
            [{ id: 'revision-sp-1', revisionNumber: '1' }], // SELECT currentRevision
            [{ id: 'revision-procore-1' }], // INSERT new revision (CONFIRMED, supersedes revision-sp-1)
            [], // UPDATE old revision -> superseded
            [], // UPDATE site_drawings -> current_revision_id
          ]),
          multi([[]]),
          single([]), single([]),
        ], {
          listDrawings: jest.fn().mockResolvedValue([discovered({
            sourceFileId: 'procore-item-9', drawingNumber: 'SD-05729', drawingTitle: 'BS 60 & 90 Min Fire Rated', revisionNumber: '2',
          })]),
        });

        const result = await svc.syncProject(companyId, projectId, 'procore');
        expect(result).toEqual({ status: 'SUCCESS', drawingsSeen: 1, drawingsCreated: 0, revisionsCreated: 1, conflictsCreated: 0 });
      });

      it('leaves a cross-source match un-promoted as a CONFLICT for the Review Queue when the titles disagree, never guessing which is right', async () => {
        const { svc } = makeService([
          multi([
            [], // SELECT existingRevision -- none
            [{ id: 'drawing-2', drawingTitle: 'Single Leaf Steel Door', currentRevisionId: 'revision-sp-2' }], // SELECT sameNumberDrawing
            [{ id: 'revision-sp-2', revisionNumber: '1' }], // SELECT currentRevision
            [{ id: 'revision-procore-2' }], // INSERT new revision (CONFLICT, supersedes_revision_id NULL) -- no promotion follows
          ]),
          multi([[]]),
          single([]), single([]),
        ], {
          listDrawings: jest.fn().mockResolvedValue([discovered({
            sourceFileId: 'procore-item-10', drawingNumber: 'SD-05731', drawingTitle: '03.330.01', revisionNumber: '1',
          })]),
        });

        const result = await svc.syncProject(companyId, projectId, 'procore');
        expect(result).toEqual({ status: 'SUCCESS', drawingsSeen: 1, drawingsCreated: 0, revisionsCreated: 0, conflictsCreated: 1 });
      });

      it('never re-creates a duplicate conflict on a later tick for a file already folded into another provider\'s drawing', async () => {
        // This file was already cross-source-matched onto drawing-1 on an
        // earlier tick, but a THIRD, newer revision from the other provider
        // has since become current -- this provider's own tracked revision
        // is no longer the one driving the register. Its own state is
        // refreshed in place; nothing new is created, and current_revision_id
        // is left completely untouched.
        const { svc, withTenant } = makeService([
          multi([
            [{ id: 'revision-procore-1', drawingId: 'drawing-1', revisionNumber: '2' }], // SELECT existingRevision -- found this time
            [{ id: 'drawing-1', currentRevisionId: 'revision-sp-3' }],                    // SELECT drawing -- NOT current
            [], // UPDATE existingRevision in place
          ]),
          multi([[]]),
          single([]), single([]),
        ], {
          listDrawings: jest.fn().mockResolvedValue([discovered({
            sourceFileId: 'procore-item-9', drawingNumber: 'SD-05729', drawingTitle: 'BS 60 & 90 Min Fire Rated', revisionNumber: '2',
          })]),
        });

        const result = await svc.syncProject(companyId, projectId, 'procore');
        expect(result).toEqual({ status: 'SUCCESS', drawingsSeen: 1, drawingsCreated: 0, revisionsCreated: 0, conflictsCreated: 0 });
        expect(withTenant).toHaveBeenCalledTimes(4); // reconcileDrawing + markMissingAsWithdrawn + writeSyncLog + touchConnectionSyncFacts -- no extra INSERT
      });
    });

    it('marks a drawing WITHDRAWN once it is no longer present in a successful full listing from the provider currently driving its current revision', async () => {
      const { svc, withTenant } = makeService([
        multi([
          [{ id: 'drawing-old', currentRevisionId: 'revision-old' }], // SELECT stale (joined to its current revision's own source_provider)
          [], // UPDATE revision workflow_status -> WITHDRAWN
          [], // UPDATE drawing current_workflow_status -> WITHDRAWN
        ]),
        single([]), single([]),
      ], { listDrawings: jest.fn().mockResolvedValue([]) }); // the library is now empty

      const result = await svc.syncProject(companyId, projectId, 'sharepoint');
      expect(result.drawingsSeen).toBe(0);
      expect(withTenant).toHaveBeenCalledTimes(3); // markMissingAsWithdrawn + writeSyncLog + touchConnectionSyncFacts (no reconcileDrawing calls)
    });

    it('never falsely reports success -- a failed listDrawings() is recorded as FAILED and rethrown, never silently swallowed', async () => {
      const { svc, withTenant } = makeService([
        single([]), // writeSyncLog (FAILED)
        single([]), // touchConnectionSyncFacts (success=false)
      ], { listDrawings: jest.fn().mockRejectedValue(new Error('SharePoint unreachable')) });

      await expect(svc.syncProject(companyId, projectId, 'sharepoint')).rejects.toThrow('SharePoint unreachable');
      expect(withTenant).toHaveBeenCalledTimes(2);
    });

    it('throws immediately for a provider with no registered adapter', async () => {
      const db = { withTenant: jest.fn() } as unknown as DatabaseService;
      const registry = { resolve: () => undefined } as unknown as SiteDrawingAdapterRegistry;
      const svc = new SiteDrawingSyncService(db, registry);
      await expect(svc.syncProject(companyId, projectId, 'aconex')).rejects.toThrow(/No adapter registered/);
    });
  });

  describe('syncAllActiveConnections', () => {
    it('syncs every project of every active connection and counts failures separately, without aborting the sweep', async () => {
      const db = { withTenant: jest.fn(), withSystemBypass: jest.fn() } as unknown as DatabaseService;
      const registry = {} as SiteDrawingAdapterRegistry;
      const svc = new SiteDrawingSyncService(db, registry);

      (db.withSystemBypass as jest.Mock).mockResolvedValue([
        { companyId: 'company-1', config: { projectSites: { 'project-1': {}, 'project-2': {} } } },
        { companyId: 'company-2', config: { projectSites: { 'project-3': {} } } },
      ]);

      const syncProjectSpy = jest.spyOn(svc, 'syncProject')
        .mockResolvedValueOnce({ status: 'SUCCESS', drawingsSeen: 1, drawingsCreated: 1, revisionsCreated: 0, conflictsCreated: 0 })
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ status: 'SUCCESS', drawingsSeen: 0, drawingsCreated: 0, revisionsCreated: 0, conflictsCreated: 0 });

      const result = await svc.syncAllActiveConnections();

      expect(syncProjectSpy).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ projectsSynced: 2, projectsFailed: 1 });
    });
  });
});
