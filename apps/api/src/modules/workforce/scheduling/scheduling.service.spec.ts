import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import type { DatabaseService } from '../../../database/database.service';

function makeService(sqlMock: jest.Mock) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  return { svc: new SchedulingService(db as unknown as DatabaseService), db };
}

const companyId = 'company-1';
const userId = 'user-1';

describe('SchedulingService.setMyShiftPreference', () => {
  it('upserts a preference for the given day of week', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ id: 'pref-1', dayOfWeek: 1 }]);
    const { svc, db } = makeService(sqlMock);

    const result = await svc.setMyShiftPreference(companyId, userId, { dayOfWeek: 1, preferred: true, startTime: '09:00', endTime: '17:00' });

    expect(result).toEqual({ id: 'pref-1', dayOfWeek: 1 });
    expect(db.withTenant).toHaveBeenCalledWith(companyId, expect.any(Function));
    const insertQueryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(insertQueryText).toContain('ON CONFLICT (user_id, day_of_week)');
  });
});

describe('SchedulingService.assignShift', () => {
  it('rejects an end time not after the start time without touching the database', async () => {
    const sqlMock = jest.fn();
    const { svc } = makeService(sqlMock);

    await expect(
      svc.assignShift(companyId, 'admin-1', { userId, shiftDate: '2026-02-02', startTime: '17:00', endTime: '09:00' }),
    ).rejects.toThrow(BadRequestException);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the target user does not exist', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]); // user lookup -> not found
    const { svc } = makeService(sqlMock);

    await expect(
      svc.assignShift(companyId, 'admin-1', { userId: 'missing-user', shiftDate: '2026-02-02', startTime: '09:00', endTime: '17:00' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('upserts a shift assignment for a valid user and time range', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'user-1' }]) // user lookup
      .mockResolvedValueOnce([{ id: 'shift-1', shiftDate: '2026-02-02' }]); // INSERT ... RETURNING *
    const { svc } = makeService(sqlMock);

    const result = await svc.assignShift(companyId, 'admin-1', { userId, shiftDate: '2026-02-02', startTime: '09:00', endTime: '17:00' });

    expect(result).toEqual({ id: 'shift-1', shiftDate: '2026-02-02' });
  });
});

describe('SchedulingService.getShifts', () => {
  it('looks up only the caller\'s own shifts with no visibility check when no targetUserId is given', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ id: 'shift-1' }]);
    const { svc } = makeService(sqlMock);

    const result = await svc.getShifts(companyId, userId, '2026-02-01', '2026-02-07');

    expect(result).toEqual([{ id: 'shift-1' }]);
    expect(sqlMock).toHaveBeenCalledTimes(1); // no reporting-line lookup needed for self
  });

  it('defaults to today through two weeks out when no range is given', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const { svc } = makeService(sqlMock);

    await svc.getShifts(companyId, userId);

    const selectCall = sqlMock.mock.calls[0];
    const from = new Date(selectCall[2] as string);
    const to = new Date(selectCall[3] as string);
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
    expect(days).toBe(14);
  });

  it('throws ForbiddenException when the caller has no visibility into the target user', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]); // resolveDownlineUserIds -> caller has no reports
    const { svc } = makeService(sqlMock);

    await expect(
      svc.getShifts(companyId, 'ic-1', undefined, undefined, 'someone-else', 'consultant'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a manager to see a downline report\'s shifts', async () => {
    // 'consultant' is well below LEADERSHIP_OVERRIDE_ROLE's weight, so this
    // exercises the actual downline-resolution query path rather than the
    // leadership short-circuit (which never touches the database).
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ userId: 'report-1' }]) // resolveDownlineUserIds
      .mockResolvedValueOnce([{ id: 'shift-1' }]); // the actual shifts query
    const { svc } = makeService(sqlMock);

    const result = await svc.getShifts(companyId, 'manager-1', undefined, undefined, 'report-1', 'consultant');
    expect(result).toEqual([{ id: 'shift-1' }]);
  });
});

describe('SchedulingService.requestAbsence', () => {
  it('rejects an end date before the start date without touching the database', async () => {
    const sqlMock = jest.fn();
    const { svc } = makeService(sqlMock);

    await expect(
      svc.requestAbsence(companyId, userId, { absenceType: 'vacation', startDate: '2026-03-10', endDate: '2026-03-01' }),
    ).rejects.toThrow(BadRequestException);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('creates a pending absence request', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ id: 'absence-1', status: 'pending' }]);
    const { svc } = makeService(sqlMock);

    const result = await svc.requestAbsence(companyId, userId, { absenceType: 'vacation', startDate: '2026-03-01', endDate: '2026-03-05' });
    expect(result).toEqual({ id: 'absence-1', status: 'pending' });
  });
});

describe('SchedulingService.decideAbsence', () => {
  it('throws NotFoundException when the absence does not exist', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const { svc } = makeService(sqlMock);

    await expect(svc.decideAbsence(companyId, 'admin-1', 'missing', 'approved')).rejects.toThrow(NotFoundException);
  });

  it('refuses to re-decide an already-decided request', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ id: 'absence-1', status: 'approved' }]);
    const { svc } = makeService(sqlMock);

    await expect(svc.decideAbsence(companyId, 'admin-1', 'absence-1', 'denied')).rejects.toThrow(ForbiddenException);
  });

  it('approves a pending request and records who decided it', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'absence-1', status: 'pending' }])
      .mockResolvedValueOnce([{ id: 'absence-1', status: 'approved', decidedBy: 'admin-1' }]);
    const { svc } = makeService(sqlMock);

    const result = await svc.decideAbsence(companyId, 'admin-1', 'absence-1', 'approved');
    expect(result).toEqual({ id: 'absence-1', status: 'approved', decidedBy: 'admin-1' });
  });
});

describe('SchedulingService.getCompanyAbsences', () => {
  it('filters to pending only by default', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const { svc } = makeService(sqlMock);

    await svc.getCompanyAbsences(companyId, false);

    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(queryText).toContain("status = 'pending'");
  });

  it('includes decided requests when includeDecided is true', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const { svc } = makeService(sqlMock);

    await svc.getCompanyAbsences(companyId, true);

    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(queryText).not.toContain("status = 'pending'");
  });
});
