import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RfisService } from './rfis.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { StorageService } from '../storage/storage.service';
import type { MessagingService } from '../messaging/messaging.service';
import type { CreateRfiDto } from './dto/create-rfi.dto';

// Generic tagged-template mock for this.db.withTenant's `sql` callback --
// records every call (reconstructed text + interpolated values) and lets
// each test supply a responder keyed off substrings of the query text.
// Mirrors issues.service.spec.ts's own makeQuery/withTenant convention
// exactly (see describe('forward')/describe('forceStatus') there):
// RfisService never calls this.db.query() directly, only this.db.withTenant(),
// so a single shared query mock forwarded through withTenant covers every
// method under test here.
function makeQuery(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve(responder(text, values) ?? []);
  });
  return { query: query as unknown as DatabaseService['query'], calls };
}

function makeService(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
  const { query, calls } = makeQuery(responder);
  const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
  // paginate() is plain synchronous JS, not a DB call -- stub it with the
  // same shape DatabaseService.paginate returns.
  const paginate = jest.fn((rows: unknown[], page: number, perPage: number) => ({
    data: rows, total: rows.length, page, perPage, totalPages: Math.ceil(rows.length / perPage) || 1,
  }));
  const db = { withTenant, paginate };
  const notifications = { create: jest.fn() };
  const storage = {};
  const messaging = { create: jest.fn() };
  const svc = new RfisService(
    db as unknown as DatabaseService,
    notifications as unknown as NotificationsService,
    storage as unknown as StorageService,
    messaging as unknown as MessagingService,
  );
  return { svc, calls, notifications, db };
}

describe('RfisService', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const rfiId = 'rfi-1';

  // ══════════════════════════════════════════════════════════════════════
  // Numbering + create()
  // ══════════════════════════════════════════════════════════════════════
  describe('create', () => {
    function makeCreateService(existingCountForDiscipline: number) {
      return makeService((text) => {
        if (text.includes('SELECT code, org_code FROM projects')) {
          return [{ code: 'p162', orgCode: 'csc' }];
        }
        if (text.includes('SELECT COUNT(*) AS n FROM rfis WHERE project_id')) {
          return [{ n: String(existingCountForDiscipline) }];
        }
        if (text.includes('INSERT INTO rfis')) {
          return [{
            id: 'rfi-new', rfiNumber: 'P162-CSC-RFI-STR-0186', subject: 'Test subject',
            status: 'open', discipline: 'structural',
          }];
        }
        return undefined;
      });
    }

    it('formats the RFI number as {ProjectCode}-{OrgCode}-RFI-{DisciplineCode}-{seq}, zero-padded to 4 digits', async () => {
      const { svc, calls } = makeCreateService(185);

      await svc.create(companyId, projectId, 'user-1', {
        subject: 'Beam clash at gridline C4',
        question: 'Please confirm the correct beam depth.',
        discipline: 'structural',
      } as CreateRfiDto);

      const insertCall = calls.find((c) => c.text.includes('INSERT INTO rfis'));
      expect(insertCall).toBeDefined();
      // values = [companyId, projectId, rfiNumber, subject, question, ...]
      expect(insertCall!.values[2]).toBe('P162-CSC-RFI-STR-0186');
    });

    it("always defaults status to 'open' regardless of dto contents", async () => {
      const { svc, calls } = makeCreateService(0);

      const result = await svc.create(companyId, projectId, 'user-1', {
        subject: 'Beam clash at gridline C4',
        question: 'Please confirm the correct beam depth.',
        discipline: 'structural',
      } as CreateRfiDto);

      const insertCall = calls.find((c) => c.text.includes('INSERT INTO rfis'));
      // 'open' is a literal in the INSERT statement (CreateRfiDto has no
      // status field at all), so it's always present in the query text
      // itself, not conditionally interpolated.
      expect(insertCall!.text).toContain("'open'");
      expect(result.status).toBe('open');
    });

    it('derives the *Level column from a legacy boolean when only the boolean is provided, keeping both in sync', async () => {
      const { svc, calls } = makeCreateService(0);

      await svc.create(companyId, projectId, 'user-1', {
        subject: 'Beam clash at gridline C4',
        question: 'Please confirm the correct beam depth.',
        discipline: 'structural',
        costImpact: true,
        timeImpact: false,
      } as CreateRfiDto);

      const insertCall = calls.find((c) => c.text.includes('INSERT INTO rfis'));
      // values = [companyId, projectId, rfiNumber, subject, question, priority,
      //   discipline, disciplineOther, costImpactBool, timeImpactBool,
      //   costImpactLevel, costImpactAmount, costImpactCurrency, costImpactDescription,
      //   timeImpactLevel, timeImpactDays, timeImpactDescription, assignedTo, dueDate, userId]
      expect(insertCall!.values[8]).toBe(true);   // cost_impact (bool)
      expect(insertCall!.values[10]).toBe('yes'); // cost_impact_level (derived)
      expect(insertCall!.values[9]).toBe(false);  // time_impact (bool)
      expect(insertCall!.values[14]).toBe('no');  // time_impact_level (derived)
    });

    it('derives the legacy boolean from the *Level column when only the level is provided, keeping both in sync', async () => {
      const { svc, calls } = makeCreateService(0);

      await svc.create(companyId, projectId, 'user-1', {
        subject: 'Beam clash at gridline C4',
        question: 'Please confirm the correct beam depth.',
        discipline: 'structural',
        costImpactLevel: 'potential',
        timeImpactLevel: 'yes',
      } as CreateRfiDto);

      const insertCall = calls.find((c) => c.text.includes('INSERT INTO rfis'));
      expect(insertCall!.values[10]).toBe('potential'); // cost_impact_level
      expect(insertCall!.values[8]).toBe(false);         // cost_impact bool ('potential' !== 'yes')
      expect(insertCall!.values[14]).toBe('yes');        // time_impact_level
      expect(insertCall!.values[9]).toBe(true);          // time_impact bool
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // findAll — new filter params
  // ══════════════════════════════════════════════════════════════════════
  describe('findAll', () => {
    function findAllRows() {
      return [{ id: 'rfi-1', subject: 'A', fullCount: '1' }];
    }

    it('resolves without throwing when discipline is set', async () => {
      const { svc } = makeService((text) => (text.includes('FROM rfis r') ? findAllRows() : undefined));
      await expect(svc.findAll(companyId, projectId, { discipline: 'structural' })).resolves.toBeDefined();
    });

    it('resolves without throwing when costImpactLevel is set', async () => {
      const { svc } = makeService((text) => (text.includes('FROM rfis r') ? findAllRows() : undefined));
      await expect(svc.findAll(companyId, projectId, { costImpactLevel: 'potential' })).resolves.toBeDefined();
    });

    it('resolves without throwing when timeImpactLevel is set', async () => {
      const { svc } = makeService((text) => (text.includes('FROM rfis r') ? findAllRows() : undefined));
      await expect(svc.findAll(companyId, projectId, { timeImpactLevel: 'tbd' })).resolves.toBeDefined();
    });

    it('resolves without throwing when assignedTo is set', async () => {
      const { svc } = makeService((text) => (text.includes('FROM rfis r') ? findAllRows() : undefined));
      await expect(svc.findAll(companyId, projectId, { assignedTo: 'user-9' })).resolves.toBeDefined();
    });

    it('resolves without throwing when dateFrom/dateTo are set', async () => {
      const { svc } = makeService((text) => (text.includes('FROM rfis r') ? findAllRows() : undefined));
      await expect(svc.findAll(companyId, projectId, {
        dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2026-12-31T23:59:59.000Z',
      })).resolves.toBeDefined();
    });

    it('passes every new filter value into the query args, not just accepting them silently', async () => {
      const { svc, calls } = makeService((text) => (text.includes('FROM rfis r') ? findAllRows() : undefined));

      await svc.findAll(companyId, projectId, {
        discipline: 'structural', costImpactLevel: 'yes', timeImpactLevel: 'tbd',
        assignedTo: 'user-9', dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2026-12-31T23:59:59.000Z',
      });

      const listCall = calls.find((c) => c.text.includes('FROM rfis r'));
      expect(listCall).toBeDefined();
      // values = [projectId, companyId, status, status, priority, priority,
      //   discipline, discipline, costImpactLevel, costImpactLevel,
      //   timeImpactLevel, timeImpactLevel, assignedTo, assignedTo,
      //   dateFrom, dateFrom, dateTo, dateTo, perPage, offset]
      expect(listCall!.values).toContain('structural');
      expect(listCall!.values).toContain('yes');
      expect(listCall!.values).toContain('tbd');
      expect(listCall!.values).toContain('user-9');
      expect(listCall!.values).toContain('2026-01-01T00:00:00.000Z');
      expect(listCall!.values).toContain('2026-12-31T23:59:59.000Z');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // submit() — draft -> submitted
  // ══════════════════════════════════════════════════════════════════════
  describe('submit', () => {
    it("the creator, with no permission grant at all, can submit their own draft RFI", async () => {
      const { svc, calls, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-1', status: 'draft', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes('query_stamp IS NOT NULL')) {
          return [{ n: '0' }];
        }
        if (text.includes('query_stamp = ')) {
          return [{ id: rfiId, status: 'submitted', queryStamp: 'P1-ORG-RFI-CIV-0001-Q-001', assignedTo: null }];
        }
        return undefined;
      });

      const result = await svc.submit(companyId, projectId, rfiId, 'user-1');

      expect(result.status).toBe('submitted');
      expect(result.queryStamp).toBe('P1-ORG-RFI-CIV-0001-Q-001');

      const updateCall = calls.find((c) => c.text.includes('query_stamp = '));
      // values = [queryStamp, rfiId, projectId, companyId]
      expect(updateCall!.values[0]).toBe('P1-ORG-RFI-CIV-0001-Q-001');

      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall).toBeDefined();
      // values = [companyId, projectId, userId, action, rfiId, resourceLabel, changesJson, metadataJson]
      expect(auditCall!.values[3]).toBe('rfi.submitted');

      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('a non-creator with no grant, no project_lead role, and no super_admin role is rejected with ForbiddenException', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'draft', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj' }];
        }
        if (text.includes('SELECT company_role FROM users')) {
          return [{ companyRole: 'member' }];
        }
        if (text.includes('SELECT role FROM project_members')) {
          return [{ role: 'member' }];
        }
        if (text.includes('SELECT id FROM project_permission_grants')) {
          return [];
        }
        return undefined;
      });

      await expect(svc.submit(companyId, projectId, rfiId, 'user-other')).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when called on a non-'draft' RFI, even for the creator", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-1', status: 'submitted', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj' }];
        }
        return undefined;
      });

      await expect(svc.submit(companyId, projectId, rfiId, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // requestClarification()
  // ══════════════════════════════════════════════════════════════════════
  describe('requestClarification', () => {
    it("moves a 'submitted' RFI to 'awaiting_clarification' and writes the audit row", async () => {
      const { svc, calls, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'submitted', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes("awaiting_clarification")) {
          return [{ id: rfiId, status: 'awaiting_clarification' }];
        }
        return undefined;
      });

      const result = await svc.requestClarification(companyId, projectId, rfiId, 'user-reviewer', { reason: 'Need more info' });

      expect(result.status).toBe('awaiting_clarification');
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.clarification_requested');
      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'rfi_clarification_requested' }));
    });

    it("throws BadRequestException from a terminal status such as 'closed'", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'closed', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj' }];
        }
        return undefined;
      });

      await expect(
        svc.requestClarification(companyId, projectId, rfiId, 'user-reviewer', { reason: 'Need more info' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // respond()
  // ══════════════════════════════════════════════════════════════════════
  describe('respond', () => {
    it("moves an 'awaiting_clarification' RFI to 'responded' and writes TWO distinct audit rows", async () => {
      const { svc, calls, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'awaiting_clarification', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes('answer_stamp IS NOT NULL')) {
          return [{ n: '0' }];
        }
        if (text.includes('answer_stamp = ')) {
          return [{ id: rfiId, status: 'responded', answerStamp: 'P1-ORG-RFI-CIV-0001-A-001', answer: 'Use 450mm depth', assignedTo: null }];
        }
        return undefined;
      });

      const result = await svc.respond(companyId, projectId, rfiId, 'user-reviewer', { answer: 'Use 450mm depth' });

      expect(result.status).toBe('responded');
      expect(result.answerStamp).toBe('P1-ORG-RFI-CIV-0001-A-001');

      const auditCalls = calls.filter((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCalls).toHaveLength(2);
      expect(auditCalls[0].values[3]).toBe('rfi.response_submitted');
      expect(auditCalls[1].values[3]).toBe('rfi.answer_stamp_generated');
      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'rfi_responded' }));
    });

    it("throws BadRequestException from a terminal status such as 'closed'", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'closed', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj' }];
        }
        return undefined;
      });

      await expect(svc.respond(companyId, projectId, rfiId, 'user-reviewer', { answer: 'Use 450mm depth' })).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // close()
  // ══════════════════════════════════════════════════════════════════════
  describe('close', () => {
    it("closes a 'responded' RFI and writes the 'rfi.closed' audit row", async () => {
      const { svc, calls, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'responded', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes("UPDATE rfis SET status = 'closed'")) {
          return [{ id: rfiId, status: 'closed' }];
        }
        return undefined;
      });

      const result = await svc.close(companyId, projectId, rfiId, 'user-reviewer');

      expect(result.status).toBe('closed');
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.closed');
      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'rfi_closed' }));
    });

    it('throws BadRequestException when the RFI is already in a terminal status', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'closed', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj' }];
        }
        return undefined;
      });

      await expect(svc.close(companyId, projectId, rfiId, 'user-reviewer')).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // reopen()
  // ══════════════════════════════════════════════════════════════════════
  describe('reopen', () => {
    it("reopens a 'closed' RFI back to 'responded' and writes the 'rfi.reopened' audit row", async () => {
      const { svc, calls, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'closed', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes("UPDATE rfis SET status = 'responded'")) {
          return [{ id: rfiId, status: 'responded' }];
        }
        return undefined;
      });

      const result = await svc.reopen(companyId, projectId, rfiId, 'user-reviewer');

      expect(result.status).toBe('responded');
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.reopened');
      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'rfi_reopened' }));
    });

    it("throws BadRequestException when called on anything other than a 'closed' RFI", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'responded', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj' }];
        }
        return undefined;
      });

      await expect(svc.reopen(companyId, projectId, rfiId, 'user-reviewer')).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // submitForReview() -- new: the previously-missing "PMC/client reviews
  // the answer" transition into 'under_review'.
  // ══════════════════════════════════════════════════════════════════════
  describe('submitForReview', () => {
    it("moves a 'responded' RFI to 'under_review' and writes the 'rfi.review_submitted' audit row", async () => {
      const { svc, calls, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'responded', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes("UPDATE rfis SET status = 'under_review'")) {
          return [{ id: rfiId, status: 'under_review' }];
        }
        return undefined;
      });

      const result = await svc.submitForReview(companyId, projectId, rfiId, 'user-reviewer');

      expect(result.status).toBe('under_review');
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.review_submitted');
      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'rfi_review_submitted' }));
    });

    it("also accepts the legacy 'answered' status, workflow-equivalent to 'responded'", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'answered', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes("UPDATE rfis SET status = 'under_review'")) {
          return [{ id: rfiId, status: 'under_review' }];
        }
        return undefined;
      });

      await expect(svc.submitForReview(companyId, projectId, rfiId, 'user-reviewer')).resolves.toMatchObject({ status: 'under_review' });
    });

    it("throws BadRequestException from a non-responded status such as 'submitted'", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'submitted', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj' }];
        }
        return undefined;
      });

      await expect(svc.submitForReview(companyId, projectId, rfiId, 'user-reviewer')).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // decideReview() -- new: approve closes the RFI, reject sends it back to
  // 'awaiting_clarification' (see the service's own comment for why).
  // ══════════════════════════════════════════════════════════════════════
  describe('decideReview', () => {
    it("approves an 'under_review' RFI, moving it to 'closed' and writing 'rfi.review_approved'", async () => {
      const { svc, calls, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'under_review', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes("UPDATE rfis SET status = ")) {
          return [{ id: rfiId, status: 'closed' }];
        }
        return undefined;
      });

      const result = await svc.decideReview(companyId, projectId, rfiId, 'user-reviewer', { decision: 'approved' });

      expect(result.status).toBe('closed');
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.review_approved');
      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'rfi_review_approved' }));
    });

    it("rejects an 'under_review' RFI, moving it to 'awaiting_clarification' and recording the comment in audit metadata", async () => {
      const { svc, calls, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'under_review', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', assignedTo: null }];
        }
        if (text.includes("UPDATE rfis SET status = ")) {
          return [{ id: rfiId, status: 'awaiting_clarification' }];
        }
        return undefined;
      });

      const result = await svc.decideReview(companyId, projectId, rfiId, 'user-reviewer', { decision: 'rejected', comment: 'Depth still unclear' });

      expect(result.status).toBe('awaiting_clarification');
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.review_rejected');
      // values = [companyId, projectId, userId, action, rfiId, resourceLabel, changesJson, metadataJson]
      expect(auditCall!.values[7]).toContain('Depth still unclear');
      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'rfi_review_rejected' }));
    });

    it("throws BadRequestException when called on anything other than 'under_review'", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, createdBy: 'user-owner', status: 'responded', rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj' }];
        }
        return undefined;
      });

      await expect(
        svc.decideReview(companyId, projectId, rfiId, 'user-reviewer', { decision: 'approved' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Drawing impact -- new: a third impact field (structurally identical to
  // cost/time impact) plus follow-up tracking (owner, applied/not-applied)
  // and the Reports rollup that surfaces it.
  // ══════════════════════════════════════════════════════════════════════
  describe('getKpiBreakdown', () => {
    it('buckets counts by drawing_impact_level and splits the non-no total into applied/notApplied', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('GROUP BY drawing_impact_level')) {
          return [
            { drawingImpactLevel: 'no', count: '10', appliedCount: '0' },
            { drawingImpactLevel: 'yes', count: '3', appliedCount: '1' },
            { drawingImpactLevel: 'potential', count: '2', appliedCount: '2' },
          ];
        }
        return undefined;
      });

      const result = await svc.getKpiBreakdown(companyId, projectId);

      expect(result.byDrawingImpact).toEqual({ no: 10, yes: 3, potential: 2, tbd: 0 });
      expect(result.drawingUpdateStatus).toEqual({ totalRequiringDrawingUpdate: 5, applied: 3, notApplied: 2 });
    });

    it('returns all-zero buckets when the project has no RFIs at all', async () => {
      const { svc } = makeService(() => []);

      const result = await svc.getKpiBreakdown(companyId, projectId);

      expect(result.byDrawingImpact).toEqual({ no: 0, yes: 0, potential: 0, tbd: 0 });
      expect(result.drawingUpdateStatus).toEqual({ totalRequiringDrawingUpdate: 0, applied: 0, notApplied: 0 });
    });
  });

  describe('getDrawingUpdatesNotApplied', () => {
    it('queries only non-no, not-yet-applied RFIs', async () => {
      const { svc, calls } = makeService((text) => {
        if (text.includes('drawing_update_owner_name')) {
          return [{ id: rfiId, rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj', drawingImpactLevel: 'yes', drawingUpdateOwnerName: 'Jane Doe' }];
        }
        return undefined;
      });

      const result = await svc.getDrawingUpdatesNotApplied(companyId, projectId);

      expect(result).toHaveLength(1);
      const listCall = calls.find((c) => c.text.includes('drawing_update_owner_name'));
      expect(listCall!.text).toContain("AND r.drawing_impact_level != 'no' AND r.drawing_update_applied = false");
    });
  });

  describe('markDrawingApplied', () => {
    it("stamps applied_at/applied_by and writes 'rfi.drawing_update_applied'", async () => {
      const { svc, calls } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'yes', drawingUpdateApplied: false }];
        }
        if (text.includes('drawing_update_applied    = true')) {
          return [{ id: rfiId, drawingUpdateApplied: true }];
        }
        return undefined;
      });

      const result = await svc.markDrawingApplied(companyId, projectId, rfiId, 'user-1');

      expect(result.drawingUpdateApplied).toBe(true);
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.drawing_update_applied');
    });

    it("rejects a 'no'-impact RFI rather than silently flipping a flag nothing reads", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'no' }];
        }
        return undefined;
      });

      await expect(svc.markDrawingApplied(companyId, projectId, rfiId, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('markDrawingNotApplied', () => {
    it("clears applied_at/applied_by and writes 'rfi.drawing_update_unapplied'", async () => {
      const { svc, calls } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'yes', drawingUpdateApplied: true }];
        }
        if (text.includes('drawing_update_applied    = false')) {
          return [{ id: rfiId, drawingUpdateApplied: false }];
        }
        return undefined;
      });

      const result = await svc.markDrawingNotApplied(companyId, projectId, rfiId, 'user-1');

      expect(result.drawingUpdateApplied).toBe(false);
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.drawing_update_unapplied');
    });

    it("rejects a 'no'-impact RFI", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'no' }];
        }
        return undefined;
      });

      await expect(svc.markDrawingNotApplied(companyId, projectId, rfiId, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('markDrawingSentToSite', () => {
    it("stamps sent_to_site_at/sent_to_site_by and writes 'rfi.drawing_sent_to_site'", async () => {
      const { svc, calls } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'yes', drawingUpdateSentToSite: false }];
        }
        if (text.includes('drawing_update_sent_to_site    = true')) {
          return [{ id: rfiId, drawingUpdateSentToSite: true }];
        }
        return undefined;
      });

      const result = await svc.markDrawingSentToSite(companyId, projectId, rfiId, 'user-1');

      expect(result.drawingUpdateSentToSite).toBe(true);
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.drawing_sent_to_site');
    });

    it("rejects a 'no'-impact RFI", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'no' }];
        }
        return undefined;
      });

      await expect(svc.markDrawingSentToSite(companyId, projectId, rfiId, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('markDrawingNotSentToSite', () => {
    it("clears sent_to_site_at/sent_to_site_by and writes 'rfi.drawing_not_sent_to_site'", async () => {
      const { svc, calls } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'yes', drawingUpdateSentToSite: true }];
        }
        if (text.includes('drawing_update_sent_to_site    = false')) {
          return [{ id: rfiId, drawingUpdateSentToSite: false }];
        }
        return undefined;
      });

      const result = await svc.markDrawingNotSentToSite(companyId, projectId, rfiId, 'user-1');

      expect(result.drawingUpdateSentToSite).toBe(false);
      const auditCall = calls.find((c) => c.text.includes('INSERT INTO audit_log'));
      expect(auditCall!.values[3]).toBe('rfi.drawing_not_sent_to_site');
    });

    it("rejects a 'no'-impact RFI", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'no' }];
        }
        return undefined;
      });

      await expect(svc.markDrawingNotSentToSite(companyId, projectId, rfiId, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('remindDrawingUpdate', () => {
    it('notifies drawing_update_owner_id when one is set', async () => {
      const { svc, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{
            id: rfiId, rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj',
            drawingImpactLevel: 'yes', drawingUpdateApplied: false,
            drawingUpdateOwnerId: 'user-owner', assignedTo: 'user-assignee',
          }];
        }
        return undefined;
      });

      await svc.remindDrawingUpdate(companyId, projectId, rfiId, 'user-1');

      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({
        userId: 'user-owner',
        type: 'rfi_drawing_update_reminder',
        resourceType: 'rfi',
        resourceId: rfiId,
      }));
    });

    it('falls back to assigned_to when no drawing_update_owner_id is set', async () => {
      const { svc, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{
            id: rfiId, rfiNumber: 'P1-ORG-RFI-CIV-0001', subject: 'Subj',
            drawingImpactLevel: 'yes', drawingUpdateApplied: false,
            drawingUpdateOwnerId: null, assignedTo: 'user-assignee',
          }];
        }
        return undefined;
      });

      await svc.remindDrawingUpdate(companyId, projectId, rfiId, 'user-1');

      expect(notifications.create).toHaveBeenCalledWith(companyId, expect.objectContaining({ userId: 'user-assignee' }));
    });

    it('rejects with a clear error instead of silently no-opping when neither owner nor assignee is set', async () => {
      const { svc, notifications } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{
            id: rfiId, subject: 'Subj', drawingImpactLevel: 'yes', drawingUpdateApplied: false,
            drawingUpdateOwnerId: null, assignedTo: null,
          }];
        }
        return undefined;
      });

      await expect(svc.remindDrawingUpdate(companyId, projectId, rfiId, 'user-1')).rejects.toThrow(BadRequestException);
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it("rejects a 'no'-impact RFI", async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'no' }];
        }
        return undefined;
      });

      await expect(svc.remindDrawingUpdate(companyId, projectId, rfiId, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-applied drawing update', async () => {
      const { svc } = makeService((text) => {
        if (text.includes('FROM rfis r')) {
          return [{ id: rfiId, subject: 'Subj', drawingImpactLevel: 'yes', drawingUpdateApplied: true }];
        }
        return undefined;
      });

      await expect(svc.remindDrawingUpdate(companyId, projectId, rfiId, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });
});
