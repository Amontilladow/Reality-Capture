import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsGateway } from './notifications.gateway';
import type { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NOTIFICATION_EMAIL_JOB_NAME } from './notification-email.constants';
import { NOTIFICATION_WHATSAPP_JOB_NAME } from './notification-whatsapp.constants';

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

  function makeService(opts: { whatsappConfigured?: boolean } = {}) {
    const withTenant = jest.fn();
    const db = { withTenant, paginate: jest.fn((rows: unknown[], page: number, perPage: number) => ({ data: rows, page, perPage, total: rows.length, totalPages: 1 })) } as unknown as DatabaseService;
    const emitToUser = jest.fn();
    const gateway = { emitToUser } as unknown as NotificationsGateway;
    // Defaults to not-configured, same as production until real Meta
    // credentials exist (master spec section 10's zero-unapproved-cost
    // requirement) -- tests that need the channel live opt in explicitly.
    const whatsapp = { isConfigured: jest.fn().mockReturnValue(opts.whatsappConfigured ?? false) } as unknown as WhatsAppService;
    const emailQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const whatsappQueue = { add: jest.fn().mockResolvedValue(undefined) };
    return {
      svc: new NotificationsService(db, gateway, whatsapp, emailQueue as never, whatsappQueue as never),
      withTenant, emitToUser, emailQueue, whatsappQueue,
    };
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

    it('enqueues a WhatsApp delivery for a critical-priority notification when the channel is configured', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: true });
      // Critical priority also triggers Phase 2's email rule, so the
      // sequence is: insert, [email] SELECT email + INSERT delivery,
      // [whatsapp] SELECT phone + INSERT delivery.
      withTenant.mockImplementation(multi([
        [{ id: 'notif-critical' }], [{ email: 'user1@example.com' }], [{ id: 'email-delivery-x' }],
        [{ phone: '+1 (555) 123-4567' }], [{ id: 'wa-delivery-1' }],
      ]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Critical issue', priority: 'critical' });

      expect(whatsappQueue.add).toHaveBeenCalledWith(NOTIFICATION_WHATSAPP_JOB_NAME, { companyId, deliveryId: 'wa-delivery-1' });
    });

    it('does not enqueue a WhatsApp delivery when the channel is not configured, even for critical priority', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: false });
      withTenant.mockImplementationOnce(single([{ id: 'notif-critical-2' }]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Critical issue', priority: 'critical' });

      expect(whatsappQueue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue a WhatsApp delivery for high priority, even when configured (critical only)', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: true });
      withTenant.mockImplementationOnce(single([{ id: 'notif-high' }]));

      await svc.create(companyId, { userId, type: 'rfi_overdue', title: 'RFI overdue', priority: 'high' });

      expect(whatsappQueue.add).not.toHaveBeenCalled();
    });

    it('skips enqueueing the WhatsApp delivery when the user has no usable phone number on file', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: true });
      withTenant.mockImplementation(multi([
        [{ id: 'notif-critical-3' }], [{ email: 'user1@example.com' }], [{ id: 'email-delivery-y' }],
        [{ phone: null }],
      ]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Critical issue', priority: 'critical' });

      expect(whatsappQueue.add).not.toHaveBeenCalled();
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
