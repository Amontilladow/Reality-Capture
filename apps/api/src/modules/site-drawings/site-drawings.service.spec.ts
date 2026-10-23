import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SiteDrawingsService } from './site-drawings.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import { SiteDrawingLocalAdapter } from './adapters/local-adapter';

type WithTenantCallback = (sql: unknown) => unknown;

// A "step" models one this.db.withTenant(companyId, ...) call, in the exact
// order the service under test issues them -- single() for a call whose
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
    return { svc: new SiteDrawingsService(db, storage, localAdapter), withTenant, storage };
  }

  describe('addRevision', () => {
    it('acceptance test 5: supersedes the previous current revision and updates the drawing pointer', async () => {
      const previousRevisionId = 'revision-old';
      const newRevisionId = 'revision-new';

      const { svc, withTenant } = makeService([
        single([{ id: projectId }]), // assertProjectBelongsToCompany
        multi([
          [{ id: drawingId, currentRevisionId: previousRevisionId }], // SELECT drawing
          [{ id: newRevisionId, workflowStatus: 'APPROVED_FOR_CONSTRUCTION', isSuperseded: false }], // INSERT revision
          [], // UPDATE previous revision -> superseded
          [{ id: drawingId, currentRevisionId: newRevisionId, currentWorkflowStatus: 'APPROVED_FOR_CONSTRUCTION', currentIsSuperseded: false }], // UPDATE drawing
        ]),
      ]);

      const result = await svc.addRevision(companyId, projectId, drawingId, userId, {
        revisionNumber: 'C', workflowStatus: 'APPROVED_FOR_CONSTRUCTION', storageKey: 'key.pdf',
      });

      expect(result.currentRevision?.id).toBe(newRevisionId);
      expect(result.currentIsSuperseded).toBe(false);
      expect(withTenant).toHaveBeenCalledTimes(2);
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
});
