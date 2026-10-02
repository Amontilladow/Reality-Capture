import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ScreenshotsService } from './screenshots.service';
import type { DatabaseService } from '../../../database/database.service';
import type { StorageService } from '../../storage/storage.service';

const OWN_KEY = 'company-1/workforce-screenshots/user-1/abc.jpg';

function makeService(sqlMock: jest.Mock, storageOverrides: Partial<StorageService> = {}) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  const storage = {
    generateWorkforceScreenshotKey: jest.fn(() => OWN_KEY),
    getUploadUrl: jest.fn(async (key: string) => ({ uploadUrl: `https://upload/${key}`, storageKey: key })),
    resolveUrls: jest.fn(async (keys: string[]) => new Map(keys.map(k => [k, `https://read/${k}`]))),
    delete: jest.fn(async () => undefined),
    getObjectSize: jest.fn(async () => 1024),
    deleteIfExists: jest.fn(async () => undefined),
    ...storageOverrides,
  };
  return { svc: new ScreenshotsService(db as unknown as DatabaseService, storage as unknown as StorageService), db, storage };
}

describe('ScreenshotsService.getUploadUrl -- the one enforcement point', () => {
  it('throws ForbiddenException, and never issues an upload URL, when the company has screenshots disabled', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ screenshotEnabled: false }]);
    const { svc, storage } = makeService(sqlMock);

    await expect(svc.getUploadUrl('company-1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(storage.getUploadUrl).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the company has no privacy settings row at all (fails closed, not open)', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]); // no row
    const { svc, storage } = makeService(sqlMock);

    await expect(svc.getUploadUrl('company-1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(storage.getUploadUrl).not.toHaveBeenCalled();
  });

  it('issues an upload URL once the company has screenshots enabled', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ screenshotEnabled: true }]);
    const { svc, storage } = makeService(sqlMock);

    const result = await svc.getUploadUrl('company-1', 'user-1');

    expect(result.uploadUrl).toContain('workforce-screenshots/user-1');
    expect(storage.getUploadUrl).toHaveBeenCalledTimes(1);
  });
});

describe('ScreenshotsService.record -- defense in depth', () => {
  it('re-checks screenshot_enabled and refuses to record even if called directly', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ screenshotEnabled: false }]);
    const { svc } = makeService(sqlMock);

    await expect(svc.record('company-1', 'user-1', { storageKey: OWN_KEY, capturedAt: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(ForbiddenException);
    expect(sqlMock).toHaveBeenCalledTimes(1); // never reached the INSERT
  });

  it('rejects a storageKey outside the caller\'s own namespace (cross-user/cross-company key)', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ screenshotEnabled: true }]);
    const { svc, storage } = makeService(sqlMock);

    await expect(svc.record('company-1', 'user-1', { storageKey: 'company-2/workforce-screenshots/someone-else/x.jpg', capturedAt: '2026-01-01T00:00:00.000Z' }))
      .rejects.toThrow(ForbiddenException);
    expect(storage.getObjectSize).not.toHaveBeenCalled();
    expect(sqlMock).toHaveBeenCalledTimes(1); // never reached the INSERT
  });

  it('rejects, with no cleanup attempted, when the object was never actually uploaded', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ screenshotEnabled: true }]);
    const { svc, storage } = makeService(sqlMock, { getObjectSize: jest.fn(async () => null) });

    await expect(svc.record('company-1', 'user-1', { storageKey: OWN_KEY, capturedAt: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(BadRequestException);
    expect(storage.deleteIfExists).not.toHaveBeenCalled();
    expect(sqlMock).toHaveBeenCalledTimes(1); // never reached the INSERT
  });

  it('rejects and cleans up an oversized upload instead of trusting the client', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ screenshotEnabled: true }]);
    const oversized = 11 * 1024 * 1024;
    const { svc, storage } = makeService(sqlMock, { getObjectSize: jest.fn(async () => oversized) });

    await expect(svc.record('company-1', 'user-1', { storageKey: OWN_KEY, capturedAt: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(BadRequestException);
    expect(storage.deleteIfExists).toHaveBeenCalledWith(OWN_KEY);
    expect(sqlMock).toHaveBeenCalledTimes(1); // never reached the INSERT
  });

  it('records the screenshot when enabled, in-namespace, and within the real verified size', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ screenshotEnabled: true }])
      .mockResolvedValueOnce([{ id: 'shot-1', storageKey: OWN_KEY }]);
    const { svc } = makeService(sqlMock);

    const result = await svc.record('company-1', 'user-1', { storageKey: OWN_KEY, capturedAt: '2026-01-01T00:00:00.000Z' });
    expect(result).toEqual({ id: 'shot-1', storageKey: OWN_KEY });
  });
});

describe('ScreenshotsService.listForUser -- reuses workforce-visibility.util verbatim', () => {
  it('throws ForbiddenException when the caller has no visibility into the target (identical rule to activities/productivity)', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ screenshotEnabled: true }]) // assertScreenshotsEnabled
      .mockResolvedValueOnce([]); // resolveVisibleTargetUserId's own downline-resolution query returns no match
    const { svc } = makeService(sqlMock);

    await expect(svc.listForUser('company-1', 'someone-else', 'project_manager', 'target-1')).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the company has since disabled screenshots, even for a self-view of historical data', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ screenshotEnabled: false }]);
    const { svc } = makeService(sqlMock);

    await expect(svc.listForUser('company-1', 'user-1', 'client_representative', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it("returns presigned read URLs for the caller's own screenshots (self-view, no visibility query needed)", async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ screenshotEnabled: true }]) // assertScreenshotsEnabled
      .mockResolvedValueOnce([
        { id: 'shot-1', storageKey: 'k1', capturedAt: '2026-01-02T00:00:00.000Z' },
      ]);
    const { svc, storage } = makeService(sqlMock);

    const result = await svc.listForUser('company-1', 'user-1', 'client_representative', 'user-1');

    expect(result).toEqual([{ id: 'shot-1', capturedAt: '2026-01-02T00:00:00.000Z', url: 'https://read/k1' }]);
    expect(storage.resolveUrls).toHaveBeenCalledWith(['k1']);
  });
});

describe('ScreenshotsService.cleanupExpiredScreenshots', () => {
  it('deletes both the storage object and the row for each expired screenshot, per company', async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ id: 'shot-1', storageKey: 'expired-key' }]) // SELECT expired
      .mockResolvedValueOnce([]); // DELETE
    const db = {
      withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)),
      withSystemBypass: jest.fn(async (fn: (sql: unknown) => unknown) => fn(jest.fn().mockResolvedValueOnce([{ companyId: 'company-1', retentionDays: 90 }]))),
    };
    const storage = { delete: jest.fn(async () => undefined) };
    const svc = new ScreenshotsService(db as unknown as DatabaseService, storage as unknown as StorageService);

    await svc.cleanupExpiredScreenshots();

    expect(storage.delete).toHaveBeenCalledWith('expired-key');
    expect(db.withTenant).toHaveBeenCalledWith('company-1', expect.any(Function));
  });

  it('never throws even if a per-company cleanup fails (logged, not fatal to the cron)', async () => {
    const db = {
      withSystemBypass: jest.fn(async () => { throw new Error('cross-company retention scan failed'); }),
    };
    const svc = new ScreenshotsService(db as unknown as DatabaseService, {} as unknown as StorageService);

    await expect(svc.cleanupExpiredScreenshots()).resolves.toBeUndefined();
  });
});
