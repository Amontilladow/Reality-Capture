import { ProductivityService, computeFactors, type ActivityAggregateRow } from './productivity.service';
import type { DatabaseService } from '../../../database/database.service';

describe('computeFactors (v1 productivity formula)', () => {
  it('computes utilization as active time / total time, and engineering share as engineering time / active time', () => {
    const rows: ActivityAggregateRow[] = [
      { durationSeconds: 3600, activityType: 'ENGINEERING', applicationId: 'app-revit', applicationName: 'Revit', engineeringRelevance: true },
      { durationSeconds: 1800, activityType: 'IDLE', applicationId: null, applicationName: 'Unknown', engineeringRelevance: null },
      { durationSeconds: 1800, activityType: 'ADMINISTRATIVE', applicationId: 'app-outlook', applicationName: 'Outlook', engineeringRelevance: false },
    ];

    const factors = computeFactors(rows);

    // total = 7200s, active (non-IDLE) = 5400s -> utilization 0.75
    expect(factors.utilization).toBeCloseTo(0.75, 5);
    // engineering-relevant time = 3600s of the 5400s active -> 0.6667
    expect(factors.engineeringShare).toBeCloseTo(3600 / 5400, 5);
    expect(factors.totalActiveSeconds).toBe(5400);
    expect(factors.totalEngineeringSeconds).toBe(3600);
    expect(factors.topApplications[0]).toMatchObject({ applicationId: 'app-revit', name: 'Revit', seconds: 3600 });
  });

  it('counts an application flagged engineering_relevance even under a non-engineering activity_type', () => {
    const rows: ActivityAggregateRow[] = [
      { durationSeconds: 1000, activityType: 'REVIEW', applicationId: 'app-x', applicationName: 'CustomTool', engineeringRelevance: true },
    ];
    const factors = computeFactors(rows);
    expect(factors.totalEngineeringSeconds).toBe(1000);
  });

  it('never fabricates a score from zero activity -- both factors are 0, not NaN or a guess', () => {
    const factors = computeFactors([]);
    expect(factors.utilization).toBe(0);
    expect(factors.engineeringShare).toBe(0);
    expect(factors.topApplications).toEqual([]);
  });
});

describe('ProductivityService.getMyScore', () => {
  it('always scopes its queries through db.withTenant for the requesting company (tenant isolation)', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([
        { durationSeconds: 3600, activityType: 'ENGINEERING', applicationId: 'app-1', applicationName: 'Revit', engineeringRelevance: true },
      ])
      .mockResolvedValueOnce([]) // DELETE (recompute-replace)
      .mockResolvedValueOnce([{ id: 'score-1' }]); // INSERT ... RETURNING *

    const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
    const svc = new ProductivityService(db as unknown as DatabaseService);

    await svc.getMyScore('company-1', 'user-1', 'week', '2026-01-05T00:00:00.000Z');

    expect(db.withTenant).toHaveBeenCalledWith('company-1', expect.any(Function));
  });

  it('replaces, rather than appends, a previously computed score for the same period and model version', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([])   // no activity in period
      .mockResolvedValueOnce([])   // DELETE existing row for this (user, period, model_version)
      .mockResolvedValueOnce([{ id: 'score-1', score: '0.00' }]);

    const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
    const svc = new ProductivityService(db as unknown as DatabaseService);

    await svc.getMyScore('company-1', 'user-1', 'day', '2026-01-05T00:00:00.000Z');

    const deleteCallText = (sqlMock.mock.calls[1][0] as string[]).join('');
    expect(deleteCallText).toContain('DELETE FROM productivity_scores');
  });
});

describe('ProductivityService.getMyScoreForRange', () => {
  it('computes over the exact [from, to) window given, not a day/week calendar boundary, and persists it as period_type "range"', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([
        { durationSeconds: 1800, activityType: 'ENGINEERING', applicationId: 'app-1', applicationName: 'Revit', engineeringRelevance: true },
      ])
      .mockResolvedValueOnce([]) // DELETE
      .mockResolvedValueOnce([{ id: 'score-1' }]); // INSERT ... RETURNING *

    const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
    const svc = new ProductivityService(db as unknown as DatabaseService);

    // A window spanning last Thursday-Friday to "now" (Tuesday) -- doesn't
    // align to any ISO week or day boundary, which is exactly the case
    // resolvePeriod()'s day/week shortcuts can't express.
    await svc.getMyScoreForRange('company-1', 'user-1', '2026-01-01T00:00:00.000Z', '2026-01-06T12:00:00.000Z');

    const selectCall = sqlMock.mock.calls[0];
    expect(selectCall[2]).toBe('2026-01-01T00:00:00.000Z'); // started_at >= from
    expect(selectCall[3]).toBe('2026-01-06T12:00:00.000Z'); // started_at < to

    const insertCall = sqlMock.mock.calls[2];
    // Positional args after the strings array: companyId, userId, periodType, periodStart, periodEnd, ...
    expect(insertCall[3]).toBe('range');
  });
});
