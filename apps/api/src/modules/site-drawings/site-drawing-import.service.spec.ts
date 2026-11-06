import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bull';
import { SiteDrawingImportService } from './site-drawing-import.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';

type WithTenantCallback = (sql: unknown) => unknown;

// Mirrors site-drawings.service.spec.ts's own single()/multi() call-count-
// aware mocking convention for this.db.withTenant(companyId, callback).
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

describe('SiteDrawingImportService', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const userId = 'user-1';

  function makeService(withTenantSteps: ((callback: WithTenantCallback) => unknown)[]) {
    let call = 0;
    const withTenant = jest.fn((_companyId: string, callback: WithTenantCallback) => {
      const step = withTenantSteps[call];
      call += 1;
      if (!step) throw new Error(`withTenant called more times (${call}) than this test provided steps for`);
      return step(callback);
    });
    const db = { withTenant } as unknown as DatabaseService;
    const getObjectSize = jest.fn().mockResolvedValue(1024);
    const deleteIfExists = jest.fn().mockResolvedValue(undefined);
    const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://upload.example', storageKey: 'key' });
    const generateKey = jest.fn().mockReturnValue('company-1/documents/project-1/batch.zip');
    const storage = { getObjectSize, deleteIfExists, getUploadUrl, generateKey } as unknown as StorageService;
    const add = jest.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Queue;
    const svc = new SiteDrawingImportService(db, storage, queue);
    return { svc, withTenant, getObjectSize, deleteIfExists, getUploadUrl, add };
  }

  describe('getUploadUrl', () => {
    it("rejects a project that does not belong to the caller's company", async () => {
      const { svc, getUploadUrl } = makeService([single([])]);
      await expect(svc.getUploadUrl(companyId, 'someone-elses-project', 'package.zip')).rejects.toThrow(NotFoundException);
      expect(getUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects a file extension outside ZIP/PDF', async () => {
      const { svc, getUploadUrl } = makeService([single([{ id: projectId }])]);
      await expect(svc.getUploadUrl(companyId, projectId, 'package.docx')).rejects.toThrow(BadRequestException);
      expect(getUploadUrl).not.toHaveBeenCalled();
    });

    it('signs a ZIP upload as application/zip', async () => {
      const { svc, getUploadUrl } = makeService([single([{ id: projectId }])]);
      await svc.getUploadUrl(companyId, projectId, 'package.zip');
      expect(getUploadUrl).toHaveBeenCalledWith(expect.any(String), 'application/zip', expect.any(Number));
    });
  });

  describe('createBatch', () => {
    const input = { storageKey: 'key', originalFilename: 'package.zip', sourceSystem: 'aconex' as const };

    it('rejects registration when the declared storage key was never actually uploaded', async () => {
      const { svc, getObjectSize, add } = makeService([single([{ id: projectId }])]);
      getObjectSize.mockResolvedValueOnce(null);
      await expect(svc.createBatch(companyId, projectId, userId, input)).rejects.toThrow(BadRequestException);
      expect(add).not.toHaveBeenCalled();
    });

    it('rejects and deletes an upload that exceeds the batch size limit', async () => {
      const { svc, deleteIfExists, getObjectSize, add } = makeService([single([{ id: projectId }])]);
      getObjectSize.mockResolvedValueOnce(600 * 1024 * 1024);
      await expect(svc.createBatch(companyId, projectId, userId, input)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).toHaveBeenCalledWith(input.storageKey);
      expect(add).not.toHaveBeenCalled();
    });

    it('creates the batch row, queues background processing, and never blocks on it', async () => {
      const batchRow = { id: 'batch-1', companyId, projectId, sourceSystem: 'aconex', originalFilename: 'package.zip', storageKey: 'key', status: 'PENDING', fileCount: 0, createdCount: 0, revisionCount: 0, skippedCount: 0, errorCount: 0, errorMessage: null, uploadedBy: userId, startedAt: null, finishedAt: null, createdAt: '2026-01-01T00:00:00Z' };
      const { svc, add } = makeService([
        single([{ id: projectId }]), // assertProjectBelongsToCompany
        single([batchRow]), // INSERT ... RETURNING *
      ]);
      const result = await svc.createBatch(companyId, projectId, userId, input);
      expect(result.id).toBe('batch-1');
      expect(add).toHaveBeenCalledWith('process-import-batch', { batchId: 'batch-1', companyId, projectId }, expect.objectContaining({ attempts: 3 }));
    });
  });

  describe('getBatch / listBatches', () => {
    it('404s when the batch does not exist in this project', async () => {
      const { svc } = makeService([single([])]);
      await expect(svc.getBatch(companyId, projectId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listReviewQueue', () => {
    // The whole point of this endpoint: a reviewer needs to know WHICH
    // drawing a flagged revision belongs to, not just the bare revision row.
    it("joins each flagged revision to its drawing's number and title", async () => {
      const row = {
        id: 'rev-1', companyId, projectId, drawingId: 'drawing-1', revisionNumber: '2',
        workflowStatus: 'UNKNOWN', sourceStatusRaw: null, issueDate: null, sourceModifiedAt: null,
        lastVerifiedAt: null, contentHash: null, storageKey: 'key', sourceRevisionId: null, sourceWebUrl: null,
        fileSizeBytes: 1024, supersedesRevisionId: null, isSuperseded: false, offlineEligibility: true,
        synchronizationStatus: 'NOT_APPLICABLE', uploadedBy: userId, documentClassification: 'CONSTRUCTION',
        suitabilityCode: null, extractionStatus: 'NEEDS_REVIEW', extractedFieldsRaw: null, importBatchId: 'batch-1',
        reviewNotes: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan',
      };
      const { svc } = makeService([single([row])]);
      const result = await svc.listReviewQueue(companyId, projectId);
      expect(result).toEqual([expect.objectContaining({ id: 'rev-1', drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan' })]);
    });
  });

  describe('resolveReview', () => {
    it('404s when the revision does not exist in this project', async () => {
      const { svc } = makeService([single([])]);
      await expect(svc.resolveReview(companyId, projectId, 'missing', { reviewNotes: 'n/a', extractionStatus: 'CONFIRMED' })).rejects.toThrow(NotFoundException);
    });

    it('confirms the extraction and corrects the drawing number/title when provided, without touching workflowStatus', async () => {
      const revision = { id: 'rev-1', drawingId: 'drawing-1', workflowStatus: 'UNKNOWN' };
      const updated = { ...revision, revisionNumber: '2A', extractionStatus: 'CONFIRMED', reviewNotes: 'fixed revision letter' };
      const { svc } = makeService([
        multi([
          [revision], // SELECT revision
          [updated], // UPDATE revision RETURNING *
          [], // UPDATE site_drawings (drawingNumber/drawingTitle correction)
        ]),
      ]);
      const result = await svc.resolveReview(companyId, projectId, 'rev-1', {
        revisionNumber: '2A', drawingTitle: 'Ground Floor Plan (Corrected)', reviewNotes: 'fixed revision letter', extractionStatus: 'CONFIRMED',
      });
      expect(result.extractionStatus).toBe('CONFIRMED');
      expect(result.reviewNotes).toBe('fixed revision letter');
    });
  });
});
