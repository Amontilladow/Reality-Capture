import { NotFoundException } from '@nestjs/common';
import { DrawingsService } from './drawings.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';

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
    return { svc: new DrawingsService(db, storage as unknown as StorageService), withTenant, query };
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

      const result = await svc.createPin(companyId, drawingId, { posXNorm: 0.5, posYNorm: 0.5 });

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

      const result = await svc.createPin(companyId, drawingId, { posXNorm: 0.2, posYNorm: 0.3, pageNumber: 3 });

      expect(result.pageNumber).toBe(3);
    });

    it('throws NotFoundException for a drawing that does not exist', async () => {
      const { svc } = makeService({ drawingRow: undefined });
      await expect(svc.createPin(companyId, 'missing', { posXNorm: 0, posYNorm: 0 })).rejects.toThrow(NotFoundException);
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
  });
});
