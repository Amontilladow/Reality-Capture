import { IssueScheduledRemindersService } from './issue-scheduled-reminders.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsService } from '../notifications/notifications.service';

describe('IssueScheduledRemindersService.fireDueReminders', () => {
  function makeQuery(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      calls.push({ text, values });
      return Promise.resolve(responder(text, values) ?? []);
    });
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
    return { query: query as unknown as DatabaseService['query'], withTenant, calls };
  }

  it('fires a due reminder: marks it sent, logs an activity, and notifies the target user', async () => {
    const { query, withTenant, calls } = makeQuery((text) => {
      if (text.includes('FROM issue_reminders')) {
        return [{
          id: 'reminder-1', companyId: 'company-1', projectId: 'project-1', issueId: 'issue-1',
          sentBy: 'user-creator', sentTo: 'user-assignee', message: 'Please resolve this today',
        }];
      }
      if (text.includes('FROM issues')) {
        return [{ issueNumber: 'A-1', title: 'Leak' }];
      }
      return undefined;
    });
    const notifications = { create: jest.fn() };
    const svc = new IssueScheduledRemindersService(
      { query, withTenant } as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );

    const result = await svc.fireDueReminders();

    expect(result).toEqual({ checked: 1, fired: 1 });
    expect(calls.some((c) => c.text.includes('UPDATE issue_reminders SET sent_at = NOW()'))).toBe(true);
    const activityCall = calls.find((c) => c.text.includes('INSERT INTO issue_activities'));
    expect(activityCall).toBeDefined();
    expect(activityCall!.values).toEqual(['issue-1', 'company-1', 'Please resolve this today', 'user-creator']);
    expect(notifications.create).toHaveBeenCalledWith('company-1', expect.objectContaining({
      userId: 'user-assignee', type: 'issue_reminder', resourceType: 'issue', resourceId: 'issue-1',
    }));
  });

  it('is a no-op when there are no due reminders', async () => {
    const { query, withTenant } = makeQuery(() => []);
    const notifications = { create: jest.fn() };
    const svc = new IssueScheduledRemindersService(
      { query, withTenant } as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );

    const result = await svc.fireDueReminders();
    expect(result).toEqual({ checked: 0, fired: 0 });
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
