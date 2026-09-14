import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DevicesService } from './devices.service';
import type { DatabaseService } from '../../../database/database.service';

function makeService(sqlMock: jest.Mock) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  return new DevicesService(db as unknown as DatabaseService);
}

const companyId = 'company-1';
const deviceRow = { id: 'device-1', userId: 'owner-user', companyId, isActive: true };

describe('DevicesService.revoke -- ownership + role-weight scoping (not a new RBAC system)', () => {
  it('throws ForbiddenException when the caller neither owns the device nor is company_admin+', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([deviceRow]); // assertAccess's lookup
    const svc = makeService(sqlMock);

    await expect(svc.revoke(companyId, 'someone-else', 'consultant', 'device-1')).rejects.toThrow(ForbiddenException);
  });

  it('allows a company_admin to revoke a device they do not own', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([deviceRow])
      .mockResolvedValueOnce([{ ...deviceRow, isActive: false, revokedAt: '2026-01-01T00:00:00.000Z' }]);
    const svc = makeService(sqlMock);

    const result = await svc.revoke(companyId, 'admin-user', 'company_admin', 'device-1');
    expect(result).toMatchObject({ isActive: false });
  });

  it('allows the device owner to revoke their own device even as a low-weight role', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([deviceRow])
      .mockResolvedValueOnce([{ ...deviceRow, isActive: false }]);
    const svc = makeService(sqlMock);

    const result = await svc.revoke(companyId, 'owner-user', 'consultant', 'device-1');
    expect(result).toMatchObject({ isActive: false });
  });

  it('throws NotFoundException for a device that does not exist (or belongs to another tenant, invisible under RLS)', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const svc = makeService(sqlMock);

    await expect(svc.revoke(companyId, 'owner-user', 'consultant', 'missing-device')).rejects.toThrow(NotFoundException);
  });
});

describe('DevicesService.list -- view_own vs. company-wide visibility', () => {
  it('scopes to the caller\'s own devices below company_admin weight', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([deviceRow]);
    const svc = makeService(sqlMock);

    await svc.list(companyId, 'owner-user', 'project_manager');

    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(queryText).toContain('WHERE user_id');
  });

  it('returns all company devices at company_admin weight and above', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([deviceRow]);
    const svc = makeService(sqlMock);

    await svc.list(companyId, 'admin-user', 'super_admin');

    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(queryText).not.toContain('WHERE user_id');
  });
});
