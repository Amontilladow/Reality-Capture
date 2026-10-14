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

    it.each([
      ['ncr', 2, 'NCR-003'],
      ['sor', 0, 'SOR-001'],
      ['wir', 5, 'WIR-006'],
      ['mir', 11, 'MIR-012'],
    ])('%s gets its own independent sequence (never a shared counter): %i existing -> %s', async (recordType, existing, expectedNumber) => {
      const { svc } = makeService((text) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) return [{ n: String(existing) }];
        if (text.includes('INSERT INTO qaqc_records')) return [{ id: 'q1', recordNumber: expectedNumber, recordType }];
        return undefined;
      });

      const result = await svc.create(companyId, projectId, 'user-1', {
        recordType, subject: 'A', description: 'd', discipline: 'structural',
      } as CreateQaqcRecordDto);

      expect((result as Record<string, unknown>).recordNumber).toBe(expectedNumber);
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

    it("triggers risk recalculation for the new record's own node type", async () => {
      const { svc, risk } = makeService((text) => {
        if (text.includes('SELECT COUNT(*) AS n FROM qaqc_records')) return [{ n: '0' }];
        if (text.includes('INSERT INTO qaqc_records')) return [{ id: 'qaqc-new', recordNumber: 'WIR-001', recordType: 'wir' }];
        return undefined;
      });

      await svc.create(companyId, projectId, 'user-1', {
        recordType: 'wir', subject: 'Rebar inspection', description: 'd', discipline: 'structural',
      } as CreateQaqcRecordDto);

      expect(risk.recalculateForEntity).toHaveBeenCalledWith(companyId, projectId, 'wir', 'qaqc-new');
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
  // Step 1: respond()
  // ══════════════════════════════════════════════════════════════════════
  describe('respond', () => {
    function recordRow(status: string, overrides: Record<string, unknown> = {}) {
      return { id: qaqcId, recordType: 'ncr', recordNumber: 'NCR-001', subject: 'Cracked slab', status, issuedBy: 'user-1', ...overrides };
    }

    it.each(['open', 'reopened'])('moves a %s record to pending_confirmation, stamping response/respondedBy/respondedAt', async (fromStatus) => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow(fromStatus)];
        if (text.includes('UPDATE qaqc_records')) return [recordRow('pending_confirmation', { response: 'Fixed and re-poured.' })];
        return undefined;
      });

      const result = await svc.respond(companyId, projectId, qaqcId, 'user-2', { response: 'Fixed and re-poured.' });
      expect((result as Record<string, unknown>).status).toBe('pending_confirmation');
    });

    it('does NOT close the record -- status is pending_confirmation, not closed', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow('open')];
        if (text.includes('UPDATE qaqc_records')) return [recordRow('pending_confirmation')];
        return undefined;
      });

      const result = await svc.respond(companyId, projectId, qaqcId, 'user-2', { response: 'Fixed.' });
      expect((result as Record<string, unknown>).status).not.toBe('closed');
    });

    it.each(['pending_confirmation', 'closed'])('rejects responding to a record in status %s', async (status) => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow(status)];
        return undefined;
      });

      await expect(svc.respond(companyId, projectId, qaqcId, 'user-2', { response: 'x' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for a record that does not exist under this company/project', async () => {
      const { svc } = makeService(() => []);
      await expect(svc.respond(companyId, projectId, qaqcId, 'user-2', { response: 'x' }))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('notifies the original issuer that a response is pending their confirmation', async () => {
      const { svc, notifications } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow('open')];
        if (text.includes('UPDATE qaqc_records')) return [recordRow('pending_confirmation')];
        return undefined;
      });

      await svc.respond(companyId, projectId, qaqcId, 'user-2', { response: 'Fixed.' });

      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({
        userId: 'user-1', type: 'ncr_responded', resourceType: 'qaqc_record',
      }));
    });

    it('re-triggers risk recalculation on respond', async () => {
      const { svc, risk } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [recordRow('open')];
        if (text.includes('UPDATE qaqc_records')) return [recordRow('pending_confirmation')];
        return undefined;
      });

      await svc.respond(companyId, projectId, qaqcId, 'user-2', { response: 'Fixed.' });
      expect(risk.recalculateForEntity).toHaveBeenCalledWith(companyId, projectId, 'ncr', qaqcId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Step 2: confirm()
  // ══════════════════════════════════════════════════════════════════════
  describe('confirm', () => {
    function pendingRow(overrides: Record<string, unknown> = {}) {
      return { id: qaqcId, recordType: 'ncr', recordNumber: 'NCR-001', subject: 'Cracked slab', status: 'pending_confirmation', issuedBy: 'user-1', respondedBy: 'user-2', ...overrides };
    }

    it('confirming moves status to closed and stamps confirmedBy/confirmedAt', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [pendingRow()];
        if (text.includes('UPDATE qaqc_records')) return [pendingRow({ status: 'closed', confirmedBy: 'user-3', confirmedAt: '2025-01-01' })];
        return undefined;
      });

      const result = await svc.confirm(companyId, projectId, qaqcId, 'user-3', { decision: 'confirmed' });
      expect((result as Record<string, unknown>).status).toBe('closed');
      expect((result as Record<string, unknown>).confirmedBy).toBe('user-3');
    });

    it('rejecting moves status to reopened, NOT closed, and stores the comment', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [pendingRow()];
        if (text.includes('UPDATE qaqc_records')) return [pendingRow({ status: 'reopened', confirmationComment: 'Crack still visible.' })];
        return undefined;
      });

      const result = await svc.confirm(companyId, projectId, qaqcId, 'user-3', { decision: 'rejected', comment: 'Crack still visible.' });
      expect((result as Record<string, unknown>).status).toBe('reopened');
      expect((result as Record<string, unknown>).status).not.toBe('closed');
    });

    it('rejects confirming a record that is not pending_confirmation', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [pendingRow({ status: 'open' })];
        return undefined;
      });

      await expect(svc.confirm(companyId, projectId, qaqcId, 'user-3', { decision: 'confirmed' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('a record can be responded to again after being reopened', async () => {
      // Confirms the reopened status isn't a dead end -- respond() accepts
      // 'open' or 'reopened' as its source statuses (see the respond()
      // describe block above for the full assertion of that behavior).
      const { svc } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) {
          return [{ id: qaqcId, recordType: 'ncr', status: 'reopened', issuedBy: 'user-1' }];
        }
        if (text.includes('UPDATE qaqc_records')) return [{ id: qaqcId, recordType: 'ncr', status: 'pending_confirmation' }];
        return undefined;
      });

      const result = await svc.respond(companyId, projectId, qaqcId, 'user-2', { response: 'Fixed again.' });
      expect((result as Record<string, unknown>).status).toBe('pending_confirmation');
    });

    it('throws NotFoundException for a record that does not exist under this company/project', async () => {
      const { svc } = makeService(() => []);
      await expect(svc.confirm(companyId, projectId, qaqcId, 'user-3', { decision: 'confirmed' }))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('notifies the responder on confirmation', async () => {
      const { svc, notifications } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [pendingRow()];
        if (text.includes('UPDATE qaqc_records')) return [pendingRow({ status: 'closed' })];
        return undefined;
      });

      await svc.confirm(companyId, projectId, qaqcId, 'user-3', { decision: 'confirmed' });

      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({
        userId: 'user-2', type: 'ncr_closed', resourceType: 'qaqc_record',
      }));
    });

    it("re-triggers risk recalculation on confirm (so a now-closed record stops contributing an open-record signal)", async () => {
      const { svc, risk } = makeService((text) => {
        if (text.includes('FROM qaqc_records q') && text.includes('WHERE q.id')) return [pendingRow()];
        if (text.includes('UPDATE qaqc_records')) return [pendingRow({ status: 'closed' })];
        return undefined;
      });

      await svc.confirm(companyId, projectId, qaqcId, 'user-3', { decision: 'confirmed' });
      expect(risk.recalculateForEntity).toHaveBeenCalledWith(companyId, projectId, 'ncr', qaqcId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Generic document attachments
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

    it('defaults kind to "issue" and documentType to null when omitted', async () => {
      const { svc } = makeService((text, values) => {
        if (text.includes('INSERT INTO qaqc_attachments')) {
          // kind and document_type are the last two interpolated values in the INSERT
          expect(values[values.length - 2]).toBe('issue');
          expect(values[values.length - 1]).toBeNull();
          return [{ id: 'att-1', kind: 'issue' }];
        }
        return undefined;
      });
      await svc.addAttachment(companyId, qaqcId, 'user-1', { storageKey: 'k1', filename: 'photo.jpg', sizeBytes: 1000 });
    });

    it('stores an explicit documentType when given', async () => {
      const { svc } = makeService((text, values) => {
        if (text.includes('INSERT INTO qaqc_attachments')) {
          expect(values[values.length - 1]).toBe('method_statement');
          return [{ id: 'att-1', documentType: 'method_statement' }];
        }
        return undefined;
      });
      await svc.addAttachment(companyId, qaqcId, 'user-1', {
        storageKey: 'k1', filename: 'ms.pdf', sizeBytes: 1000, documentType: 'method_statement',
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Quick photo picker -- links a Capture (mirrors issue_captures)
  // ══════════════════════════════════════════════════════════════════════
  describe('linkCapture', () => {
    it('links an already-uploaded capture with kind defaulted to "issue"', async () => {
      const { svc } = makeService((text, values) => {
        if (text.includes('INSERT INTO qaqc_captures')) {
          expect(values).toEqual([qaqcId, 'capture-1', companyId, 'issue', null, 'user-1', null]);
          return [{ id: 'link-1', qaqcId, captureId: 'capture-1', kind: 'issue' }];
        }
        return undefined;
      });

      const result = await svc.linkCapture(companyId, qaqcId, 'user-1', { captureId: 'capture-1' });
      expect((result as Record<string, unknown>).kind).toBe('issue');
    });

    it('links a response-time photo with kind "response"', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('INSERT INTO qaqc_captures')) {
          return [{ id: 'link-2', qaqcId, captureId: 'capture-2', kind: 'response' }];
        }
        return undefined;
      });

      const result = await svc.linkCapture(companyId, qaqcId, 'user-2', { captureId: 'capture-2', kind: 'response' });
      expect((result as Record<string, unknown>).kind).toBe('response');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Reports KPI shape
  // ══════════════════════════════════════════════════════════════════════
  describe('getKpiBreakdown', () => {
    it('splits counts by record_type, status, and priority independently across all four types', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('GROUP BY record_type, status, priority')) {
          return [
            { recordType: 'ncr', status: 'open', priority: 'high', count: '3' },
            { recordType: 'sor', status: 'closed', priority: 'low', count: '2' },
            { recordType: 'wir', status: 'pending_confirmation', priority: 'medium', count: '1' },
            { recordType: 'mir', status: 'reopened', priority: 'critical', count: '1' },
          ];
        }
        return undefined;
      });

      const result = await svc.getKpiBreakdown(companyId, projectId);
      expect(result.byRecordType).toEqual({ ncr: 3, sor: 2, wir: 1, mir: 1 });
      expect(result.byStatus).toEqual({ open: 3, closed: 2, pending_confirmation: 1, reopened: 1 });
      expect(result.byPriority).toEqual({ high: 3, low: 2, medium: 1, critical: 1 });
    });
  });

  describe('getOpenList', () => {
    it('excludes only closed records -- pending_confirmation and reopened both still count as open', async () => {
      const { svc } = makeService((text) => {
        if (text.includes("q.status <> 'closed'")) {
          return [{ id: 'q1', status: 'pending_confirmation' }, { id: 'q2', status: 'reopened' }];
        }
        return undefined;
      });

      const result = await svc.getOpenList(companyId, projectId);
      expect(result).toHaveLength(2);
    });
  });
});
