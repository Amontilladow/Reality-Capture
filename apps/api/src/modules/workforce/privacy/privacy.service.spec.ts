import { PrivacyService } from './privacy.service';
import type { DatabaseService } from '../../../database/database.service';

function makeService(sqlMock: jest.Mock) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  return new PrivacyService(db as unknown as DatabaseService);
}

const companyId = 'company-1';

describe('PrivacyService.get', () => {
  it('lazily creates the default row on first read for a company with none yet', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([]) // no existing row
      .mockResolvedValueOnce([{ id: 'settings-1', screenshotEnabled: false, windowTitleEnabled: false }]); // INSERT ... RETURNING *
    const svc = makeService(sqlMock);

    const settings = await svc.get(companyId);
    expect(settings).toEqual({ id: 'settings-1', screenshotEnabled: false, windowTitleEnabled: false });
  });

  it('returns the existing row without inserting when one is already there', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ id: 'settings-1' }]);
    const svc = makeService(sqlMock);

    const settings = await svc.get(companyId);
    expect(settings).toEqual({ id: 'settings-1' });
    expect(sqlMock).toHaveBeenCalledTimes(1); // no INSERT attempted
  });
});

describe('PrivacyService.update', () => {
  it('turns on window title capture -- the literal switch ActivitiesService.insertOne() checks', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'settings-1' }]) // get() -> existing row found
      .mockResolvedValueOnce([{ id: 'settings-1', windowTitleEnabled: true }]); // UPDATE ... RETURNING *
    const svc = makeService(sqlMock);

    const result = await svc.update(companyId, 'admin-1', { windowTitleEnabled: true });

    expect(result).toEqual({ id: 'settings-1', windowTitleEnabled: true });
    const updateQueryText = (sqlMock.mock.calls[1][0] as string[]).join('');
    expect(updateQueryText).toContain('window_title_enabled');
  });

  it('leaves window_title_enabled untouched (COALESCE) when not included in the update', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'settings-1' }])
      .mockResolvedValueOnce([{ id: 'settings-1', screenshotEnabled: true }]);
    const svc = makeService(sqlMock);

    await svc.update(companyId, 'admin-1', { screenshotEnabled: true });

    const updateCall = sqlMock.mock.calls[1];
    // Positional args order in the UPDATE: monitoringLevel, screenshotEnabled, windowTitleEnabled, ...
    expect(updateCall[3]).toBeNull(); // windowTitleEnabled not provided -> COALESCE keeps the existing value
  });
});
