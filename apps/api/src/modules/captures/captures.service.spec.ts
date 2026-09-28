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

// register()'s real body (not mocked out, unlike the syncFromMobile tests
// above) -- covers the post-upload size-enforcement fix: the presigned PUT
// this app hands out has no enforced size limit, so real enforcement has to
// happen here, against the object actually sitting in storage, not whatever
// size the client declared. Also covers the project-ownership check added
// alongside it (captures.controller.ts has no @RequireProjectPermission
// gate on these routes, unlike issues/rfis/snagging).
describe('CapturesService.register', () => {
  const BASE_DTO = {
    storageKey: 'company-1/captures/project-1/file.jpg',
    originalMimeType: 'image/jpeg',
    captureType: 'photo_standard' as const,
    capturedAt: '2026-01-01T00:00:00.000Z',
  };

  function makeService(opts: {
    projectExists?: boolean;
    actualSizeBytes: number | null;
    storageUsedBytes?: number;
    maxStorageBytes?: number | null;
  }) {
    const projectExists = opts.projectExists ?? true;
    const withTenant = jest.fn()
      // 1. assertProjectBelongsToCompany's SELECT
      .mockResolvedValueOnce(projectExists ? [{ id: 'project-1' }] : [])
      // 2. checkStorageLimit's SELECT (only reached if the size check passes)
      .mockResolvedValueOnce([{
        storageUsedBytes: opts.storageUsedBytes ?? 0,
        maxBytes: opts.maxStorageBytes === undefined ? null : opts.maxStorageBytes,
      }])
      // 3. the INSERT
      .mockResolvedValueOnce([{ id: 'capture-1' }]);

    const getObjectSize = jest.fn().mockResolvedValue(opts.actualSizeBytes);
    const deleteIfExists = jest.fn().mockResolvedValue(undefined);
    const incrementStorage = jest.fn().mockResolvedValue(undefined);
    const queueAdd = jest.fn().mockResolvedValue(undefined);
    const ingestCapture = jest.fn().mockResolvedValue(undefined);

    const db = { withTenant };
    const storage = { getObjectSize, deleteIfExists };
    const tenancy = { incrementStorage };
    const aiClient = { ingestCapture };
    const queue = { add: queueAdd };

    const svc = new CapturesService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      tenancy as unknown as TenancyService,
      aiClient as unknown as AiClientService,
      queue as unknown as Queue,
    );
    return { svc, withTenant, getObjectSize, deleteIfExists, incrementStorage, queueAdd };
  }

  it('registers a capture whose real uploaded size is within the limit', async () => {
    const { svc, incrementStorage, queueAdd, deleteIfExists } = makeService({ actualSizeBytes: 5 * 1024 * 1024 });

    const capture = await svc.register('company-1', 'project-1', 'user-1', { ...BASE_DTO, originalSizeBytes: 1 });

    expect(capture).toEqual({ id: 'capture-1' });
    expect(incrementStorage).toHaveBeenCalledWith('company-1', 5 * 1024 * 1024);
    expect(queueAdd).toHaveBeenCalled();
    expect(deleteIfExists).not.toHaveBeenCalled();
  });

  it('rejects and deletes an upload whose real size exceeds the limit for its capture type, regardless of the declared size', async () => {
    const { svc, deleteIfExists, incrementStorage } = makeService({ actualSizeBytes: 21 * 1024 * 1024 }); // > 20 MB photo limit

    await expect(
      svc.register('company-1', 'project-1', 'user-1', { ...BASE_DTO, originalSizeBytes: 1 }), // client lied
    ).rejects.toThrow(/exceeds the limit/);

    expect(deleteIfExists).toHaveBeenCalledWith(BASE_DTO.storageKey);
    expect(incrementStorage).not.toHaveBeenCalled();
  });

  it('rejects registration when the declared storage key was never actually uploaded', async () => {
    const { svc, deleteIfExists } = makeService({ actualSizeBytes: null });

    await expect(
      svc.register('company-1', 'project-1', 'user-1', { ...BASE_DTO, originalSizeBytes: 1024 }),
    ).rejects.toThrow(/not found in storage/);

    // Nothing to clean up -- the object never existed.
    expect(deleteIfExists).not.toHaveBeenCalled();
  });

  it('rejects registration against a project that does not belong to the caller\'s company', async () => {
    const { svc, getObjectSize } = makeService({ projectExists: false, actualSizeBytes: 1024 });

    await expect(
      svc.register('company-1', 'someone-elses-project', 'user-1', { ...BASE_DTO, originalSizeBytes: 1024 }),
    ).rejects.toThrow(/not found/);

    // Never even gets to checking the upload -- the project check runs first.
    expect(getObjectSize).not.toHaveBeenCalled();
  });

  it('rejects and cleans up when the verified size would push the company over its storage quota', async () => {
    const { svc, deleteIfExists } = makeService({
      actualSizeBytes: 5 * 1024 * 1024,
      storageUsedBytes: 99 * 1024 * 1024,
      maxStorageBytes: 100 * 1024 * 1024, // 5 MB more would exceed the 100 MB cap
    });

    await expect(
      svc.register('company-1', 'project-1', 'user-1', { ...BASE_DTO, originalSizeBytes: 1 }),
    ).rejects.toThrow(/Storage limit reached/);

    expect(deleteIfExists).toHaveBeenCalledWith(BASE_DTO.storageKey);
  });
});
