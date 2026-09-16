import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportingLinesService } from './reporting-lines.service';
import type { DatabaseService } from '../../../database/database.service';

function makeService(sqlMock: jest.Mock) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  return { svc: new ReportingLinesService(db as unknown as DatabaseService), db };
}

describe('ReportingLinesService.upsert', () => {
  it('rejects a user being set as their own manager before ever touching the database', async () => {
    const sqlMock = jest.fn();
    const { svc, db } = makeService(sqlMock);

    await expect(svc.upsert('company-1', 'admin-1', 'user-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(db.withTenant).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the target user does not exist', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]); // user lookup empty
    const { svc } = makeService(sqlMock);

    await expect(svc.upsert('company-1', 'admin-1', 'missing-user', 'manager-1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the target manager does not exist', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'user-1' }]) // user found
      .mockResolvedValueOnce([]); // manager lookup empty
    const { svc } = makeService(sqlMock);

    await expect(svc.upsert('company-1', 'admin-1', 'user-1', 'missing-manager')).rejects.toThrow(NotFoundException);
  });

  it('upserts the reporting line, replacing any existing manager for that user', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'user-1' }])
      .mockResolvedValueOnce([{ id: 'manager-1' }])
      .mockResolvedValueOnce([{ id: 'line-1', userId: 'user-1', managerId: 'manager-1' }]);
    const { svc } = makeService(sqlMock);

    const result = await svc.upsert('company-1', 'admin-1', 'user-1', 'manager-1');

    expect(result).toEqual({ id: 'line-1', userId: 'user-1', managerId: 'manager-1' });
    const insertQueryText = (sqlMock.mock.calls[2][0] as string[]).join('');
    expect(insertQueryText).toContain('ON CONFLICT (user_id) DO UPDATE');
  });
});
