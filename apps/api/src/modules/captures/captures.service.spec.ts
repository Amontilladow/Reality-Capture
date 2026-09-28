import { CapturesService } from './captures.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { TenancyService } from '../tenancy/tenancy.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import type { Queue } from 'bull';

// syncFromMobile() is the mobile offline-queue's batch upload endpoint --
// its whole reason to exist is idempotency (a retried queue item must not
// create a second capture) and carrying the same fields registerCapture()
// accepts (description/gpsAccuracyM were added alongside this pass's fix
// to actually wire the mobile app to this endpoint instead of the plain,
// non-idempotent register() path).
describe('CapturesService.syncFromMobile', () => {
  function makeService(existingRow: Record<string, unknown> | undefined) {
    const withTenant = jest.fn().mockResolvedValue(existingRow ? [existingRow] : []);
    const db = { withTenant };
    const storage = {};
    const tenancy = {};
    const aiClient = {};
    const queue = {};
    const svc = new CapturesService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      tenancy as unknown as TenancyService,
      aiClient as unknown as AiClientService,
      queue as unknown as Queue,
    );
    return { svc, withTenant };
  }

  it('passes description and gpsAccuracyM through to register() for a new item', async () => {
    const { svc } = makeService(undefined);
    const registerSpy = jest
      .spyOn(svc, 'register')
      .mockResolvedValue({ id: 'capture-1' } as Awaited<ReturnType<typeof svc.register>>);

    const result = await svc.syncFromMobile('company-1', 'project-1', 'user-1', {
      captures: [{
        idempotencyKey: 'queue-item-1',
        storageKey: 'key-1',
        originalSizeBytes: 1024,
        originalMimeType: 'image/jpeg',
        captureType: 'photo_standard',
        capturedAt: '2026-01-01T00:00:00.000Z',
        description: 'Crack near the east stairwell',
        gpsAccuracyM: 4.2,
      }],
    });

    expect(registerSpy).toHaveBeenCalledWith('company-1', 'project-1', 'user-1', expect.objectContaining({
      description: 'Crack near the east stairwell',
      gpsAccuracyM: 4.2,
    }));
    expect(result.results[0]).toEqual({ idempotencyKey: 'queue-item-1', captureId: 'capture-1', status: 'created' });
    expect(result.summary).toEqual({ total: 1, created: 1, failed: 0, skipped: 0 });
  });

  it('recognizes an already-synced storageKey and does not create a duplicate', async () => {
    const { svc, withTenant } = makeService({ id: 'existing-capture-1' });
    const registerSpy = jest
      .spyOn(svc, 'register')
      .mockResolvedValue({ id: 'should-not-be-used' } as Awaited<ReturnType<typeof svc.register>>);

    const result = await svc.syncFromMobile('company-1', 'project-1', 'user-1', {
      captures: [{
        idempotencyKey: 'queue-item-1',
        storageKey: 'key-1',
        originalSizeBytes: 1024,
        originalMimeType: 'image/jpeg',
        captureType: 'photo_standard',
        capturedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    expect(withTenant).toHaveBeenCalled();
    expect(registerSpy).not.toHaveBeenCalled();
    expect(result.results[0]).toEqual({
      idempotencyKey: 'queue-item-1', captureId: 'existing-capture-1', status: 'already_processed',
    });
    expect(result.summary).toEqual({ total: 1, created: 0, failed: 0, skipped: 1 });
  });

  it('records a per-item failure without aborting the rest of the batch', async () => {
    const { svc } = makeService(undefined);
    jest.spyOn(svc, 'register').mockRejectedValue(new Error('storage object not found'));

    const result = await svc.syncFromMobile('company-1', 'project-1', 'user-1', {
      captures: [{
        idempotencyKey: 'queue-item-1',
        storageKey: 'key-1',
        originalSizeBytes: 1024,
        originalMimeType: 'image/jpeg',
        captureType: 'photo_standard',
        capturedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    expect(result.results[0]).toEqual({
      idempotencyKey: 'queue-item-1', captureId: null, status: 'failed', error: 'storage object not found',
    });
    expect(result.summary).toEqual({ total: 1, created: 0, failed: 1, skipped: 0 });
  });
});
