import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsGateway } from './notifications.gateway';

type WithTenantCallback = (sql: unknown) => unknown;

function single(result: unknown) {
  return (_companyId: string, callback: WithTenantCallback) => callback(() => Promise.resolve(result));
}

describe('NotificationsService', () => {
  const companyId = 'company-1';
  const userId = 'user-1';

  function makeService() {
    const withTenant = jest.fn();
    const db = { withTenant, paginate: jest.fn((rows: unknown[], page: number, perPage: number) => ({ data: rows, page, perPage, total: rows.length, totalPages: 1 })) } as unknown as DatabaseService;
    const emitToUser = jest.fn();
    const gateway = { emitToUser } as unknown as NotificationsGateway;
    return { svc: new NotificationsService(db, gateway), withTenant, emitToUser };
  }

  describe('create', () => {
    it('inserts with the given category/priority/actionRequired and pushes a real-time event to the recipient', async () => {
      const { svc, withTenant, emitToUser } = makeService();
      const row = { id: 'notif-1', userId, type: 'rfi_overdue', priority: 'high', category: 'rfi', actionRequired: true };
      withTenant.mockImplementationOnce(single([row]));

      const result = await svc.create(companyId, {
        userId, type: 'rfi_overdue', title: 'RFI overdue', category: 'rfi', priority: 'high', actionRequired: true,
      });

      expect(result).toEqual(row);
      expect(emitToUser).toHaveBeenCalledWith(userId, row);
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
