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
    // entirely. Three real queries happen: the registry lookup (empty --
    // nothing registered yet), the auto-registration insert for this
    // brand-new app name, then the activity insert.
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([])                        // application_registry lookup
      .mockResolvedValueOnce([{ id: 'app-revit-new' }])  // auto-register 'revit.exe' -> INSERT ... RETURNING id
      .mockResolvedValueOnce([{ id: 'activity-1' }]);    // INSERT activities ... RETURNING id -> row present
    const { svc, db } = makeService(sqlMock);

    const result = await svc.ingest(companyId, userId, ingestDto([
      { applicationNameRaw: 'revit.exe', activityType: 'ENGINEERING', startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z' },
    ]));

    expect(result).toEqual({ total: 1, inserted: 1, duplicates: 0, rejected: 0 });
    expect(db.withTenant).toHaveBeenCalledWith(companyId, expect.any(Function));
  });

  it('auto-registers a never-before-seen app as unclassified, not silently unattributed', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([])                        // application_registry lookup -- empty
      .mockResolvedValueOnce([{ id: 'app-new-1' }])      // auto-register INSERT ... RETURNING id
      .mockResolvedValueOnce([{ id: 'activity-1' }]);
    const { svc } = makeService(sqlMock);

    await svc.ingest(companyId, userId, ingestDto([
      { applicationNameRaw: 'SomeNewTool.exe', activityType: 'ENGINEERING', startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z' },
    ]));

    const registerCall = sqlMock.mock.calls[1];
    const registerQueryText = (registerCall[0] as string[]).join('');
    expect(registerQueryText).toContain('INSERT INTO application_registry');
    expect(registerQueryText).toContain('unclassified');

    const insertCall = sqlMock.mock.calls[2];
    // Positional args after the strings array on the activities INSERT:
    // companyId, userId, deviceId, clientEventId, applicationId, ...
    expect(insertCall[5]).toBe('app-new-1');
  });

  it('registers a new app name only once per batch, reusing it for later items with the same name', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([])                     // application_registry lookup -- empty
      .mockResolvedValueOnce([{ id: 'app-new-1' }])   // auto-register (first item only)
      .mockResolvedValueOnce([{ id: 'activity-1' }])  // first item's activity insert
      .mockResolvedValueOnce([{ id: 'activity-2' }]); // second item's activity insert -- no second registry INSERT
    const { svc } = makeService(sqlMock);

    const result = await svc.ingest(companyId, userId, ingestDto([
      { applicationNameRaw: 'NewTool.exe', activityType: 'ENGINEERING', startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z' },
      { applicationNameRaw: 'NewTool.exe', activityType: 'ENGINEERING', startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:30:00.000Z' },
    ]));

    expect(result).toEqual({ total: 2, inserted: 2, duplicates: 0, rejected: 0 });
    expect(sqlMock).toHaveBeenCalledTimes(4);
  });

  it('treats a retried (deviceId, clientEventId) pair as a no-op duplicate, not an error', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'device-1' }])  // devices lookup: device is owned by this user
      .mockResolvedValueOnce([])                     // application_registry lookup
      .mockResolvedValueOnce([{ id: 'app-new-1' }])  // auto-register
      .mockResolvedValueOnce([]);                    // INSERT ... ON CONFLICT DO NOTHING -> no row returned
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
    // Only the application_registry lookup ran -- the rejected item never reached auto-registration or an INSERT call.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('never trusts a deviceId that does not belong to the ingesting user (writes device_id as null instead)', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([]) // devices lookup: the requested device is NOT owned by this user -> empty
      .mockResolvedValueOnce([]) // application_registry lookup
      .mockResolvedValueOnce([{ id: 'app-new-1' }]) // auto-register
      .mockResolvedValueOnce([{ id: 'activity-1' }]);
    const { svc } = makeService(sqlMock);

    await svc.ingest(companyId, userId, ingestDto([
      {
        deviceId: 'someone-elses-device', applicationNameRaw: 'revit.exe', activityType: 'ENGINEERING',
        startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z',
      },
    ]));

    const insertCall = sqlMock.mock.calls[3];
    // Positional args after the strings array: companyId, userId, deviceId, clientEventId, ...
    expect(insertCall[3]).toBeNull(); // deviceId written as null, not the spoofed id
  });

  it('force-redacts application name/domain/metadata for a PRIVATE item, regardless of what the client actually sent', async () => {
    // No application_registry lookup call happens here beyond ingest()'s
    // initial one -- a PRIVATE item never calls resolveOrRegisterApplicationId,
    // so there's no auto-registration INSERT to mock.
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([])                     // application_registry lookup (ingest's initial appRows)
      .mockResolvedValueOnce([{ id: 'activity-1' }]); // INSERT activities ... RETURNING id
    const { svc } = makeService(sqlMock);

    const result = await svc.ingest(companyId, userId, ingestDto([
      {
        applicationNameRaw: 'gmail.com (Personal Inbox)', domain: 'gmail.com', activityType: 'PRIVATE',
        rawMetadata: { windowTitle: 'Re: salary negotiation' },
        startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z',
      },
    ]));

    expect(result).toEqual({ total: 1, inserted: 1, duplicates: 0, rejected: 0 });
    expect(sqlMock).toHaveBeenCalledTimes(2); // never touched application_registry beyond the initial lookup

    const insertCall = sqlMock.mock.calls[1];
    // Positional args after the strings array on the activities INSERT:
    // companyId, userId, deviceId, clientEventId, applicationId, applicationNameRaw, domain, activityType, ...
    expect(insertCall[5]).toBeNull();          // applicationId -- never classified, never auto-registered
    expect(insertCall[6]).toBe('Private');     // applicationNameRaw -- the real value never reaches storage
    expect(insertCall[7]).toBeNull();          // domain -- also redacted
    expect(insertCall[12]).toBe('{}');         // rawMetadata -- the window title never reaches storage either
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
