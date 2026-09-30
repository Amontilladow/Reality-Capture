import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DrawingsService } from './drawings.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { IssuesService } from '../issues/issues.service';

describe('DrawingsService pin page_number', () => {
  const companyId = 'company-1';
  const drawingId = 'drawing-1';

  function makeService(opts: {
    drawingRow?: Record<string, unknown> | undefined;
    withTenantResult?: Record<string, unknown>[];
    insertedPin?: Record<string, unknown>;
  }) {
    const query = jest.fn().mockResolvedValue(opts.insertedPin ? [opts.insertedPin] : []);
    // createPin() now makes two withTenant calls (the drawing lookup, then the
    // locations INSERT -- previously the INSERT went through plain this.db.query).
    // First call resolves the canned drawing/getPins row; any call after that
    // forwards to the query mock, so it still only ever sees the INSERT.
    let callCount = 0;
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(opts.drawingRow !== undefined ? [opts.drawingRow] : (opts.withTenantResult ?? []));
      }
      return fn(query);
    });
    const db = { withTenant, query } as unknown as DatabaseService;
    const storage = { resolveUrls: jest.fn().mockResolvedValue(new Map()) };
    const issues = { create: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
    return {
      svc: new DrawingsService(db, storage as unknown as StorageService, issues as unknown as IssuesService),
      withTenant,
      query,
      issues,
    };
  }

  describe('createPin', () => {
    it('defaults pageNumber to 1 when the caller does not specify one', async () => {
      const { svc, query } = makeService({
        drawingRow: { id: drawingId, levelId: 'level-1' },
        insertedPin: {
          id: 'pin-1', name: 'Untitled pin', posXNorm: 0.5, posYNorm: 0.5,
          pageNumber: 1, createdVia: 'floor_plan_tap', createdAt: '2026-08-03T00:00:00Z',
        },
      });

      const result = await svc.createPin(companyId, drawingId, 'user-1', { posXNorm: 0.5, posYNorm: 0.5 });

      expect(result.pageNumber).toBe(1);
      const insertSql = (query.mock.calls[0][0] as TemplateStringsArray).join('');
      expect(insertSql).toContain('page_number');
      // Values passed alongside the template: [..., posXNorm, posYNorm, pageNumber(=1), ...]
      expect(query.mock.calls[0]).toContain(1);
    });

    it('persists a specific pageNumber when the caller places a pin on a later page', async () => {
      const { svc } = makeService({
        drawingRow: { id: drawingId, levelId: 'level-1' },
        insertedPin: {
          id: 'pin-2', name: 'Untitled pin', posXNorm: 0.2, posYNorm: 0.3,
          pageNumber: 3, createdVia: 'floor_plan_tap', createdAt: '2026-08-03T00:00:00Z',
        },
      });

      const result = await svc.createPin(companyId, drawingId, 'user-1', { posXNorm: 0.2, posYNorm: 0.3, pageNumber: 3 });

      expect(result.pageNumber).toBe(3);
    });

    it('throws NotFoundException for a drawing that does not exist', async () => {
      const { svc } = makeService({ drawingRow: undefined });
      await expect(svc.createPin(companyId, 'missing', 'user-1', { posXNorm: 0, posYNorm: 0 })).rejects.toThrow(NotFoundException);
    });

    it('forwards assignedTo straight through to the auto-created Issue', async () => {
      const { svc, issues } = makeService({
        drawingRow: { id: drawingId, levelId: 'level-1' },
        insertedPin: {
          id: 'pin-3', name: 'Untitled pin', posXNorm: 0.5, posYNorm: 0.5,
          pageNumber: 1, createdVia: 'floor_plan_tap', createdAt: '2026-08-03T00:00:00Z',
        },
      });

      const result = await svc.createPin(companyId, drawingId, 'user-1', {
        posXNorm: 0.5, posYNorm: 0.5, assignedTo: 'user-engineer',
      });

      expect(issues.create).toHaveBeenCalledWith(
        companyId, undefined, 'user-1',
        expect.objectContaining({ assignedTo: 'user-engineer' }),
      );
      expect(result.assignedTo).toBe('user-engineer');
    });

    it('leaves assignedTo undefined when the caller does not specify one', async () => {
      const { svc, issues } = makeService({
        drawingRow: { id: drawingId, levelId: 'level-1' },
        insertedPin: {
          id: 'pin-4', name: 'Untitled pin', posXNorm: 0.5, posYNorm: 0.5,
          pageNumber: 1, createdVia: 'floor_plan_tap', createdAt: '2026-08-03T00:00:00Z',
        },
      });

      const result = await svc.createPin(companyId, drawingId, 'user-1', { posXNorm: 0.5, posYNorm: 0.5 });

      expect(issues.create).toHaveBeenCalledWith(
        companyId, undefined, 'user-1',
        expect.objectContaining({ assignedTo: undefined }),
      );
      expect(result.assignedTo).toBeUndefined();
    });
  });

  describe('getPins', () => {
    it('includes pageNumber on every returned pin', async () => {
      const { svc } = makeService({
        withTenantResult: [
          { locationId: 'pin-1', name: 'A', posXNorm: 0.1, posYNorm: 0.1, pageNumber: 1, captureCount: 0 },
          { locationId: 'pin-2', name: 'B', posXNorm: 0.4, posYNorm: 0.6, pageNumber: 2, captureCount: 0 },
        ],
      });

      const pins = await svc.getPins(companyId, drawingId);

      expect(pins.map((p: Record<string, unknown>) => p.pageNumber)).toEqual([1, 2]);
    });

    it("takes the linked issue's assignee when a pin has both an issue and (somehow) a snag id, and falls back to the snag's assignee otherwise", async () => {
      const { svc } = makeService({
        withTenantResult: [
          { locationId: 'pin-1', name: 'A', posXNorm: 0.1, posYNorm: 0.1, pageNumber: 1, captureCount: 0, linkedIssueId: 'issue-1', linkedIssueAssignedTo: 'user-a', linkedSnagId: null, linkedSnagAssignedTo: null },
          { locationId: 'pin-2', name: 'B', posXNorm: 0.4, posYNorm: 0.6, pageNumber: 1, captureCount: 0, linkedIssueId: null, linkedIssueAssignedTo: null, linkedSnagId: 'snag-1', linkedSnagAssignedTo: 'user-b' },
        ],
      });

      const pins = await svc.getPins(companyId, drawingId);

      expect(pins.map((p: Record<string, unknown>) => p.assignedTo)).toEqual(['user-a', 'user-b']);
    });
  });
});

// getUploadUrl() never had a client-declared size to check (it only takes a
// filename); create() is the sole place where a drawing's storage key is
// ever persisted, so real size enforcement happens there against the
// object actually sitting in storage. Also covers the project-ownership
// check that was previously entirely absent (drawings.controller.ts has no
// @RequireProjectPermission gate at all).
describe('DrawingsService upload enforcement', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';

  function makeUploadService(opts: {
    projectExists?: boolean;
    actualSizeBytes: number | null;
  }) {
    const projectExists = opts.projectExists ?? true;
    const withTenant = jest.fn()
      .mockResolvedValueOnce(projectExists ? [{ id: projectId }] : [])
      .mockResolvedValueOnce([{ id: 'drawing-1', title: 'Level 3 Plan' }]);
    const db = { withTenant };
    const getObjectSize = jest.fn().mockResolvedValue(opts.actualSizeBytes);
    const deleteIfExists = jest.fn().mockResolvedValue(undefined);
    const generateKey = jest.fn().mockReturnValue('company-1/drawings/project-1/plan.pdf');
    const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put' });
    const storage = { getObjectSize, deleteIfExists, generateKey, getUploadUrl };
    const issues = {};
    const svc = new DrawingsService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      issues as unknown as IssuesService,
    );
    return { svc, getObjectSize, deleteIfExists, getUploadUrl };
  }

  describe('getUploadUrl', () => {
    it("rejects a project that does not belong to the caller's company", async () => {
      const { svc, getUploadUrl } = makeUploadService({ projectExists: false, actualSizeBytes: 1024 });
      await expect(svc.getUploadUrl(companyId, 'someone-elses-project', 'plan.pdf')).rejects.toThrow(NotFoundException);
      expect(getUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const baseDto = { title: 'Level 3 Plan', storageKey: 'company-1/drawings/project-1/plan.pdf' };

    it('registers a drawing whose real uploaded size is within the 100 MB limit', async () => {
      const { svc, deleteIfExists } = makeUploadService({ actualSizeBytes: 10 * 1024 * 1024 });
      const drawing = await svc.create(companyId, projectId, 'user-1', baseDto);
      expect(drawing).toEqual({ id: 'drawing-1', title: 'Level 3 Plan' });
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('rejects and deletes an uploaded drawing that exceeds the 100 MB limit', async () => {
      const { svc, deleteIfExists } = makeUploadService({ actualSizeBytes: 101 * 1024 * 1024 });
      await expect(svc.create(companyId, projectId, 'user-1', baseDto)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).toHaveBeenCalledWith(baseDto.storageKey);
    });

    it('rejects registration when the declared storage key was never actually uploaded', async () => {
      const { svc, deleteIfExists } = makeUploadService({ actualSizeBytes: null });
      await expect(svc.create(companyId, projectId, 'user-1', baseDto)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it("rejects registration against a project that does not belong to the caller's company", async () => {
      const { svc, getObjectSize } = makeUploadService({ projectExists: false, actualSizeBytes: 1024 });
      await expect(svc.create(companyId, 'someone-elses-project', 'user-1', baseDto)).rejects.toThrow(NotFoundException);
      expect(getObjectSize).not.toHaveBeenCalled();
    });
  });
});
