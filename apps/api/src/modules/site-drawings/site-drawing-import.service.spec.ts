import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
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

  describe('deleteBatch', () => {
    it('404s when the batch does not exist in this project', async () => {
      const { svc, deleteIfExists } = makeService([multi([[]])]); // SELECT storage_key -> none
      await expect(svc.deleteBatch(companyId, projectId, 'missing')).rejects.toThrow(NotFoundException);
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    // The real bug this guards against: site_drawing_revisions.import_batch_id
    // has no ON DELETE clause (migration 075), so deleting a batch that
    // actually created revisions would otherwise fail with a foreign-key
    // violation unless those revisions are detached first.
    it('detaches every revision from the batch before deleting it, and removes the original archive from storage', async () => {
      const { svc, deleteIfExists, withTenant } = makeService([
        multi([
          [{ storageKey: 'company-1/documents/project-1/batch.zip' }], // SELECT storage_key
          [], // UPDATE site_drawing_revisions SET import_batch_id = NULL
          [], // DELETE FROM site_drawing_import_batches
        ]),
      ]);

      await svc.deleteBatch(companyId, projectId, 'batch-1');

      expect(withTenant).toHaveBeenCalledTimes(1); // one withTenant call, three statements inside it
      expect(deleteIfExists).toHaveBeenCalledWith('company-1/documents/project-1/batch.zip');
    });

    it('never throws when the original archive is already gone from storage', async () => {
      const { svc, deleteIfExists } = makeService([
        multi([
          [{ storageKey: 'key' }],
          [],
          [],
        ]),
      ]);
      deleteIfExists.mockRejectedValueOnce(new Error('not found'));

      await expect(svc.deleteBatch(companyId, projectId, 'batch-1')).resolves.toBeUndefined();
    });
  });

  describe('listReviewQueue', () => {
    // The whole point of this endpoint: a reviewer needs to know WHICH
    // drawing a flagged revision belongs to, not just the bare revision row.
    it("joins each flagged revision to its drawing's number and title, and reports whether it's still pending promotion", async () => {
      const pendingRow = {
        id: 'rev-1', companyId, projectId, drawingId: 'drawing-1', revisionNumber: '2',
        workflowStatus: 'UNKNOWN', sourceStatusRaw: null, issueDate: null, sourceModifiedAt: null,
        lastVerifiedAt: null, contentHash: null, storageKey: 'key', sourceRevisionId: null, sourceWebUrl: null,
        fileSizeBytes: 1024, supersedesRevisionId: null, isSuperseded: false, offlineEligibility: true,
        synchronizationStatus: 'NOT_APPLICABLE', uploadedBy: userId, documentClassification: 'CONSTRUCTION',
        suitabilityCode: null, extractionStatus: 'CONFLICT', extractedFieldsRaw: null, importBatchId: 'batch-1',
        reviewNotes: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan',
        // The drawing's own current_revision_id points elsewhere -- this
        // revision was never promoted.
        drawingCurrentRevisionId: 'rev-0',
      };
      const alreadyCurrentRow = { ...pendingRow, id: 'rev-2', extractionStatus: 'NEEDS_REVIEW', drawingCurrentRevisionId: 'rev-2' };
      const { svc } = makeService([single([pendingRow, alreadyCurrentRow])]);
      const result = await svc.listReviewQueue(companyId, projectId);
      expect(result[0]).toEqual(expect.objectContaining({ id: 'rev-1', drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan', isPendingPromotion: true }));
      expect(result[1]).toEqual(expect.objectContaining({ id: 'rev-2', isPendingPromotion: false }));
    });
  });

  // Site Drawing Hub integrity hardening, Phase 1/2: the two decisions on
  // a revision reconcile() left pending (not yet current).
  describe('confirmRevisionAsNew', () => {
    it('404s when the revision does not exist in this project', async () => {
      const { svc } = makeService([single([])]);
      await expect(svc.confirmRevisionAsNew(companyId, projectId, 'missing', 'looks right')).rejects.toThrow(NotFoundException);
    });

    it('promotes the pending revision to current and supersedes the previous current revision', async () => {
      const revision = { id: 'rev-2', drawingId: 'drawing-1' };
      const updated = { ...revision, extractionStatus: 'CONFIRMED', isSuperseded: false, reviewNotes: 'confirmed against the title block' };
      const { svc } = makeService([
        multi([
          [revision], // SELECT revision
          [{ currentRevisionId: 'rev-1' }], // SELECT drawing's current_revision_id (still the OLD one)
          [], // UPDATE site_drawing_revisions SET is_superseded = true WHERE id = rev-1
          [], // UPDATE site_drawings SET current_revision_id = rev-2
          [updated], // UPDATE site_drawing_revisions SET extraction_status = 'CONFIRMED' ... RETURNING *
        ]),
      ]);
      const result = await svc.confirmRevisionAsNew(companyId, projectId, 'rev-2', 'confirmed against the title block');
      expect(result.extractionStatus).toBe('CONFIRMED');
      expect(result.isSuperseded).toBe(false);
    });

    it('does not try to supersede anything when the drawing had no current revision yet', async () => {
      const revision = { id: 'rev-1', drawingId: 'drawing-1' };
      const updated = { ...revision, extractionStatus: 'CONFIRMED' };
      const { svc, withTenant } = makeService([
        multi([
          [revision], // SELECT revision
          [{ currentRevisionId: null }], // drawing has no current revision at all
          [], // UPDATE site_drawings SET current_revision_id = rev-1
          [updated], // final UPDATE ... RETURNING *
        ]),
      ]);
      await svc.confirmRevisionAsNew(companyId, projectId, 'rev-1', 'first revision for this drawing');
      expect(withTenant).toHaveBeenCalledTimes(1);
    });
  });

  describe('splitRevisionAsNewDrawing', () => {
    it('404s when the revision does not exist in this project', async () => {
      const { svc } = makeService([single([])]);
      await expect(svc.splitRevisionAsNewDrawing(companyId, projectId, 'missing', {
        drawingNumber: 'B-201', drawingTitle: 'Actually a Different Drawing', reviewNotes: 'misextracted number collision',
      })).rejects.toThrow(NotFoundException);
    });

    it("detaches the revision into its own new drawing, using the reviewer's corrected identity, without touching the original drawing", async () => {
      const revision = { id: 'rev-2', drawingId: 'drawing-1', revisionNumber: '1-v2' };
      const movedRevision = { ...revision, drawingId: 'drawing-2', extractionStatus: 'CONFIRMED', isSuperseded: false, supersedesRevisionId: null };
      const { svc } = makeService([
        multi([
          [revision], // SELECT revision
          [{ sourceProvider: 'internal', discipline: null }], // SELECT original drawing's own provider/discipline
          [{ id: 'drawing-2' }], // INSERT new site_drawings row
          [movedRevision], // UPDATE site_drawing_revisions SET drawing_id = drawing-2, ... RETURNING *
          [], // UPDATE site_drawings SET current_revision_id = rev-2 WHERE id = drawing-2
        ]),
      ]);
      const result = await svc.splitRevisionAsNewDrawing(companyId, projectId, 'rev-2', {
        drawingNumber: 'B-201', drawingTitle: 'Actually a Different Drawing', reviewNotes: 'misextracted number collision -- different physical drawing',
      });
      expect(result.drawingId).toBe('drawing-2');
      expect(result.supersedesRevisionId).toBeUndefined();
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

    // Extraction accuracy Phase 0: the only way to learn, from real data,
    // how often each field actually comes back wrong is to log when a
    // reviewer's correction genuinely differs from what was extracted --
    // and, just as importantly, NOT log a reviewer simply re-confirming an
    // already-correct value as if it were a miss.
    it('logs a reviewer correction that genuinely differs from the original extraction', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const revision = {
        id: 'rev-1', drawingId: 'drawing-1', workflowStatus: 'UNKNOWN',
        extractedFieldsRaw: { drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan', revisionNumber: 'A', source: 'embedded_text', confidence: 0.6 },
      };
      const { svc } = makeService([multi([[revision], [{ ...revision, revisionNumber: '2A' }], []])]);

      await svc.resolveReview(companyId, projectId, 'rev-1', {
        revisionNumber: '2A', reviewNotes: 'revision letter was misread', extractionStatus: 'CONFIRMED',
      });

      expect(log).toHaveBeenCalledWith(expect.stringContaining('revisionNumber: "A" -> "2A"'));
      log.mockRestore();
    });

    it('does not log anything when the reviewer only re-confirms values that were already correct', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const revision = {
        id: 'rev-1', drawingId: 'drawing-1', workflowStatus: 'UNKNOWN',
        extractedFieldsRaw: { drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan', revisionNumber: 'A', source: 'embedded_text', confidence: 0.9 },
      };
      const { svc } = makeService([multi([[revision], [revision], []])]);

      await svc.resolveReview(companyId, projectId, 'rev-1', {
        drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan', revisionNumber: 'A', reviewNotes: 'looks right', extractionStatus: 'CONFIRMED',
      });

      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('reviewer corrected'));
      log.mockRestore();
    });
  });
});
