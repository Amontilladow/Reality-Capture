import { NotificationEscalationService } from './notification-escalation.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsService } from './notifications.service';

describe('NotificationEscalationService.escalateOverdue', () => {
  function makeQuery(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      calls.push({ text, values });
      return Promise.resolve(responder(text, values) ?? []);
    });
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
    const withSystemBypass = jest.fn((fn: (sql: unknown) => unknown) => fn(query));
    return { withSystemBypass, withTenant, calls };
  }

  it('escalates an overdue unacknowledged critical notification to the recipient\'s manager', async () => {
    const { withSystemBypass, withTenant, calls } = makeQuery((text) => {
      if (text.includes('FROM notifications')) {
        return [{
          id: 'notif-1', companyId: 'company-1', userId: 'user-assignee', type: 'issue_assigned',
          title: 'Critical issue', body: 'Fix it', resourceType: 'issue', resourceId: 'issue-1', projectId: 'project-1',
        }];
      }
      if (text.includes('FROM workforce_reporting_lines')) {
        return [{ managerId: 'user-manager' }];
      }
      return undefined;
    });
    const notifications = { create: jest.fn() };
    const svc = new NotificationEscalationService(
      { withSystemBypass, withTenant } as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );

    const result = await svc.escalateOverdue();

    expect(result).toEqual({ checked: 1, escalated: 1 });
    // Cross-company scan runs under the RLS system bypass, same as
    // IssueScheduledRemindersService's own cron.
    expect(withSystemBypass).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.text.includes('UPDATE notifications SET escalated_at = NOW()'))).toBe(true);
    expect(notifications.create).toHaveBeenCalledWith('company-1', expect.objectContaining({
      userId: 'user-manager', type: 'issue_assigned_escalated', category: 'escalation', priority: 'critical',
      actionRequired: true, resourceType: 'issue', resourceId: 'issue-1',
    }));
  });

  it('marks escalated_at but does not create a notification when the recipient has no manager configured', async () => {
    const { withSystemBypass, withTenant, calls } = makeQuery((text) => {
      if (text.includes('FROM notifications')) {
        return [{ id: 'notif-2', companyId: 'company-1', userId: 'user-orphan', type: 'rfi_overdue', title: 'RFI overdue' }];
      }
      if (text.includes('FROM workforce_reporting_lines')) return [];
      return undefined;
    });
    const notifications = { create: jest.fn() };
    const svc = new NotificationEscalationService(
      { withSystemBypass, withTenant } as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );

    const result = await svc.escalateOverdue();

    expect(result).toEqual({ checked: 1, escalated: 0 });
    expect(calls.some((c) => c.text.includes('UPDATE notifications SET escalated_at = NOW()'))).toBe(true);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is overdue', async () => {
    const { withSystemBypass, withTenant } = makeQuery(() => []);
    const notifications = { create: jest.fn() };
    const svc = new NotificationEscalationService(
      { withSystemBypass, withTenant } as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );

    const result = await svc.escalateOverdue();
    expect(result).toEqual({ checked: 0, escalated: 0 });
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
