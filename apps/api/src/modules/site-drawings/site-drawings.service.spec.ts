import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SiteDrawingsService } from './site-drawings.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import { SiteDrawingLocalAdapter } from './adapters/local-adapter';
import { SiteDrawingAdapterRegistry } from './adapters/site-drawing-adapter-registry';
import type { SiteDrawingSharePointAdapter } from './adapters/sharepoint-adapter';
import type { NotificationsService } from '../notifications/notifications.service';

type WithTenantCallback = (sql: unknown) => unknown;

// A "step" models one this.db.withTenant(companyId, ...) call, in the exact
// order the service under test issues them; single() for a call whose
// callback issues exactly one statement (`sql => sql\`...\``), multi() for a
// call whose async callback issues several in sequence (SELECT, INSERT,
// conditional UPDATE, final UPDATE, ...). Mirrors DrawingsService's own
// spec file's call-count-aware mocking convention, extended to also handle
// a multi-statement callback body.
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

describe('SiteDrawingsService', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const userId = 'user-1';
  const drawingId = 'drawing-1';

  function makeService(withTenantSteps: ((callback: WithTenantCallback) => unknown)[]) {
    let call = 0;
    const withTenant = jest.fn((_companyId: string, callback: WithTenantCallback) => {
      const step = withTenantSteps[call];
      call += 1;
      if (!step) throw new Error(`withTenant called more times (${call}) than this test provided steps for`);
      return step(callback);
    });
    const db = { withTenant } as unknown as DatabaseService;
    const storage = {
      getObjectSize: jest.fn().mockResolvedValue(1024),
      deleteIfExists: jest.fn().mockResolvedValue(undefined),
      getReadUrl: jest.fn().mockResolvedValue('https://signed.example/file.pdf'),
      generateKey: jest.fn().mockReturnValue('company-1/documents/project-1/abc.pdf'),
      getUploadUrl: jest.fn().mockResolvedValue({ uploadUrl: 'https://upload.example', storageKey: 'key' }),
    } as unknown as StorageService;
    const localAdapter = new SiteDrawingLocalAdapter();
    const sharePointAdapter = { provider: 'sharepoint' } as unknown as SiteDrawingSharePointAdapter; // unused by any test here; satisfies the registry's constructor only
    const adapters = new SiteDrawingAdapterRegistry(localAdapter, sharePointAdapter);
    const create = jest.fn().mockResolvedValue(undefined);
    const notifications = { create } as unknown as NotificationsService;
    return { svc: new SiteDrawingsService(db, storage, adapters, notifications), withTenant, storage, notificationsCreate: create };
  }

  describe('addRevision', () => {
    it('acceptance test 5: supersedes the previous current revision and updates the drawing pointer', async () => {
      const previousRevisionId = 'revision-old';
      const newRevisionId = 'revision-new';

      const { svc, withTenant, notificationsCreate } = makeService([
        single([{ id: projectId }]), // assertProjectBelongsToCompany
        multi([
          [{ id: drawingId, currentRevisionId: previousRevisionId, drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan' }], // SELECT drawing
          [{ id: newRevisionId, workflowStatus: 'APPROVED_FOR_CONSTRUCTION', isSuperseded: false }], // INSERT revision
          [], // UPDATE previous revision -> superseded
          [{ id: drawingId, currentRevisionId: newRevisionId, currentWorkflowStatus: 'APPROVED_FOR_CONSTRUCTION', currentIsSuperseded: false, drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan' }], // UPDATE drawing
        ]),
        single([{ userId: 'member-1' }, { userId: userId }]), // notifyProjectMembers: SELECT project_members
      ]);

      const result = await svc.addRevision(companyId, projectId, drawingId, userId, {
        revisionNumber: 'C', workflowStatus: 'APPROVED_FOR_CONSTRUCTION', storageKey: 'key.pdf',
      });

      expect(result.currentRevision?.id).toBe(newRevisionId);
      expect(result.currentIsSuperseded).toBe(false);
      expect(withTenant).toHaveBeenCalledTimes(3);
      // Notified the other member, but never the actor (userId) who made the change.
      expect(notificationsCreate).toHaveBeenCalledTimes(1);
      expect(notificationsCreate).toHaveBeenCalledWith(companyId, expect.objectContaining({ userId: 'member-1', type: 'site_drawing_revision_added' }));
    });

    it('rejects a file that exceeds the size limit and deletes the orphaned upload', async () => {
      const { svc, storage } = makeService([single([{ id: projectId }])]);
      (storage.getObjectSize as jest.Mock).mockResolvedValue(500 * 1024 * 1024);

      await expect(
        svc.addRevision(companyId, projectId, drawingId, userId, { revisionNumber: 'C', workflowStatus: 'UNDER_REVIEW', storageKey: 'key.pdf' }),
      ).rejects.toThrow(BadRequestException);
      expect(storage.deleteIfExists).toHaveBeenCalledWith('key.pdf');
    });
  });

  describe('setWorkflowStatus', () => {
    const revisionId = 'revision-1';

    it('404s when the revision does not exist on this drawing/project', async () => {
      const { svc } = makeService([
        single([{ id: projectId }]), // assertProjectBelongsToCompany
        multi([[]]), // UPDATE ... RETURNING * -- nothing matched
      ]);
      await expect(svc.setWorkflowStatus(companyId, projectId, drawingId, revisionId, 'APPROVED', userId)).rejects.toThrow(NotFoundException);
    });

    it('updates the drawing\'s own current status when this is its current revision, and notifies every other project member', async () => {
      const { svc, withTenant, notificationsCreate } = makeService([
        single([{ id: projectId }]), // assertProjectBelongsToCompany
        multi([
          [{ id: revisionId, revisionNumber: 'B', workflowStatus: 'APPROVED' }], // UPDATE revision RETURNING *
          [{ currentRevisionId: revisionId, drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan' }], // SELECT drawing
          [], // UPDATE site_drawings.current_workflow_status
        ]),
        single([{ userId: 'member-1' }, { userId: 'member-2' }, { userId }]), // notifyProjectMembers
      ]);

      const result = await svc.setWorkflowStatus(companyId, projectId, drawingId, revisionId, 'APPROVED', userId);

      expect(result.workflowStatus).toBe('APPROVED');
      expect(withTenant).toHaveBeenCalledTimes(3);
      expect(notificationsCreate).toHaveBeenCalledTimes(2); // every member except the actor
      expect(notificationsCreate).not.toHaveBeenCalledWith(companyId, expect.objectContaining({ userId }));
      expect(notificationsCreate).toHaveBeenCalledWith(companyId, expect.objectContaining({
        userId: 'member-1', type: 'site_drawing_status_changed', resourceType: 'site_drawing', resourceId: drawingId,
      }));
    });
  });

  describe('getAuthorizedDownloadUrl', () => {
    it('throws NotFoundException for a revision outside the given project (no cross-project leak)', async () => {
      const { svc } = makeService([
        single([{ id: projectId }]), // assertProjectBelongsToCompany
        single([]), // revision lookup finds nothing
      ]);

      await expect(svc.getAuthorizedDownloadUrl(companyId, projectId, userId, 'revision-x')).rejects.toThrow(NotFoundException);
    });

    it('returns a short-lived (15 min) presigned URL and the revision\'s workflow status, and writes an access-audit row', async () => {
      const { svc, storage, withTenant } = makeService([
        single([{ id: projectId }]),
        single([{ id: 'revision-1', storageKey: 'key.pdf', workflowStatus: 'APPROVED_FOR_CONSTRUCTION', isSuperseded: false }]),
        single([]), // writeAccessAudit's own withTenant call
      ]);

      const result = await svc.getAuthorizedDownloadUrl(companyId, projectId, userId, 'revision-1');

      expect(result.expiresInSeconds).toBe(900);
      expect(result.workflowStatus).toBe('APPROVED_FOR_CONSTRUCTION');
      expect(storage.getReadUrl).toHaveBeenCalledWith('key.pdf', 900);
      expect(withTenant).toHaveBeenCalledTimes(3);
    });
  });

  describe('revalidateOfflinePackage', () => {
    it('acceptance test 10: marks an offline package stale once its revision has been superseded', async () => {
      const { svc } = makeService([
        multi([
          [{ id: 'pkg-1', revisionId: 'revision-1', userId, status: 'COMPLETE' }], // SELECT package
          [{ id: 'revision-1', isSuperseded: true, workflowStatus: 'APPROVED_FOR_CONSTRUCTION' }], // SELECT revision
          [{ id: 'pkg-1', status: 'STALE' }], // UPDATE package
        ]),
      ]);

      const result = await svc.revalidateOfflinePackage(companyId, userId, 'pkg-1');

      expect(result.isStale).toBe(true);
      expect(result.package.status).toBe('STALE');
    });

    it('acceptance test 9/10: a withdrawn revision is also flagged stale even if not formally superseded', async () => {
      const { svc } = makeService([
        multi([
          [{ id: 'pkg-1', revisionId: 'revision-1', userId, status: 'COMPLETE' }],
          [{ id: 'revision-1', isSuperseded: false, workflowStatus: 'WITHDRAWN' }],
          [{ id: 'pkg-1', status: 'STALE' }],
        ]),
      ]);

      const result = await svc.revalidateOfflinePackage(companyId, userId, 'pkg-1');
      expect(result.isStale).toBe(true);
    });

    it('leaves a current, approved-for-construction package alone', async () => {
      const { svc } = makeService([
        multi([
          [{ id: 'pkg-1', revisionId: 'revision-1', userId, status: 'COMPLETE' }],
          [{ id: 'revision-1', isSuperseded: false, workflowStatus: 'APPROVED_FOR_CONSTRUCTION' }],
          [{ id: 'pkg-1', status: 'COMPLETE' }],
        ]),
      ]);

      const result = await svc.revalidateOfflinePackage(companyId, userId, 'pkg-1');
      expect(result.isStale).toBe(false);
    });
  });

  describe('exportRegister', () => {
    it('rejects a project that does not belong to the caller\'s company', async () => {
      const { svc } = makeService([single([])]);
      await expect(svc.exportRegister(companyId, 'someone-elses-project', {})).rejects.toThrow(NotFoundException);
    });

    it('builds a workbook from every matching row, named after the project code, never just the current page', async () => {
      const drawingRow = {
        id: drawingId, companyId, projectId, drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan',
        discipline: 'Architectural', buildingOrZone: null, floorOrLevel: null, sourceProvider: 'internal',
        sourceFileId: 'file-1', sourceWebUrl: null, currentRevisionId: 'revision-1', currentWorkflowStatus: 'APPROVED_FOR_CONSTRUCTION',
        currentIsSuperseded: false, createdBy: userId, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        revisionId: 'revision-1', revisionNumber: 'B', revisionWorkflowStatus: 'APPROVED_FOR_CONSTRUCTION', sourceStatusRaw: null,
        issueDate: '2026-01-01', sourceModifiedAt: null, lastVerifiedAt: null, contentHash: null, storageKey: 'key', sourceRevisionId: null,
        revisionSourceWebUrl: null, fileSizeBytes: 1024, supersedesRevisionId: null, isSuperseded: false, offlineEligibility: true,
        synchronizationStatus: 'NOT_APPLICABLE', uploadedBy: userId, documentClassification: 'CONSTRUCTION', suitabilityCode: null,
        extractionStatus: 'MANUAL', extractedFieldsRaw: null, importBatchId: null, reviewNotes: null,
        revisionCreatedAt: '2026-01-01T00:00:00Z', revisionUpdatedAt: '2026-01-01T00:00:00Z',
      };
      const { svc } = makeService([
        single([{ id: projectId }]), // assertProjectBelongsToCompany
        multi([
          [{ name: 'M4 Tower', code: 'M4T' }], // project lookup
          [drawingRow], // the register query (every matching row, no LIMIT/OFFSET)
        ]),
      ]);

      const { buffer, filename } = await svc.exportRegister(companyId, projectId, {});
      expect(filename).toContain('M4T');
      expect(filename.endsWith('.xlsx')).toBe(true);
      expect(buffer.byteLength).toBeGreaterThan(0); // a real, non-empty .xlsx buffer
    });
  });
});
