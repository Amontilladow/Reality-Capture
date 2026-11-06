import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsGateway } from './notifications.gateway';
import { NOTIFICATION_EMAIL_JOB_NAME } from './notification-email.constants';

type WithTenantCallback = (sql: unknown) => unknown;

function single(result: unknown) {
  return (_companyId: string, callback: WithTenantCallback) => callback(() => Promise.resolve(result));
}

// Sequential results for several withTenant calls in one create() -- same
// shape as the multi() helper used elsewhere (e.g.
// site-drawing-import.processor.spec.ts) for a service that issues more
// than one withTenant call per method.
function multi(results: unknown[]) {
  let i = 0;
  return (_companyId: string, callback: WithTenantCallback) => callback(() => Promise.resolve(results[i++]));
}

describe('NotificationsService', () => {
  const companyId = 'company-1';
  const userId = 'user-1';

  function makeService() {
    const withTenant = jest.fn();
    const db = { withTenant, paginate: jest.fn((rows: unknown[], page: number, perPage: number) => ({ data: rows, page, perPage, total: rows.length, totalPages: 1 })) } as unknown as DatabaseService;
    const emitToUser = jest.fn();
    const gateway = { emitToUser } as unknown as NotificationsGateway;
    const emailQueue = { add: jest.fn().mockResolvedValue(undefined) };
    return { svc: new NotificationsService(db, gateway, emailQueue as never), withTenant, emitToUser, emailQueue };
  }

  describe('create', () => {
    it('inserts with the given category/priority/actionRequired and pushes a real-time event to the recipient', async () => {
      const { svc, withTenant, emitToUser, emailQueue } = makeService();
      const row = { id: 'notif-1', userId, type: 'rfi_overdue', priority: 'high', category: 'rfi', actionRequired: true };
      withTenant.mockImplementation(multi([[row], [{ email: 'user1@example.com' }], [{ id: 'delivery-1' }]]));

      const result = await svc.create(companyId, {
        userId, type: 'rfi_overdue', title: 'RFI overdue', category: 'rfi', priority: 'high', actionRequired: true,
      });

      expect(result).toEqual(row);
      expect(emitToUser).toHaveBeenCalledWith(userId, row);
      // High priority -> also enqueues an email delivery (Phase 2's default
      // escalation rule, ahead of Phase 4's real per-user preferences).
      expect(emailQueue.add).toHaveBeenCalledWith(NOTIFICATION_EMAIL_JOB_NAME, { companyId, deliveryId: 'delivery-1' });
    });

    it('does not enqueue an email for a normal-priority, non-action-required notification', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementationOnce(single([{ id: 'notif-low' }]));

      await svc.create(companyId, { userId, type: 'issue_comment', title: 'New comment', priority: 'normal', actionRequired: false });

      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues an email for a normal-priority notification that is action-required', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementation(multi([[{ id: 'notif-ar' }], [{ email: 'user1@example.com' }], [{ id: 'delivery-2' }]]));

      await svc.create(companyId, { userId, type: 'rfi_reopened', title: 'RFI reopened', priority: 'normal', actionRequired: true });

      expect(emailQueue.add).toHaveBeenCalledWith(NOTIFICATION_EMAIL_JOB_NAME, { companyId, deliveryId: 'delivery-2' });
    });

    it('never fails the write when enqueueing the email throws (e.g. user lookup fails)', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementationOnce(single([{ id: 'notif-fail' }])).mockImplementationOnce(() => { throw new Error('db unavailable'); });

      await expect(svc.create(companyId, { userId, type: 'issue_assigned', title: 'Assigned', priority: 'critical' }))
        .resolves.toEqual({ id: 'notif-fail' });
      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('skips enqueueing when the user has no email on file (e.g. inactive)', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementation(multi([[{ id: 'notif-inactive' }], []]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Assigned', priority: 'critical' });

      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('defaults priority to normal and actionRequired to false when omitted', async () => {
      const { svc, withTenant } = makeService();
      let capturedArgs: unknown[] = [];
      withTenant.mockImplementationOnce((_companyId: string, callback: WithTenantCallback) => {
        const sql = Object.assign((...args: unknown[]) => { capturedArgs = args; return Promise.resolve([{ id: 'notif-2' }]); }, { json: (v: unknown) => v });
        return callback(sql);
      });

      await svc.create(companyId, { userId, type: 'issue_comment', title: 'New comment' });

      // Tagged-template call shape: [strings, companyId, userId, type, title, body,
      // resourceType, resourceId, projectId, createdBy, category, priority, actionRequired]
      expect(capturedArgs[11]).toBe('normal'); // priority
      expect(capturedArgs[12]).toBe(false); // actionRequired
    });

    it('never fails the write when the real-time push itself throws', async () => {
      const { svc, withTenant, emitToUser } = makeService();
      withTenant.mockImplementationOnce(single([{ id: 'notif-3' }]));
      emitToUser.mockImplementationOnce(() => { throw new Error('socket server not ready'); });

      await expect(svc.create(companyId, { userId, type: 'issue_assigned', title: 'Assigned' })).resolves.toEqual({ id: 'notif-3' });
    });
  });

  describe('acknowledge', () => {
    it('sets both acknowledged_at and read_at', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockImplementationOnce(single([{ id: 'notif-1', readAt: '2026-01-01T00:00:00Z', acknowledgedAt: '2026-01-01T00:00:00Z' }]));

      const result = await svc.acknowledge(companyId, userId, 'notif-1');
      expect(result.acknowledgedAt).toBeTruthy();
      expect(result.readAt).toBeTruthy();
    });

    it('404s when the notification does not exist or is not this user\'s', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockImplementationOnce(single([]));

      await expect(svc.acknowledge(companyId, userId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
