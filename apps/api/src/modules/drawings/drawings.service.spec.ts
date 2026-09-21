import { NotFoundException } from '@nestjs/common';
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
