import { NotFoundException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import type { DatabaseService } from '../../../database/database.service';
import type { IngestActivitiesDto } from './dto/ingest-activities.dto';

// db.withTenant runs the callback with a fake `sql` tagged-template function.
// Each test queues one resolved value per query the service is expected to
// issue, in the order it issues them -- this exercises the service's own
// branching logic (idempotency, ownership checks) without a real Postgres
// connection, the same style bim.service.spec.ts already uses for a
// single-query case.
function makeService(sqlMock: jest.Mock) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  return { svc: new ActivitiesService(db as unknown as DatabaseService), db };
}

const companyId = 'company-1';
const userId = 'user-1';

function ingestDto(items: Partial<IngestActivitiesDto['activities'][number]>[]): IngestActivitiesDto {
  return { activities: items as IngestActivitiesDto['activities'] } as IngestActivitiesDto;
}

describe('ActivitiesService.ingest', () => {
  it('inserts a new activity and reports it as inserted', async () => {
    // No deviceId on the item -> the devices-ownership lookup is skipped
    // entirely, so only two real queries happen: the registry lookup, then
    // the insert.
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([])                     // application_registry lookup
      .mockResolvedValueOnce([{ id: 'activity-1' }]); // INSERT ... RETURNING id -> row present
    const { svc, db } = makeService(sqlMock);

    const result = await svc.ingest(companyId, userId, ingestDto([
      { applicationNameRaw: 'revit.exe', activityType: 'ENGINEERING', startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z' },
    ]));

    expect(result).toEqual({ total: 1, inserted: 1, duplicates: 0, rejected: 0 });
    expect(db.withTenant).toHaveBeenCalledWith(companyId, expect.any(Function));
  });

  it('treats a retried (deviceId, clientEventId) pair as a no-op duplicate, not an error', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'device-1' }]) // devices lookup: device is owned by this user
      .mockResolvedValueOnce([])                    // application_registry lookup
      .mockResolvedValueOnce([]);                   // INSERT ... ON CONFLICT DO NOTHING -> no row returned
    const { svc } = makeService(sqlMock);

    const result = await svc.ingest(companyId, userId, ingestDto([
      {
        deviceId: 'device-1', clientEventId: 'evt-1', applicationNameRaw: 'revit.exe',
        activityType: 'ENGINEERING', startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z',
      },
    ]));

    expect(result).toEqual({ total: 1, inserted: 0, duplicates: 1, rejected: 0 });
  });

  it('rejects an item with an invalid time range without ever touching the database insert', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([]) // application_registry lookup only -- no deviceId requested
      .mockResolvedValueOnce([{ id: 'should-not-be-reached' }]);
    const { svc } = makeService(sqlMock);

    const result = await svc.ingest(companyId, userId, ingestDto([
      { applicationNameRaw: 'revit.exe', activityType: 'ENGINEERING', startedAt: '2026-01-01T09:30:00.000Z', endedAt: '2026-01-01T09:00:00.000Z' },
    ]));

    expect(result).toEqual({ total: 1, inserted: 0, duplicates: 0, rejected: 1 });
    // Only the application_registry lookup ran -- the rejected item never reached an INSERT call.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('never trusts a deviceId that does not belong to the ingesting user (writes device_id as null instead)', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([]) // devices lookup: the requested device is NOT owned by this user -> empty
      .mockResolvedValueOnce([]) // application_registry lookup
      .mockResolvedValueOnce([{ id: 'activity-1' }]);
    const { svc } = makeService(sqlMock);

    await svc.ingest(companyId, userId, ingestDto([
      {
        deviceId: 'someone-elses-device', applicationNameRaw: 'revit.exe', activityType: 'ENGINEERING',
        startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z',
      },
    ]));

    const insertCall = sqlMock.mock.calls[2];
    // Positional args after the strings array: companyId, userId, deviceId, clientEventId, ...
    expect(insertCall[3]).toBeNull(); // deviceId written as null, not the spoofed id
  });
});

describe('ActivitiesService.attribute', () => {
  it('throws NotFoundException when the activity does not belong to the caller', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]); // activity lookup scoped by user_id finds nothing
    const { svc } = makeService(sqlMock);

    await expect(svc.attribute(companyId, userId, 'activity-1', 'project-1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the target project does not exist', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'activity-1' }]) // activity found
      .mockResolvedValueOnce([]);                     // project not found
    const { svc } = makeService(sqlMock);

    await expect(svc.attribute(companyId, userId, 'activity-1', 'missing-project')).rejects.toThrow(NotFoundException);
  });

  it('records a manual attribution at full confidence, never a computed guess', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'activity-1' }])
      .mockResolvedValueOnce([{ id: 'project-1' }])
      .mockResolvedValueOnce([{ id: 'attribution-1', projectId: 'project-1', confidence: '1.000', method: 'manual_selection' }]);
    const { svc } = makeService(sqlMock);

    const result = await svc.attribute(companyId, userId, 'activity-1', 'project-1');

    expect(result).toEqual({ id: 'attribution-1', projectId: 'project-1', confidence: '1.000', method: 'manual_selection' });
    // confidence=1.0 and method='manual_selection' are literal in the query
    // text (never interpolated from a variable) -- this is what makes "a
    // human said so" the one case confidence is asserted, not computed.
    const insertQueryText = (sqlMock.mock.calls[2][0] as string[]).join('');
    expect(insertQueryText).toContain('1.0');
    expect(insertQueryText).toContain('manual_selection');
  });
});
