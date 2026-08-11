import { NotFoundException, BadRequestException } from '@nestjs/common';
import { IssuesService } from './issues.service';
import type { DatabaseService } from '../../database/database.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { StorageService } from '../storage/storage.service';
import type { CreateIssueDto } from './dto/create-issue.dto';

describe('IssuesService view-state / screenshot behavior', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const issueId = 'issue-1';

  function makeService(opts: {
    issueRow?: Record<string, unknown> | undefined;
    getReadUrl?: jest.Mock;
    getUploadUrl?: jest.Mock;
    generateKey?: jest.Mock;
  }) {
    const db = { withTenant: jest.fn().mockResolvedValue(opts.issueRow ? [opts.issueRow] : []) };
    const aiClient = {};
    const notifications = {};
    const storage = {
      getReadUrl: opts.getReadUrl ?? jest.fn().mockResolvedValue('https://presigned.example/read'),
      getUploadUrl: opts.getUploadUrl ?? jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put', storageKey: 'key' }),
      generateKey: opts.generateKey ?? jest.fn().mockReturnValue('company-1/issues/123.png'),
    };
    return new IssuesService(
      db as unknown as DatabaseService,
      aiClient as unknown as AiClientService,
      notifications as unknown as NotificationsService,
      storage as unknown as StorageService,
    );
  }

  describe('findOne', () => {
    it('resolves a screenshotUrl when the issue has a stored screenshot key', async () => {
      const getReadUrl = jest.fn().mockResolvedValue('https://presigned.example/read?sig=abc');
      const svc = makeService({
        issueRow: { id: issueId, title: 'Broken conduit', screenshotStorageKey: 'company-1/issues/456.png' },
        getReadUrl,
      });

      const result = await svc.findOne(companyId, projectId, issueId);

      expect(getReadUrl).toHaveBeenCalledWith('company-1/issues/456.png');
      expect(result.screenshotUrl).toBe('https://presigned.example/read?sig=abc');
    });

    it('does not call storage and has no screenshotUrl when no screenshot was captured', async () => {
      const getReadUrl = jest.fn();
      const svc = makeService({
        issueRow: { id: issueId, title: 'No screenshot here', screenshotStorageKey: null },
        getReadUrl,
      });

      const result = await svc.findOne(companyId, projectId, issueId);

      expect(getReadUrl).not.toHaveBeenCalled();
      expect(result.screenshotUrl).toBeUndefined();
    });

    it('throws NotFoundException for a missing issue', async () => {
      const svc = makeService({ issueRow: undefined });
      await expect(svc.findOne(companyId, projectId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getScreenshotUploadUrl', () => {
    it('generates an issues-namespaced key and requests a PNG upload URL', async () => {
      const generateKey = jest.fn().mockReturnValue('company-1/issues/999.png');
      const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put', storageKey: 'company-1/issues/999.png' });
      const svc = makeService({ generateKey, getUploadUrl });

      const result = await svc.getScreenshotUploadUrl(companyId, projectId);

      expect(generateKey).toHaveBeenCalledWith(companyId, projectId, 'issues', expect.stringMatching(/\.png$/));
      expect(getUploadUrl).toHaveBeenCalledWith('company-1/issues/999.png', 'image/png', expect.any(Number));
      expect(result).toEqual({ uploadUrl: 'https://presigned.example/put', storageKey: 'company-1/issues/999.png' });
    });
  });

  // Ticket 2a: issue numbering moved from {projectCode}-{typeCode}-{seq},
  // sequenced per (project, issue type), to {projectCode}-{disciplineCode}-{seq},
  // sequenced per (project, discipline).
  describe('create — discipline-based issue numbering', () => {
    function makeQueryMock(existingCountForDiscipline: number) {
      const calls: Array<{ text: string; values: unknown[] }> = [];
      const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        calls.push({ text, values });

        if (text.includes('SELECT code FROM projects')) {
          return Promise.resolve([{ code: 'twr' }]);
        }
        if (text.includes('SELECT COUNT(*) AS n FROM issues')) {
          return Promise.resolve([{ n: String(existingCountForDiscipline) }]);
        }
        if (text.includes('INSERT INTO issues')) {
          return Promise.resolve([{
            id: 'issue-1', title: 'Cracked beam', discipline: 'MEP', category: null,
            issueType: 'defect', status: 'open', priority: 'medium',
            description: null, issueNumber: null,
          }]);
        }
        if (text.includes('INSERT INTO issue_activities')) {
          return Promise.resolve([{ id: 'activity-1' }]);
        }
        // e.g. addActivity's `UPDATE issues SET updated_at = NOW() ...`
        return Promise.resolve([]);
      });
      return { query: query as unknown as DatabaseService['query'], calls };
    }

    function makeCreateService(existingCountForDiscipline: number) {
      const { query, calls } = makeQueryMock(existingCountForDiscipline);
      // generateIssueNumber/create/addActivity all now go through withTenant --
      // forward its callback to the same query mock so the existing text-keyed
      // responses still apply.
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const db = { query, withTenant };
      const ingestIssue = jest.fn();
      const aiClient = { ingestIssue };
      const notifications = { create: jest.fn() };
      const storage = {};
      const svc = new IssuesService(
        db as unknown as DatabaseService,
        aiClient as unknown as AiClientService,
        notifications as unknown as NotificationsService,
        storage as unknown as StorageService,
      );
      return { svc, calls, ingestIssue };
    }

    it('formats the number as {projectCode}-{disciplineCode}-{seq}, zero-padded to 4 digits', async () => {
      const { svc, ingestIssue } = makeCreateService(3);

      await svc.create('company-1', 'project-1', 'user-1', {
        issueType: 'defect',
        title: 'Cracked beam',
        discipline: 'MEP',
        deadline: '2026-09-01T00:00:00.000Z',
      } as CreateIssueDto);

      expect(ingestIssue).toHaveBeenCalledWith(
        expect.objectContaining({ issueNumber: 'TWR-MEP-0004' }),
      );
    });

    it('counts existing issues scoped by (project, discipline) rather than (project, issue type)', async () => {
      const { svc, calls } = makeCreateService(0);

      await svc.create('company-1', 'project-1', 'user-1', {
        issueType: 'rfi',
        title: 'Need clarification',
        discipline: 'STR',
        deadline: '2026-09-01T00:00:00.000Z',
      } as CreateIssueDto);

      const countCall = calls.find(c => c.text.includes('SELECT COUNT(*) AS n FROM issues'));
      expect(countCall).toBeDefined();
      // values = [projectId, discipline, companyId] -- notably not issueType ('rfi')
      expect(countCall!.values).toEqual(['project-1', 'STR', 'company-1']);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Ticket 2b — workflow actions
  // ══════════════════════════════════════════════════════════════════════

  // Generic tagged-template mock for this.db.query -- records every call
  // (text + interpolated values) and lets each test supply a responder
  // keyed off substrings of the query text, same style as the discipline-
  // numbering tests above.
  function makeQuery(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      calls.push({ text, values });
      return Promise.resolve(responder(text, values) ?? []);
    });
    return { query: query as unknown as DatabaseService['query'], calls };
  }

  describe('forward', () => {
    it('reassigns the issue, logs a forward activity with from/to values, and notifies the new assignee', async () => {
      const { query, calls } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', assignedTo: 'user-old', issueNumber: 'TWR-MEP-0001', title: 'Leak', status: 'open' }];
        }
        if (text.includes('UPDATE issues SET assigned_to')) {
          return [{ id: 'issue-1', assignedTo: 'user-new', issueNumber: 'TWR-MEP-0001', title: 'Leak' }];
        }
        if (text.includes('INSERT INTO issue_activities')) {
          return [{ id: 'activity-1' }];
        }
        return undefined;
      });
      // findOne(), the reassignment UPDATE, and addActivity() all now go through
      // withTenant -- forward its callback to the same text-keyed query mock.
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const notifications = { create: jest.fn() };
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        notifications as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.forward('company-1', 'project-1', 'issue-1', 'user-1', {
        toUserId: 'user-new', comment: 'please pick this up',
      });

      expect(result.assignedTo).toBe('user-new');

      const activityCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
      expect(activityCall).toBeDefined();
      // values = [issueId, companyId, activityType, content, fromValue, toValue, captureId, userId]
      expect(activityCall!.values[2]).toBe('forward');
      expect(activityCall!.values[4]).toBe('user-old');
      expect(activityCall!.values[5]).toBe('user-new');

      expect(notifications.create).toHaveBeenCalledWith('company-1', expect.objectContaining({
        userId: 'user-new', type: 'issue_assigned',
      }));
    });
  });

  describe('forceStatus', () => {
    it('sets status directly and logs a status_force activity (not status_change)', async () => {
      const { query, calls } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', status: 'closed' }];
        }
        if (text.includes('UPDATE issues SET')) {
          return [{ id: 'issue-1', status: 'reopened' }];
        }
        return undefined;
      });
      // findOne() and the status UPDATE both now go through withTenant -- forward
      // its callback to the same text-keyed query mock.
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.forceStatus('company-1', 'project-1', 'issue-1', 'user-1', { status: 'reopened' });

      expect(result.status).toBe('reopened');
      const activityCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
      expect(activityCall!.values[2]).toBe('status_force');
      expect(activityCall!.values[4]).toBe('closed');    // fromValue
      expect(activityCall!.values[5]).toBe('reopened');  // toValue
    });
  });

  describe('bulkClose', () => {
    it('closes only the targeted, not-already-closed issues and logs one status_change activity each', async () => {
      const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
      const sql = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        sqlCalls.push({ text, values });
        if (text.includes('SELECT id, status, issue_number FROM issues')) {
          return Promise.resolve([
            { id: 'issue-1', status: 'open', issueNumber: 'A-1' },
            { id: 'issue-2', status: 'assigned', issueNumber: 'A-2' },
          ]);
        }
        return Promise.resolve([]);
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.bulkClose('company-1', 'project-1', 'user-1', { issueIds: ['issue-1', 'issue-2'] });

      expect(result).toEqual({ closed: 2, issueIds: ['issue-1', 'issue-2'] });
      const activityInserts = sqlCalls.filter(c => c.text.includes('INSERT INTO issue_activities'));
      expect(activityInserts).toHaveLength(2);
      // 'status_change' and 'closed' are inline SQL literals (not
      // interpolated), so values = [issueId, companyId, fromValue, userId].
      expect(activityInserts[0].text).toContain('status_change');
      expect(activityInserts[0].values).toEqual(['issue-1', 'company-1', 'open', 'user-1']);
      expect(activityInserts[1].values).toEqual(['issue-2', 'company-1', 'assigned', 'user-1']);
    });

    it('returns closed: 0 when no targeted issues are open', async () => {
      const sql = jest.fn().mockResolvedValue([]);
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.bulkClose('company-1', 'project-1', 'user-1', { issueIds: ['issue-9'] });
      expect(result).toEqual({ closed: 0, issueIds: [] });
    });
  });

  describe('reminders', () => {
    it('broadcastReminder logs one issue_reminders row and one reminder activity per open issue', async () => {
      const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
      const sql = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        sqlCalls.push({ text, values });
        if (text.includes('SELECT id, assigned_to FROM issues')) {
          return Promise.resolve([{ id: 'issue-1', assignedTo: 'user-a' }, { id: 'issue-2', assignedTo: null }]);
        }
        return Promise.resolve([]);
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.broadcastReminder('company-1', 'project-1', 'user-1', { message: 'Please update your issues' });

      expect(result).toEqual({ remindersSent: 2 });
      expect(sqlCalls.filter(c => c.text.includes('INSERT INTO issue_reminders'))).toHaveLength(2);
      expect(sqlCalls.filter(c => c.text.includes("'reminder'"))).toHaveLength(2);
    });

    it('userReminder scopes to that user\'s open issues only', async () => {
      const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
      const sql = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        sqlCalls.push({ text, values });
        if (text.includes('assigned_to = ')) {
          return Promise.resolve([{ id: 'issue-3' }]);
        }
        return Promise.resolve([]);
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.userReminder('company-1', 'project-1', 'user-1', { userId: 'user-b', message: 'Reminder' });

      expect(result).toEqual({ remindersSent: 1 });
      const reminderInsert = sqlCalls.find(c => c.text.includes('INSERT INTO issue_reminders'));
      expect(reminderInsert!.values).toContain('user-b');
    });
  });

  describe('attachments', () => {
    it('getAttachmentUploadUrl rejects a disallowed extension', async () => {
      const svc = new IssuesService(
        {} as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );
      await expect(svc.getAttachmentUploadUrl('company-1', 'project-1', {
        filename: 'malware.exe', sizeBytes: 1000,
      })).rejects.toThrow(BadRequestException);
    });

    it('getAttachmentUploadUrl rejects a file over the 5MB cap', async () => {
      const svc = new IssuesService(
        {} as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );
      await expect(svc.getAttachmentUploadUrl('company-1', 'project-1', {
        filename: 'report.pdf', sizeBytes: 6 * 1024 * 1024,
      })).rejects.toThrow(BadRequestException);
    });

    it('getAttachmentUploadUrl accepts an allowed extension within the size cap', async () => {
      const generateKey = jest.fn().mockReturnValue('company-1/issues/project-1/uuid.pdf');
      const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put', storageKey: 'company-1/issues/project-1/uuid.pdf' });
      const svc = new IssuesService(
        {} as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        { generateKey, getUploadUrl } as unknown as StorageService,
      );

      const result = await svc.getAttachmentUploadUrl('company-1', 'project-1', { filename: 'report.pdf', sizeBytes: 1024 });

      expect(result).toEqual({ uploadUrl: 'https://presigned.example/put', storageKey: 'company-1/issues/project-1/uuid.pdf' });
    });

    it('addAttachment stores the storage key (not a raw URL) on a new issue_activities row', async () => {
      const { query, calls } = makeQuery((text) => {
        if (text.includes('INSERT INTO issue_activities')) {
          return [{ id: 'activity-1', attachmentUrl: 'company-1/issues/project-1/uuid.pdf' }];
        }
        return undefined;
      });
      // addAttachment() now goes through withTenant -- forward its callback to
      // the same text-keyed query mock.
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await svc.addAttachment('company-1', 'issue-1', 'user-1', {
        storageKey: 'company-1/issues/project-1/uuid.pdf', filename: 'report.pdf', sizeBytes: 1024,
      });

      const insertCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
      // values = [issueId, companyId, content, storageKey, filename, sizeBytes, userId]
      expect(insertCall!.values).toContain('company-1/issues/project-1/uuid.pdf');
      expect(insertCall!.values).toContain('report.pdf');
      expect(insertCall!.values).toContain(1024);
    });

    // Follow-up fix: getActivities() previously returned attachment_url
    // (the raw storage key) as-is, with nothing to turn it into a
    // fetchable link. It now resolves a separate `attachmentReadUrl`
    // field via storage.getReadUrl(), mirroring findOne()'s
    // screenshotStorageKey -> screenshotUrl split.
    describe('getActivities — attachment read URL resolution', () => {
      it('adds attachmentReadUrl for an activity that has an attachment', async () => {
        const withTenant = jest.fn().mockResolvedValue([
          { id: 'activity-1', activityType: 'comment', attachmentUrl: 'company-1/issues/project-1/uuid.pdf', attachmentName: 'report.pdf' },
        ]);
        const getReadUrl = jest.fn().mockResolvedValue('https://presigned.example/read?sig=xyz');
        const svc = new IssuesService(
          { withTenant } as unknown as DatabaseService,
          {} as unknown as AiClientService,
          {} as unknown as NotificationsService,
          { getReadUrl } as unknown as StorageService,
        );

        const result = await svc.getActivities('company-1', 'issue-1');

        expect(getReadUrl).toHaveBeenCalledWith('company-1/issues/project-1/uuid.pdf');
        expect(result[0]).toMatchObject({
          attachmentUrl: 'company-1/issues/project-1/uuid.pdf', // raw storage key, left as-is
          attachmentReadUrl: 'https://presigned.example/read?sig=xyz', // usable link
        });
      });

      it('does not call storage and has no attachmentReadUrl for an activity without an attachment', async () => {
        const withTenant = jest.fn().mockResolvedValue([
          { id: 'activity-2', activityType: 'comment', attachmentUrl: null },
        ]);
        const getReadUrl = jest.fn();
        const svc = new IssuesService(
          { withTenant } as unknown as DatabaseService,
          {} as unknown as AiClientService,
          {} as unknown as NotificationsService,
          { getReadUrl } as unknown as StorageService,
        );

        const result = await svc.getActivities('company-1', 'issue-1');

        expect(getReadUrl).not.toHaveBeenCalled();
        expect(result[0]).toEqual({ id: 'activity-2', activityType: 'comment', attachmentUrl: null });
        expect((result[0] as Record<string, unknown>).attachmentReadUrl).toBeUndefined();
      });
    });
  });
});
