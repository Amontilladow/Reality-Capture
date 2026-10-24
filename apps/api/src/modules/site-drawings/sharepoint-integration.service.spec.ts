import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SharePointIntegrationService } from './sharepoint-integration.service';
import type { DatabaseService } from '../../database/database.service';
import type { SharePointGraphClient } from './adapters/sharepoint-graph-client';

const companyId = 'company-1';
const projectId = 'project-1';

// Mirrors site-drawings.service.spec.ts's single()/multi() convention --
// one queued result per this.db.withTenant(...) call, in call order. The
// real driver's sql.json()/sql`` are both just functions here; the mock
// never inspects what's passed to them, only returns the next queued row.
function makeDb(results: unknown[]) {
  let i = 0;
  const withTenant = jest.fn((_companyId: string, callback: (sql: unknown) => unknown) => {
    const result = results[i++] ?? [];
    const sql = (() => Promise.resolve(result)) as unknown as { json: (v: unknown) => unknown };
    sql.json = (v: unknown) => v;
    return callback(sql);
  });
  return { withTenant } as unknown as DatabaseService;
}

function makeGraph() {
  return { verifyTenant: jest.fn(), get: jest.fn() } as unknown as SharePointGraphClient & { verifyTenant: jest.Mock; get: jest.Mock };
}

describe('SharePointIntegrationService', () => {
  describe('getStatus', () => {
    it('reports not connected when no doc_integrations row exists', async () => {
      const db = makeDb([[]]);
      const svc = new SharePointIntegrationService(db, makeGraph());
      await expect(svc.getStatus(companyId)).resolves.toEqual({ connected: false, isActive: false, projectSites: {} });
    });

    it('returns the tenant id and project site mappings when connected', async () => {
      const db = makeDb([[{
        config: { tenantId: 'tenant-abc', projectSites: { [projectId]: { siteId: 's1', driveId: 'd1' } } },
        isActive: true, lastSyncedAt: '2026-01-01T00:00:00Z', lastAttemptedSyncAt: '2026-01-02T00:00:00Z', lastSyncError: null,
      }]]);
      const svc = new SharePointIntegrationService(db, makeGraph());
      const status = await svc.getStatus(companyId);
      expect(status.connected).toBe(true);
      expect(status.tenantId).toBe('tenant-abc');
      expect(status.projectSites[projectId]).toEqual({ siteId: 's1', driveId: 'd1' });
      expect(status.lastSuccessfulSyncAt).toBe('2026-01-01T00:00:00Z');
    });
  });

  describe('connect', () => {
    it('verifies the tenant with Microsoft before saving anything', async () => {
      const db = makeDb([[], [{ config: { tenantId: 'tenant-abc', projectSites: {} }, isActive: true, lastSyncedAt: null, lastAttemptedSyncAt: null, lastSyncError: null }]]);
      const graph = makeGraph();
      const svc = new SharePointIntegrationService(db, graph);

      await svc.connect(companyId, { tenantId: 'tenant-abc' });

      expect(graph.verifyTenant).toHaveBeenCalledWith('tenant-abc');
    });

    it('never saves a tenant that fails verification', async () => {
      const db = makeDb([]);
      const graph = makeGraph();
      graph.verifyTenant.mockRejectedValue(new Error('invalid_tenant'));
      const svc = new SharePointIntegrationService(db, graph);

      await expect(svc.connect(companyId, { tenantId: 'bad-tenant' })).rejects.toThrow(BadRequestException);
      expect((db.withTenant as jest.Mock)).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('deactivates the connection without clearing the queue (one UPDATE call)', async () => {
      const db = makeDb([[]]);
      const svc = new SharePointIntegrationService(db, makeGraph());
      await svc.disconnect(companyId);
      expect(db.withTenant).toHaveBeenCalledTimes(1);
    });
  });

  describe('mapProjectSite', () => {
    it('throws when the project does not belong to this company', async () => {
      const db = makeDb([[]]); // assertProjectBelongsToCompany finds nothing
      const svc = new SharePointIntegrationService(db, makeGraph());
      await expect(svc.mapProjectSite(companyId, projectId, { siteId: 's1', driveId: 'd1' })).rejects.toThrow(NotFoundException);
    });

    it('throws when SharePoint is not connected for this company yet', async () => {
      const db = makeDb([
        [{ id: projectId }], // assertProjectBelongsToCompany
        [], // requireConnection finds no active row
      ]);
      const svc = new SharePointIntegrationService(db, makeGraph());
      await expect(svc.mapProjectSite(companyId, projectId, { siteId: 's1', driveId: 'd1' })).rejects.toThrow(/Connect SharePoint/);
    });

    it('validates the drive is reachable before saving the mapping, and never saves one that is not', async () => {
      const db = makeDb([
        [{ id: projectId }],
        [{ config: { tenantId: 'tenant-abc', projectSites: {} } }],
      ]);
      const graph = makeGraph();
      graph.get.mockResolvedValueOnce(null); // drive not found
      const svc = new SharePointIntegrationService(db, graph);

      await expect(svc.mapProjectSite(companyId, projectId, { siteId: 's1', driveId: 'bad-drive' })).rejects.toThrow(BadRequestException);
      expect((db.withTenant as jest.Mock)).toHaveBeenCalledTimes(2); // only the two reads above, never a third (write) call
    });

    it('saves the mapping, omitting unset optional column overrides', async () => {
      const db = makeDb([
        [{ id: projectId }],
        [{ config: { tenantId: 'tenant-abc', projectSites: {} } }],
        [], // the UPDATE
        [{ config: { tenantId: 'tenant-abc', projectSites: { [projectId]: { siteId: 's1', driveId: 'd1', statusField: 'ApprovalStatus' } } }, isActive: true, lastSyncedAt: null, lastAttemptedSyncAt: null, lastSyncError: null }], // getStatus
      ]);
      const graph = makeGraph();
      graph.get.mockResolvedValueOnce({ id: 'd1' });
      const svc = new SharePointIntegrationService(db, graph);

      const result = await svc.mapProjectSite(companyId, projectId, { siteId: 's1', driveId: 'd1', statusField: 'ApprovalStatus' });
      expect(result.projectSites[projectId]).toEqual({ siteId: 's1', driveId: 'd1', statusField: 'ApprovalStatus' });
    });
  });

  describe('unmapProjectSite', () => {
    it('throws when SharePoint is not connected', async () => {
      const db = makeDb([[]]);
      const svc = new SharePointIntegrationService(db, makeGraph());
      await expect(svc.unmapProjectSite(companyId, projectId)).rejects.toThrow(BadRequestException);
    });

    it('removes the mapping when connected', async () => {
      const db = makeDb([
        [{ config: { tenantId: 'tenant-abc', projectSites: { [projectId]: { siteId: 's1', driveId: 'd1' } } } }],
        [],
      ]);
      const svc = new SharePointIntegrationService(db, makeGraph());
      await svc.unmapProjectSite(companyId, projectId);
      expect(db.withTenant).toHaveBeenCalledTimes(2);
    });
  });
});
