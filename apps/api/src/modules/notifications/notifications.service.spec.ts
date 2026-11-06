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
    // dispatchChannels always does exactly one recipient lookup (email +
    // phone + preferences in a single query) regardless of what it then
    // decides to send -- every scenario below accounts for that call even
    // when it expects no delivery to follow.

    it('inserts with the given category/priority/actionRequired and pushes a real-time event to the recipient', async () => {
      const { svc, withTenant, emitToUser, emailQueue } = makeService();
      const row = { id: 'notif-1', userId, type: 'rfi_overdue', priority: 'high', category: 'rfi', actionRequired: true };
      withTenant.mockImplementation(multi([[row], [{ email: 'user1@example.com' }], [{ id: 'delivery-1' }]]));

      const result = await svc.create(companyId, {
        userId, type: 'rfi_overdue', title: 'RFI overdue', category: 'rfi', priority: 'high', actionRequired: true,
      });

      expect(result).toEqual(row);
      expect(emitToUser).toHaveBeenCalledWith(userId, row);
      // High priority + default preferences (email enabled) -> email sent.
      expect(emailQueue.add).toHaveBeenCalledWith(NOTIFICATION_EMAIL_JOB_NAME, { companyId, deliveryId: 'delivery-1' });
    });

    it('does not enqueue an email for a normal-priority, non-action-required notification', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementation(multi([[{ id: 'notif-low' }], [{ email: 'user1@example.com' }]]));

      await svc.create(companyId, { userId, type: 'issue_comment', title: 'New comment', priority: 'normal', actionRequired: false });

      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues an email for a normal-priority notification that is action-required', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementation(multi([[{ id: 'notif-ar' }], [{ email: 'user1@example.com' }], [{ id: 'delivery-2' }]]));

      await svc.create(companyId, { userId, type: 'rfi_reopened', title: 'RFI reopened', priority: 'normal', actionRequired: true });

      expect(emailQueue.add).toHaveBeenCalledWith(NOTIFICATION_EMAIL_JOB_NAME, { companyId, deliveryId: 'delivery-2' });
    });

    it('respects emailEnabled: false for a non-critical notification', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementation(multi([
        [{ id: 'notif-pref-off' }],
        [{ email: 'user1@example.com', preferences: { notifications: { emailEnabled: false } } }],
      ]));

      await svc.create(companyId, { userId, type: 'rfi_overdue', title: 'RFI overdue', priority: 'high' });

      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('bypasses emailEnabled: false and muted categories for critical priority (escalation override)', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementation(multi([
        [{ id: 'notif-crit-bypass' }],
        [{ email: 'user1@example.com', preferences: { notifications: { emailEnabled: false, mutedCategories: ['issue'] } } }],
        [{ id: 'delivery-3' }],
      ]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Critical issue', category: 'issue', priority: 'critical' });

      expect(emailQueue.add).toHaveBeenCalledWith(NOTIFICATION_EMAIL_JOB_NAME, { companyId, deliveryId: 'delivery-3' });
    });

    it('respects a muted category for a non-critical, non-action-required notification', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementation(multi([
        [{ id: 'notif-muted' }],
        [{ email: 'user1@example.com', preferences: { notifications: { mutedCategories: ['rfi'] } } }],
      ]));

      await svc.create(companyId, { userId, type: 'rfi_overdue', title: 'RFI overdue', category: 'rfi', priority: 'high' });

      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('never fails the write when the recipient lookup throws', async () => {
      const { svc, withTenant, emailQueue, whatsappQueue } = makeService();
      withTenant.mockImplementationOnce(single([{ id: 'notif-fail' }])).mockImplementationOnce(() => { throw new Error('db unavailable'); });

      await expect(svc.create(companyId, { userId, type: 'issue_assigned', title: 'Assigned', priority: 'critical' }))
        .resolves.toEqual({ id: 'notif-fail' });
      expect(emailQueue.add).not.toHaveBeenCalled();
      expect(whatsappQueue.add).not.toHaveBeenCalled();
    });

    it('skips enqueueing email when the user has no email on file (e.g. inactive)', async () => {
      const { svc, withTenant, emailQueue } = makeService();
      withTenant.mockImplementation(multi([[{ id: 'notif-noemail' }], [{ phone: null }]]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Assigned', priority: 'critical' });

      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues a WhatsApp delivery for critical priority when configured and the user opted in', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: true });
      withTenant.mockImplementation(multi([
        [{ id: 'notif-wa' }],
        [{ email: 'user1@example.com', phone: '+1 (555) 123-4567', preferences: { notifications: { whatsappEnabled: true } } }],
        [{ id: 'email-delivery-x' }], // critical bypass also sends email
        [{ id: 'wa-delivery-1' }],
      ]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Critical issue', priority: 'critical' });

      expect(whatsappQueue.add).toHaveBeenCalledWith(NOTIFICATION_WHATSAPP_JOB_NAME, { companyId, deliveryId: 'wa-delivery-1' });
    });

    it('does not enqueue a WhatsApp delivery when the user has not opted in, even if configured and critical', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: true });
      withTenant.mockImplementation(multi([
        [{ id: 'notif-wa-off' }],
        [{ email: 'user1@example.com', phone: '+15551234567' }], // no preferences -> whatsappEnabled defaults false
        [{ id: 'email-delivery-y' }],
      ]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Critical issue', priority: 'critical' });

      expect(whatsappQueue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue a WhatsApp delivery when the channel is not configured, even if opted in and critical', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: false });
      withTenant.mockImplementation(multi([
        [{ id: 'notif-wa-noconfig' }],
        [{ email: 'user1@example.com', phone: '+15551234567', preferences: { notifications: { whatsappEnabled: true } } }],
        [{ id: 'email-delivery-z' }],
      ]));

      await svc.create(companyId, { userId, type: 'issue_assigned', title: 'Critical issue', priority: 'critical' });

      expect(whatsappQueue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue a WhatsApp delivery for high priority, even when opted in and configured (critical only)', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: true });
      withTenant.mockImplementation(multi([
        [{ id: 'notif-wa-high' }],
        [{ email: 'user1@example.com', phone: '+15551234567', preferences: { notifications: { whatsappEnabled: true } } }],
        [{ id: 'email-delivery-w' }],
      ]));

      await svc.create(companyId, { userId, type: 'rfi_overdue', title: 'RFI overdue', priority: 'high' });

      expect(whatsappQueue.add).not.toHaveBeenCalled();
    });

    it('skips enqueueing the WhatsApp delivery when the user has no usable phone number on file', async () => {
      const { svc, withTenant, whatsappQueue } = makeService({ whatsappConfigured: true });
      withTenant.mockImplementation(multi([
        [{ id: 'notif-wa-nophone' }],
        [{ email: 'user1@example.com', phone: null, preferences: { notifications: { whatsappEnabled: true } } }],
        [{ id: 'email-delivery-v' }],
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

  describe('preferences', () => {
    it('getPreferences returns defaults when the user has none stored', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockImplementationOnce(single([{ preferences: null }]));

      const prefs = await svc.getPreferences(companyId, userId);
      expect(prefs).toEqual({ emailEnabled: true, whatsappEnabled: false, mutedCategories: [] });
    });

    it('getPreferences returns the stored notifications sub-object, merged over defaults', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockImplementationOnce(single([{ preferences: { notifications: { whatsappEnabled: true } } }]));

      const prefs = await svc.getPreferences(companyId, userId);
      expect(prefs).toEqual({ emailEnabled: true, whatsappEnabled: true, mutedCategories: [] });
    });

    it('updatePreferences merges the patch over the current preferences and persists it', async () => {
      const { svc, withTenant } = makeService();
      let updateArgs: unknown[] = [];
      withTenant
        .mockImplementationOnce(single([{ preferences: { notifications: { emailEnabled: true, whatsappEnabled: false, mutedCategories: ['rfi'] } } }]))
        .mockImplementationOnce((_companyId: string, callback: WithTenantCallback) => {
          const sql = Object.assign((...args: unknown[]) => { updateArgs = args; return Promise.resolve([]); }, { json: (v: unknown) => v });
          return callback(sql);
        });

      const result = await svc.updatePreferences(companyId, userId, { whatsappEnabled: true });

      expect(result).toEqual({ emailEnabled: true, whatsappEnabled: true, mutedCategories: ['rfi'] });
      expect(updateArgs[1]).toEqual({ emailEnabled: true, whatsappEnabled: true, mutedCategories: ['rfi'] });
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
