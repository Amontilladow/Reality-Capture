import { ReportsService } from './reports.service';
import type { DatabaseService } from '../../../database/database.service';

function makeService(sqlMock: jest.Mock) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  return new ReportsService(db as unknown as DatabaseService);
}

describe('ReportsService.getCompanySummary', () => {
  it('returns one row per active user, including a user with zero activity in the period', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([
        { id: 'user-a', firstName: 'Ada', lastName: 'Engineer', companyRole: 'engineer' },
        { id: 'user-b', firstName: 'Bo', lastName: 'Designer', companyRole: 'designer' },
      ])
      .mockResolvedValueOnce([
        { userId: 'user-a', durationSeconds: 3600, activityType: 'ENGINEERING', applicationId: 'app-1', applicationName: 'Revit', engineeringRelevance: true, productivityClassification: 'productive' },
      ]);
    const svc = makeService(sqlMock);

    const report = await svc.getCompanySummary('company-1', '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');

    expect(report).toHaveLength(2);
    const ada = report.find((r) => r.userId === 'user-a')!;
    expect(ada.totalActiveSeconds).toBe(3600);
    expect(ada.productiveSeconds).toBe(3600);
    expect(ada.productivityRatio).toBe(1);

    // A user with no rows in the period still appears, at zero -- never
    // silently dropped from a company-wide report.
    const bo = report.find((r) => r.userId === 'user-b')!;
    expect(bo.totalActiveSeconds).toBe(0);
    expect(bo.productivityRatio).toBe(0);
  });

  it('defaults to the trailing 7 days when no range is given', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const svc = makeService(sqlMock);

    await svc.getCompanySummary('company-1');

    const activityQueryCall = sqlMock.mock.calls[1];
    const from = new Date(activityQueryCall[1] as string);
    const to = new Date(activityQueryCall[2] as string);
    const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 5);
  });
});
