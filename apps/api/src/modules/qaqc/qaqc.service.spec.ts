import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QaqcService } from './qaqc.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { StorageService } from '../storage/storage.service';
import type { RiskService } from '../risk/risk.service';
import type { CreateQaqcRecordDto } from './dto/create-qaqc-record.dto';

// Same generic tagged-template mock convention as rfis.service.spec.ts's
// own makeQuery/makeService (see that file's comment for the full
// rationale) -- QaqcService never calls this.db.query() directly, only
// this.db.withTenant(), so one shared query mock forwarded through
// withTenant covers every method under test here.
function makeQuery(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve(responder(text, values) ?? []);
  });
  return { query: query as unknown as DatabaseService['query'], calls };
}

function makeService(responder: (text: string, values: unknown[]) => unknown[] | undefined, withRisk = true) {
  const { query, calls } = makeQuery(responder);
  const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
  const paginate = jest.fn((rows: unknown[], page: number, perPage: number) => ({
    data: rows, total: rows.length, page, perPage, totalPages: Math.ceil(rows.length / perPage) || 1,
  }));
  const db = { withTenant, paginate };
  const notifications = { create: jest.fn() };
  const storage = {
    generateKey: jest.fn((_c: string, _p: string, _t: string, filename: string) => `qaqc-attachments/${filename}`),
    getUploadUrl: jest.fn(async (key: string) => ({ uploadUrl: `https://upload/${key}` })),
    getObjectSize: jest.fn(async (): Promise<number | null> => 1000),
    deleteIfExists: jest.fn(),
    resolveUrls: jest.fn(async (keys: string[]) => new Map(keys.map((k) => [k, `https://read/${k}`]))),
    download: jest.fn(async () => Buffer.from('x')),
  };
  const risk = { recalculateForEntity: jest.fn() };
  const svc = new QaqcService(
    db as unknown as DatabaseService,
    notifications as unknown as NotificationsService,
    storage as unknown as StorageService,
    withRisk ? (risk as unknown as RiskService) : undefined,
  );
  return { svc, calls, notifications, storage, risk, db };
}

describe('QaqcService', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const qaqcId = 'qaqc-1';

  // ══════════════════════════════════════════════════════════════════════
  // Numbering + create()
  // ══════════════════════════════════════════════════════════════════════
  describe('create', () => {
    it("formats the record number as {TYPE}-{seq}, zero-padded to 3 digits, scoped per (project, record_type)", async () => {
      const { svc } = makeService((text, values) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) {
          // values: [projectId, recordType] -- confirm the count query is scoped by both.
          expect(values).toEqual([projectId, 'ncr']);
          return [{ n: '4' }];
        }
        if (text.includes('INSERT INTO qaqc_records')) {
          return [{ id: 'qaqc-new', recordNumber: 'NCR-005', recordType: 'ncr', subject: 'Test', issuedBy: 'user-1' }];
        }
        return undefined;
      });

      const result = await svc.create(companyId, projectId, 'user-1', {
        recordType: 'ncr', subject: 'Cracked slab', description: 'Found a crack.', discipline: 'structural',
      } as CreateQaqcRecordDto);

      expect((result as Record<string, unknown>).recordNumber).toBe('NCR-005');
    });

    it('NCR and SOR sequences on the same project are independent (never a shared counter)', async () => {
      const ncrCounts: number[] = [];
      const { svc: ncrSvc } = makeService((text, values) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) {
          ncrCounts.push(values[1] as unknown as number);
          return [{ n: '2' }]; // 2 existing NCRs -> next is NCR-003
        }
        if (text.includes('INSERT INTO qaqc_records')) return [{ id: 'q1', recordNumber: 'NCR-003', recordType: 'ncr' }];
        return undefined;
      });
      const { svc: sorSvc } = makeService((text) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) return [{ n: '0' }]; // 0 existing SORs -> next is SOR-001
        if (text.includes('INSERT INTO qaqc_records')) return [{ id: 'q2', recordNumber: 'SOR-001', recordType: 'sor' }];
        return undefined;
      });

      const ncr = await ncrSvc.create(companyId, projectId, 'user-1', {
        recordType: 'ncr', subject: 'A', description: 'd', discipline: 'structural',
      } as CreateQaqcRecordDto);
      const sor = await sorSvc.create(companyId, projectId, 'user-1', {
        recordType: 'sor', subject: 'B', description: 'd', discipline: 'structural',
      } as CreateQaqcRecordDto);

      expect((ncr as Record<string, unknown>).recordNumber).toBe('NCR-003');
      expect((sor as Record<string, unknown>).recordNumber).toBe('SOR-001');
    });

    it('notifies the assignee when one is given', async () => {
      const { svc, notifications } = makeService((text) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) return [{ n: '0' }];
        if (text.includes('INSERT INTO qaqc_records')) {
          return [{ id: 'qaqc-new', recordNumber: 'NCR-001', recordType: 'ncr', subject: 'Cracked slab' }];
        }
        return undefined;
      });

      await svc.create(companyId, projectId, 'user-1', {
        recordType: 'ncr', subject: 'Cracked slab', description: 'd', discipline: 'structural', assignedTo: 'user-2',
      } as CreateQaqcRecordDto);

      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({
        userId: 'user-2', type: 'ncr_assigned', resourceType: 'qaqc_record',
      }));
    });

    it('does not notify when no assignee is given', async () => {
      const { svc, notifications } = makeService((text) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) return [{ n: '0' }];
        if (text.includes('INSERT INTO qaqc_records')) return [{ id: 'qaqc-new', recordNumber: 'NCR-001', recordType: 'ncr' }];
        return undefined;
      });

      await svc.create(companyId, projectId, 'user-1', {
        recordType: 'ncr', subject: 'Cracked slab', description: 'd', discipline: 'structural',
      } as CreateQaqcRecordDto);

      expect(notifications.create).not.toHaveBeenCalled();
    });

    it("triggers risk recalculation for the new record's own node type (ncr/sor)", async () => {
      const { svc, risk } = makeService((text) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) return [{ n: '0' }];
        if (text.includes('INSERT INTO qaqc_records')) return [{ id: 'qaqc-new', recordNumber: 'SOR-001', recordType: 'sor' }];
        return undefined;
      });

      await svc.create(companyId, projectId, 'user-1', {
        recordType: 'sor', subject: 'Paint defect', description: 'd', discipline: 'architectural',
      } as CreateQaqcRecordDto);

      expect(risk.recalculateForEntity).toHaveBeenCalledWith(companyId, projectId, 'sor', 'qaqc-new');
    });

    it('a risk recalculation failure never fails or blocks the create itself', async () => {
      const { svc, risk } = makeService((text) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) return [{ n: '0' }];
        if (text.includes('INSERT INTO qaqc_records')) return [{ id: 'qaqc-new', recordNumber: 'NCR-001', recordType: 'ncr' }];
        return undefined;
      });
      risk.recalculateForEntity.mockRejectedValue(new Error('graph exploded'));

      await expect(svc.create(companyId, projectId, 'user-1', {
        recordType: 'ncr', subject: 'Cracked slab', description: 'd', discipline: 'structural',
      } as CreateQaqcRecordDto)).resolves.toMatchObject({ id: 'qaqc-new' });
    });

    it('is a no-op (does not throw) when no RiskService is supplied at all', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) return [{ n: '0' }];
        if (text.includes('INSERT INTO qaqc_records')) return [{ id: 'qaqc-new', recordNumber: 'NCR-001', recordType: 'ncr' }];
        return undefined;
      }, false);

      await expect(svc.create(companyId, projectId, 'user-1', {
        recordType: 'ncr', subject: 'Cracked slab', description: 'd', discipline: 'structural',
      } as CreateQaqcRecordDto)).resolves.toMatchObject({ id: 'qaqc-new' });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // findOne / close
  // ══════════════════════════════════════════════════════════════════════
  describe('close', () => {
    function recordRow(status: string, overrides: Record<string, unknown> = {}) {
      return { id: qaqcId, recordType: 'ncr', recordNumber: 'NCR-001', subject: 'Cracked slab', status, issuedBy: 'user-1', ...overrides };
    }

    it('closes an open record, stamping response/closedBy/closedAt', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow('open')];
        if (text.includes('UPDATE qaqc_records')) return [recordRow('closed', { response: 'Fixed and re-poured.' })];
        return undefined;
      });

      const result = await svc.close(companyId, projectId, qaqcId, 'user-2', { response: 'Fixed and re-poured.' });
      expect((result as Record<string, unknown>).status).toBe('closed');
    });

    it('rejects closing a record that is already closed', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow('closed')];
        return undefined;
      });

      await expect(svc.close(companyId, projectId, qaqcId, 'user-2', { response: 'x' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects closing a void record', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow('void')];
        return undefined;
      });

      await expect(svc.close(companyId, projectId, qaqcId, 'user-2', { response: 'x' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for a record that does not exist under this company/project', async () => {
      const { svc } = makeService(() => []);
      await expect(svc.close(companyId, projectId, qaqcId, 'user-2', { response: 'x' }))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('notifies the original issuer when their record is closed by someone else', async () => {
      const { svc, notifications } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow('open')];
        if (text.includes('UPDATE qaqc_records')) return [recordRow('closed')];
        return undefined;
      });

      await svc.close(companyId, projectId, qaqcId, 'user-2', { response: 'Fixed.' });

      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({
        userId: 'user-1', type: 'ncr_closed', resourceType: 'qaqc_record',
      }));
    });

    it("re-triggers risk recalculation on close (so a now-closed record stops contributing an open-record signal)", async () => {
      const { svc, risk } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow('open')];
        if (text.includes('UPDATE qaqc_records')) return [recordRow('closed')];
        return undefined;
      });

      await svc.close(companyId, projectId, qaqcId, 'user-2', { response: 'Fixed.' });
      expect(risk.recalculateForEntity).toHaveBeenCalledWith(companyId, projectId, 'ncr', qaqcId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Attachments
  // ══════════════════════════════════════════════════════════════════════
  describe('attachments', () => {
    it('getAttachmentUploadUrl rejects a disallowed extension', async () => {
      const { svc } = makeService(() => undefined);
      await expect(svc.getAttachmentUploadUrl(companyId, projectId, { filename: 'virus.exe', sizeBytes: 100 }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('getAttachmentUploadUrl rejects a file over the size cap', async () => {
      const { svc } = makeService(() => undefined);
      await expect(svc.getAttachmentUploadUrl(companyId, projectId, { filename: 'photo.jpg', sizeBytes: 999_999_999 }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('getAttachmentUploadUrl accepts an allowed extension within the size cap', async () => {
      const { svc } = makeService(() => undefined);
      const result = await svc.getAttachmentUploadUrl(companyId, projectId, { filename: 'photo.jpg', sizeBytes: 1000 });
      expect(result.storageKey).toContain('qaqc-attachments/');
    });

    it('addAttachment stores the storage key using the verified (not client-declared) size', async () => {
      const { svc, storage } = makeService((text) => {
        if (text.includes('INSERT INTO qaqc_attachments')) {
          return [{ id: 'att-1', qaqcId, storageKey: 'k1', filename: 'photo.jpg', sizeBytes: 1000, kind: 'issue' }];
        }
        return undefined;
      });
      storage.getObjectSize.mockResolvedValue(1000);

      const result = await svc.addAttachment(companyId, qaqcId, 'user-1', {
        storageKey: 'k1', filename: 'photo.jpg', sizeBytes: 1, // deliberately wrong declared size
      });
      expect((result as Record<string, unknown>).sizeBytes).toBe(1000);
    });

    it('addAttachment rejects and cleans up when the real uploaded size exceeds the cap', async () => {
      const { svc, storage } = makeService(() => undefined);
      storage.getObjectSize.mockResolvedValue(999_999_999);

      await expect(svc.addAttachment(companyId, qaqcId, 'user-1', { storageKey: 'k1', filename: 'photo.jpg', sizeBytes: 1 }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(storage.deleteIfExists).toHaveBeenCalledWith('k1');
    });

    it('addAttachment rejects registration when the declared storage key was never actually uploaded', async () => {
      const { svc, storage } = makeService(() => undefined);
      storage.getObjectSize.mockResolvedValue(null);

      await expect(svc.addAttachment(companyId, qaqcId, 'user-1', { storageKey: 'k1', filename: 'photo.jpg', sizeBytes: 1 }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults kind to "issue" when omitted', async () => {
      const { svc } = makeService((text, values) => {
        if (text.includes('INSERT INTO qaqc_attachments')) {
          // kind is the last interpolated value in the INSERT
          expect(values[values.length - 1]).toBe('issue');
          return [{ id: 'att-1', kind: 'issue' }];
        }
        return undefined;
      });
      await svc.addAttachment(companyId, qaqcId, 'user-1', { storageKey: 'k1', filename: 'photo.jpg', sizeBytes: 1000 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Reports KPI shape
  // ══════════════════════════════════════════════════════════════════════
  describe('getKpiBreakdown', () => {
    it('splits counts by record_type, status, and priority independently', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('GROUP BY record_type, status, priority')) {
          return [
            { recordType: 'ncr', status: 'open', priority: 'high', count: '3' },
            { recordType: 'sor', status: 'closed', priority: 'low', count: '2' },
          ];
        }
        return undefined;
      });

      const result = await svc.getKpiBreakdown(companyId, projectId);
      expect(result.byRecordType).toEqual({ ncr: 3, sor: 2 });
      expect(result.byStatus).toEqual({ open: 3, closed: 2 });
      expect(result.byPriority).toEqual({ high: 3, low: 2 });
    });
  });
});
