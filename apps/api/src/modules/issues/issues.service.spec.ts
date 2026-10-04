import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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
      // issueRow is repurposed here as whatever row the project-ownership
      // check's SELECT should find -- makeService()'s withTenant mock
      // doesn't care about the row's shape, only that it's truthy.
      const svc = makeService({ generateKey, getUploadUrl, issueRow: { id: projectId } });

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

        if (text.includes('SELECT id FROM projects')) {
          return Promise.resolve([{ id: 'project-1' }]);
        }
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

  describe('create/update — assignee must be a project member (F4)', () => {
    const baseCreateDto: CreateIssueDto = {
      issueType: 'defect', title: 'Cracked beam', discipline: 'MEP',
      deadline: '2026-12-01T00:00:00.000Z', assignedTo: 'user-outsider',
    };

    it('create() rejects assigning to a user who is not a project member', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('SELECT id FROM projects')) return [{ id: 'project-1' }];
        if (text.includes('FROM project_members')) return []; // not a member
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.create('company-1', 'project-1', 'user-1', baseCreateDto)).rejects.toThrow(BadRequestException);
    });

    it('create() proceeds past the membership check when the assignee is a project member', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('SELECT id FROM projects')) return [{ id: 'project-1' }];
        if (text.includes('FROM project_members')) return [{}]; // is a member
        if (text.includes('SELECT code FROM projects')) return [{ code: 'TWR' }];
        if (text.includes('SELECT COUNT(*) AS n FROM issues')) return [{ n: '0' }];
        if (text.includes('INSERT INTO issues')) return [{ id: 'issue-1', status: 'open' }];
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        { ingestIssue: jest.fn() } as unknown as AiClientService,
        { create: jest.fn() } as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.create('company-1', 'project-1', 'user-1', baseCreateDto)).resolves.toMatchObject({ id: 'issue-1' });
    });

    it('update() rejects reassigning to a user who is not a project member', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) return [{ id: 'issue-1', status: 'open' }];
        if (text.includes('FROM project_members')) return []; // not a member
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.update('company-1', 'project-1', 'issue-1', 'user-1', { assignedTo: 'user-outsider' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('forward', () => {
    it('reassigns the issue, logs a forward activity with from/to values, and notifies the new assignee, when called by the current assignee', async () => {
      const { query, calls } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', assignedTo: 'user-1', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001', title: 'Leak', status: 'open' }];
        }
        if (text.includes('FROM project_members')) {
          return [{}]; // F4: 'user-new' is a member of this project
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

      // Caller ('user-1') is the issue's current assignee.
      const result = await svc.forward('company-1', 'project-1', 'issue-1', 'user-1', 'site_engineer', {
        toUserId: 'user-new', comment: 'please pick this up',
      });

      expect(result.assignedTo).toBe('user-new');

      const activityCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
      expect(activityCall).toBeDefined();
      // values = [issueId, companyId, activityType, content, fromValue, toValue, captureId, userId]
      expect(activityCall!.values[2]).toBe('forward');
      expect(activityCall!.values[4]).toBe('user-1');
      expect(activityCall!.values[5]).toBe('user-new');

      expect(notifications.create).toHaveBeenCalledWith('company-1', expect.objectContaining({
        userId: 'user-new', type: 'issue_assigned',
      }));
    });

    it('allows the creator to forward an issue that is still unassigned', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', assignedTo: null, createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001', title: 'Leak', status: 'open' }];
        }
        if (text.includes('FROM project_members')) {
          return [{}]; // F4: 'user-new' is a member of this project
        }
        if (text.includes('UPDATE issues SET assigned_to')) {
          return [{ id: 'issue-1', assignedTo: 'user-new' }];
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        { create: jest.fn() } as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.forward('company-1', 'project-1', 'issue-1', 'user-creator', 'site_engineer', { toUserId: 'user-new' }))
        .resolves.toMatchObject({ assignedTo: 'user-new' });
    });

    it('rejects a forward attempt from someone who is neither the current assignee, the creator of an unassigned issue, nor an admin', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', assignedTo: 'user-1', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001', title: 'Leak', status: 'open' }];
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      // Caller is neither the current assignee ('user-1') nor the creator, and holds no admin role.
      await expect(svc.forward('company-1', 'project-1', 'issue-1', 'user-bystander', 'site_engineer', { toUserId: 'user-new' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('allows a company_admin to forward an issue they neither created nor are assigned to', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', assignedTo: 'user-1', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001', title: 'Leak', status: 'open' }];
        }
        if (text.includes('FROM project_members')) {
          return [{}]; // F4: 'user-new' is a member of this project
        }
        if (text.includes('UPDATE issues SET assigned_to')) {
          return [{ id: 'issue-1', assignedTo: 'user-new' }];
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        { create: jest.fn() } as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.forward('company-1', 'project-1', 'issue-1', 'user-admin', 'company_admin', { toUserId: 'user-new' }))
        .resolves.toMatchObject({ assignedTo: 'user-new' });
    });

    it('rejects forwarding to a user who is not a member of this project, even when the caller is otherwise authorized', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', assignedTo: 'user-1', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001', title: 'Leak', status: 'open' }];
        }
        if (text.includes('FROM project_members')) {
          return []; // 'user-outsider' has no project_members row for this project
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        { create: jest.fn() } as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.forward('company-1', 'project-1', 'issue-1', 'user-1', 'site_engineer', { toUserId: 'user-outsider' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('close (F5 -- requires evidence + a permitted-approver role)', () => {
    it('closes an issue when called by a permitted approver (engineering_manager) with evidence attached, logging the evidence capture on the activity row', async () => {
      const { query, calls } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', status: 'resolved', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001' }];
        }
        if (text.includes('FROM issue_captures')) {
          return [{ captureId: 'capture-1' }];
        }
        if (text.includes('UPDATE issues SET')) {
          return [{ id: 'issue-1', status: 'closed' }];
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.close('company-1', 'project-1', 'issue-1', 'user-admin', 'engineering_manager');

      expect(result.status).toBe('closed');
      const updateCall = calls.find(c => c.text.includes('UPDATE issues SET') && c.text.includes('closed_by'));
      expect(updateCall).toBeDefined();
      const activityCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
      expect(activityCall!.values[2]).toBe('status_change');
      expect(activityCall!.values[5]).toBe('closed');
      // AddActivityDto field order: activityType, content, fromValue, toValue, captureId
      expect(activityCall!.values[6]).toBe('capture-1');
    });

    it("rejects closing when the caller is not a permitted approver, even when they created the issue -- self-closing one's own work is no longer allowed", async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', status: 'resolved', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001' }];
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.close('company-1', 'project-1', 'issue-1', 'user-creator', 'site_engineer'))
        .rejects.toThrow(ForbiddenException);
    });

    it('rejects closing when no evidence capture has been attached, even for a permitted approver', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', status: 'resolved', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001' }];
        }
        if (text.includes('FROM issue_captures')) {
          return []; // no evidence attached
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.close('company-1', 'project-1', 'issue-1', 'user-admin', 'company_admin'))
        .rejects.toThrow(BadRequestException);
    });

    it('allows a company_admin to close an issue they did not create, once evidence exists', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', status: 'resolved', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001' }];
        }
        if (text.includes('FROM issue_captures')) {
          return [{ captureId: 'capture-9' }];
        }
        if (text.includes("UPDATE issues SET")) {
          return [{ id: 'issue-1', status: 'closed' }];
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.close('company-1', 'project-1', 'issue-1', 'user-admin', 'company_admin'))
        .resolves.toMatchObject({ status: 'closed' });
    });

    it('is a no-op returning the existing row when the issue is already closed', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', status: 'closed', createdBy: 'user-creator', issueNumber: 'TWR-MEP-0001' }];
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      // Even a non-approver caller doesn't get a 403 here -- closing an
      // already-closed issue never reaches the authorization/evidence checks.
      const result = await svc.close('company-1', 'project-1', 'issue-1', 'user-bystander', 'site_engineer');
      expect(result.status).toBe('closed');
    });
  });

  describe('forceStatus', () => {
    it('sets status directly and logs a status_force activity (not status_change) for a non-closing transition', async () => {
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

    it('rejects forcing status to closed when no evidence capture has been attached (F5)', async () => {
      const { query } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', status: 'open' }];
        }
        if (text.includes('FROM issue_captures')) {
          return []; // no evidence attached
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.forceStatus('company-1', 'project-1', 'issue-1', 'user-admin', { status: 'closed' }))
        .rejects.toThrow(BadRequestException);
    });

    it('force-closes with evidence present and logs the evidence capture on the status_force activity row (F5)', async () => {
      const { query, calls } = makeQuery((text) => {
        if (text.includes('FROM issues i')) {
          return [{ id: 'issue-1', status: 'open' }];
        }
        if (text.includes('FROM issue_captures')) {
          return [{ captureId: 'capture-5' }];
        }
        if (text.includes('UPDATE issues SET')) {
          return [{ id: 'issue-1', status: 'closed' }];
        }
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.forceStatus('company-1', 'project-1', 'issue-1', 'user-admin', { status: 'closed' });
      expect(result.status).toBe('closed');
      const activityCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
      expect(activityCall!.values[6]).toBe('capture-5'); // captureId
    });
  });

  describe('bulkClose (F5 -- requires evidence + a permitted-approver role)', () => {
    it('closes only the targeted, not-already-closed issues that have evidence attached, logging one status_change activity each with its evidence capture', async () => {
      const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
      const sql = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        sqlCalls.push({ text, values });
        if (text.includes('FROM issues i')) {
          return Promise.resolve([
            { id: 'issue-1', status: 'open', issueNumber: 'A-1', evidenceCaptureId: 'capture-1' },
            { id: 'issue-2', status: 'assigned', issueNumber: 'A-2', evidenceCaptureId: 'capture-2' },
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

      const result = await svc.bulkClose('company-1', 'project-1', 'user-admin', 'company_admin', { issueIds: ['issue-1', 'issue-2'] });

      expect(result).toEqual({ closed: 2, issueIds: ['issue-1', 'issue-2'], skipped: 0 });
      const activityInserts = sqlCalls.filter(c => c.text.includes('INSERT INTO issue_activities'));
      expect(activityInserts).toHaveLength(2);
      expect(activityInserts[0].text).toContain('status_change');
      expect(activityInserts[0].values).toEqual(['issue-1', 'company-1', 'open', 'capture-1', 'user-admin']);
      expect(activityInserts[1].values).toEqual(['issue-2', 'company-1', 'assigned', 'capture-2', 'user-admin']);
    });

    it('skips targeted issues that have no evidence attached, without failing the rest of the batch', async () => {
      const sql = jest.fn().mockResolvedValueOnce([
        { id: 'issue-1', status: 'open', issueNumber: 'A-1', evidenceCaptureId: 'capture-1' },
        { id: 'issue-2', status: 'open', issueNumber: 'A-2', evidenceCaptureId: null }, // no evidence
      ]).mockResolvedValue([]);
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.bulkClose('company-1', 'project-1', 'user-admin', 'company_admin', { issueIds: ['issue-1', 'issue-2'] });
      expect(result).toEqual({ closed: 1, issueIds: ['issue-1'], skipped: 1 });
    });

    it('a non-admin caller closes nothing -- bulk-close is restricted to the permitted-approver roles, same as single-issue close()', async () => {
      const sql = jest.fn().mockResolvedValue([]); // the SQL's own `AND ${isAdmin}` filter excludes everything for a non-admin
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.bulkClose('company-1', 'project-1', 'user-1', 'site_engineer', { issueIds: ['issue-1', 'issue-2', 'issue-3'] });
      expect(result).toEqual({ closed: 0, issueIds: [], skipped: 3 });
    });

    it('lets a company_admin bulk-close an issue with evidence regardless of who created it', async () => {
      const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
      const sql = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        sqlCalls.push({ text, values });
        if (text.includes('FROM issues i')) {
          return Promise.resolve([{ id: 'issue-1', status: 'open', issueNumber: 'A-1', evidenceCaptureId: 'capture-1' }]);
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

      const result = await svc.bulkClose('company-1', 'project-1', 'user-admin', 'company_admin', { issueIds: ['issue-1'] });
      expect(result).toEqual({ closed: 1, issueIds: ['issue-1'], skipped: 0 });
      const selectCall = sqlCalls.find(c => c.text.includes('FROM issues i'));
      expect(selectCall!.values).toContain(true); // the interpolated `${isAdmin}`
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

      const result = await svc.bulkClose('company-1', 'project-1', 'user-admin', 'company_admin', { issueIds: ['issue-9'] });
      expect(result).toEqual({ closed: 0, issueIds: [], skipped: 1 });
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
    // Every getAttachmentUploadUrl test needs a project-ownership check to
    // pass before it can reach the extension/size validation being tested --
    // this stands in for a project row existing under the caller's company.
    function makeProjectOkDb() {
      return { withTenant: jest.fn().mockResolvedValue([{ id: 'project-1' }]) } as unknown as DatabaseService;
    }

    it('getAttachmentUploadUrl rejects a disallowed extension', async () => {
      const svc = new IssuesService(
        makeProjectOkDb(),
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
        makeProjectOkDb(),
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
        makeProjectOkDb(),
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        { generateKey, getUploadUrl } as unknown as StorageService,
      );

      const result = await svc.getAttachmentUploadUrl('company-1', 'project-1', { filename: 'report.pdf', sizeBytes: 1024 });

      expect(result).toEqual({ uploadUrl: 'https://presigned.example/put', storageKey: 'company-1/issues/project-1/uuid.pdf' });
    });

    it('addAttachment stores the storage key (not a raw URL) on a new issue_activities row, using the verified size', async () => {
      const { query, calls } = makeQuery((text) => {
        if (text.includes('SELECT id FROM issues')) {
          return [{ id: 'issue-1' }];
        }
        if (text.includes('INSERT INTO issue_activities')) {
          return [{ id: 'activity-1', attachmentUrl: 'company-1/issues/project-1/uuid.pdf' }];
        }
        return undefined;
      });
      // addAttachment() now goes through withTenant -- forward its callback to
      // the same text-keyed query mock.
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      // Real object size (1024) intentionally matches the client-declared
      // sizeBytes below -- the point of this test isn't that they differ,
      // it's that the INSERT's persisted value comes from storage, not the DTO
      // (see the next test for the case where they actually diverge).
      const getObjectSize = jest.fn().mockResolvedValue(1024);
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        { getObjectSize } as unknown as StorageService,
      );

      await svc.addAttachment('company-1', 'issue-1', 'user-1', {
        storageKey: 'company-1/issues/project-1/uuid.pdf', filename: 'report.pdf', sizeBytes: 1024,
      });

      expect(getObjectSize).toHaveBeenCalledWith('company-1/issues/project-1/uuid.pdf');
      const insertCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
      // values = [issueId, companyId, content, storageKey, filename, sizeBytes, userId]
      expect(insertCall!.values).toContain('company-1/issues/project-1/uuid.pdf');
      expect(insertCall!.values).toContain('report.pdf');
      expect(insertCall!.values).toContain(1024);
    });

    it('addAttachment persists the actual storage size, not a client-declared one that understates it', async () => {
      const { query, calls } = makeQuery((text) => {
        if (text.includes('SELECT id FROM issues')) return [{ id: 'issue-1' }];
        if (text.includes('INSERT INTO issue_activities')) return [{ id: 'activity-1' }];
        return undefined;
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
      // Client declared 1 KB; the object actually sitting in storage is 2 MB.
      const getObjectSize = jest.fn().mockResolvedValue(2 * 1024 * 1024);
      const svc = new IssuesService(
        { query, withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        { getObjectSize } as unknown as StorageService,
      );

      await svc.addAttachment('company-1', 'issue-1', 'user-1', {
        storageKey: 'company-1/issues/project-1/uuid.pdf', filename: 'report.pdf', sizeBytes: 1024,
      });

      const insertCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
      expect(insertCall!.values).toContain(2 * 1024 * 1024);
      expect(insertCall!.values).not.toContain(1024);
    });

    it('addAttachment rejects and cleans up an attachment whose real size exceeds the 5MB cap', async () => {
      const deleteIfExists = jest.fn().mockResolvedValue(undefined);
      const getObjectSize = jest.fn().mockResolvedValue(6 * 1024 * 1024);
      const db = { withTenant: jest.fn().mockResolvedValue([{ id: 'issue-1' }]) };
      const svc = new IssuesService(
        db as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        { getObjectSize, deleteIfExists } as unknown as StorageService,
      );

      await expect(svc.addAttachment('company-1', 'issue-1', 'user-1', {
        storageKey: 'company-1/issues/project-1/uuid.pdf', filename: 'report.pdf', sizeBytes: 1024,
      })).rejects.toThrow(BadRequestException);

      expect(deleteIfExists).toHaveBeenCalledWith('company-1/issues/project-1/uuid.pdf');
    });

    it('addAttachment rejects an attachment for an issue that does not exist under this company', async () => {
      const db = { withTenant: jest.fn().mockResolvedValue([]) };
      const getObjectSize = jest.fn();
      const svc = new IssuesService(
        db as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        { getObjectSize } as unknown as StorageService,
      );

      await expect(svc.addAttachment('company-1', 'someone-elses-issue', 'user-1', {
        storageKey: 'company-1/issues/project-1/uuid.pdf', filename: 'report.pdf', sizeBytes: 1024,
      })).rejects.toThrow(NotFoundException);

      expect(getObjectSize).not.toHaveBeenCalled();
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

  describe('addActivity -- notifying the assignee on a plain comment', () => {
    function makeService(existingIssue: Record<string, unknown>) {
      const calls: Array<{ text: string; values: unknown[] }> = [];
      const sql = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        calls.push({ text, values });
        if (text.includes('INSERT INTO issue_activities')) return Promise.resolve([{ id: 'activity-1', content: 'Following up' }]);
        if (text.includes('UPDATE issues SET updated_at')) return Promise.resolve([]);
        if (text.includes('SELECT project_id, assigned_to, issue_number, title FROM issues')) return Promise.resolve([existingIssue]);
        return Promise.resolve([]);
      });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const notifications = { create: jest.fn() };
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        notifications as unknown as NotificationsService,
        {} as unknown as StorageService,
      );
      return { svc, calls, notifications };
    }

    it('notifies the current assignee when someone else comments', async () => {
      const { svc, notifications } = makeService({
        projectId: 'project-1', assignedTo: 'user-assignee', issueNumber: 'A-1', title: 'Leak',
      });

      await svc.addActivity('company-1', 'issue-1', 'user-commenter', { activityType: 'comment', content: 'Following up' });

      expect(notifications.create).toHaveBeenCalledWith('company-1', expect.objectContaining({
        userId: 'user-assignee', type: 'issue_comment', resourceType: 'issue', resourceId: 'issue-1',
      }));
    });

    it('does not notify when the assignee comments on their own issue', async () => {
      const { svc, notifications } = makeService({
        projectId: 'project-1', assignedTo: 'user-assignee', issueNumber: 'A-1', title: 'Leak',
      });

      await svc.addActivity('company-1', 'issue-1', 'user-assignee', { activityType: 'comment', content: 'On it' });

      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('does not notify when the issue is unassigned', async () => {
      const { svc, notifications } = makeService({
        projectId: 'project-1', assignedTo: null, issueNumber: 'A-1', title: 'Leak',
      });

      await svc.addActivity('company-1', 'issue-1', 'user-commenter', { activityType: 'comment', content: 'Anyone?' });

      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('does not look up the issue or notify for non-comment activity types', async () => {
      const { svc, calls, notifications } = makeService({ projectId: 'project-1', assignedTo: 'user-assignee' });

      await svc.addActivity('company-1', 'issue-1', 'user-1', { activityType: 'status_change', fromValue: 'open', toValue: 'closed' });

      expect(notifications.create).not.toHaveBeenCalled();
      expect(calls.some((c) => c.text.includes('SELECT project_id, assigned_to, issue_number, title FROM issues'))).toBe(false);
    });
  });

  describe('scheduleReminder', () => {
    function makeService(issueRow: Record<string, unknown>) {
      const db = { withTenant: jest.fn() };
      const svc = new IssuesService(
        db as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );
      jest.spyOn(svc, 'findOne').mockResolvedValue(issueRow as never);
      return { svc, db };
    }

    it('rejects scheduling a reminder on an unassigned issue', async () => {
      const { svc } = makeService({ id: 'issue-1', assignedTo: null });
      const future = new Date(Date.now() + 60_000).toISOString();
      await expect(svc.scheduleReminder('company-1', 'project-1', 'issue-1', 'user-1', { scheduledFor: future, message: 'ping' }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects a scheduledFor time that is not in the future', async () => {
      const { svc } = makeService({ id: 'issue-1', assignedTo: 'user-assignee' });
      const past = new Date(Date.now() - 60_000).toISOString();
      await expect(svc.scheduleReminder('company-1', 'project-1', 'issue-1', 'user-1', { scheduledFor: past, message: 'ping' }))
        .rejects.toThrow(BadRequestException);
    });

    it('inserts a scheduled (not-yet-sent) reminder targeting the current assignee', async () => {
      const { svc, db } = makeService({ id: 'issue-1', assignedTo: 'user-assignee' });
      const insertedRow = { id: 'reminder-1', sentTo: 'user-assignee', scheduledFor: '2099-01-01T00:00:00.000Z', sentAt: null };
      (db.withTenant as jest.Mock).mockImplementation((_companyId: string, fn: (sql: unknown) => unknown) => {
        const sql = jest.fn().mockResolvedValue([insertedRow]);
        return fn(sql);
      });

      const future = new Date(Date.now() + 60_000).toISOString();
      const result = await svc.scheduleReminder('company-1', 'project-1', 'issue-1', 'user-1', { scheduledFor: future, message: 'Please resolve soon' });

      expect(result).toEqual(insertedRow);
    });
  });

  describe('listPendingReminders / cancelScheduledReminder', () => {
    it('lists only pending (not yet fired) scheduled reminders', async () => {
      const rows = [{ id: 'reminder-1', message: 'ping', scheduledFor: '2099-01-01T00:00:00.000Z', sentToName: 'Sam Assignee' }];
      const sql = jest.fn().mockResolvedValue(rows);
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      const result = await svc.listPendingReminders('company-1', 'project-1', 'issue-1');
      expect(result).toEqual(rows);
    });

    it('throws NotFoundException when cancelling a reminder that does not exist or was already sent', async () => {
      const sql = jest.fn().mockResolvedValue({ count: 0 });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.cancelScheduledReminder('company-1', 'project-1', 'issue-1', 'reminder-1')).rejects.toThrow(NotFoundException);
    });

    it('succeeds when a pending reminder is cancelled', async () => {
      const sql = jest.fn().mockResolvedValue({ count: 1 });
      const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sql));
      const svc = new IssuesService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as AiClientService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
      );

      await expect(svc.cancelScheduledReminder('company-1', 'project-1', 'issue-1', 'reminder-1')).resolves.toEqual({ message: 'Scheduled reminder cancelled.' });
    });
  });
});
