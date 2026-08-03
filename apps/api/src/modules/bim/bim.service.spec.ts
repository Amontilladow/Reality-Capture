import { NotFoundException } from '@nestjs/common';
import { BimService } from './bim.service';

describe('BimService.getModelProvenance', () => {
  const companyId = 'company-1';
  const modelId = 'model-1';

  function makeService(modelRow: Record<string, unknown> | undefined) {
    const db = { withTenant: jest.fn().mockResolvedValue(modelRow ? [modelRow] : []) };
    const storage = {};
    const queue = {};
    // BimService only touches db/storage/ifcQueue via `this.x`, so a plain
    // object satisfies it for this unit test without a full Nest DI setup.
    return new BimService(db as any, storage as any, queue as any);
  }

  it('returns metadata only, never storage credentials/URLs/file bytes', async () => {
    const svc = makeService({
      id: modelId,
      originalFilename: 'LATEST STAIR-03.ifc',
      sourceSha256: 'a'.repeat(64),
      sourceSizeBytes: 2583629,
      fragmentsSha256: 'b'.repeat(64),
      fragmentsSizeBytes: 526017,
      generationNodeVersion: 'v22.14.0',
      generationFragmentsVersion: '3.4.6',
      generationWebIfcVersion: '0.0.77',
      generationGitCommit: 'abc1234',
      createdAt: '2026-07-28T06:42:54.471Z',
      completedAt: '2026-07-28T06:44:10.000Z',
      storageKey: 'should-not-be-exposed/original.ifc',
      fragmentsStorageKey: 'should-not-be-exposed/model.frag',
    });

    const result = await svc.getModelProvenance(companyId, modelId);

    expect(result).toEqual({
      modelId,
      originalFilename: 'LATEST STAIR-03.ifc',
      storageProvider: 'cloudflare-r2',
      sourceSha256: 'a'.repeat(64),
      sourceSizeBytes: 2583629,
      fragmentsSha256: 'b'.repeat(64),
      fragmentsSizeBytes: 526017,
      generationNodeVersion: 'v22.14.0',
      generationFragmentsVersion: '3.4.6',
      generationWebIfcVersion: '0.0.77',
      generationGitCommit: 'abc1234',
      uploadedAt: '2026-07-28T06:42:54.471Z',
      generatedAt: '2026-07-28T06:44:10.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('should-not-be-exposed');
  });

  it('reports null fields for a model that has not been (re)processed since this feature shipped', async () => {
    const svc = makeService({
      id: modelId,
      originalFilename: null,
      sourceSha256: null,
      sourceSizeBytes: null,
      fragmentsSha256: null,
      fragmentsSizeBytes: null,
      generationNodeVersion: null,
      generationFragmentsVersion: null,
      generationWebIfcVersion: null,
      generationGitCommit: null,
      createdAt: '2026-07-28T06:42:54.471Z',
      completedAt: '2026-07-28T06:44:10.000Z',
    });

    const result = await svc.getModelProvenance(companyId, modelId);

    expect(result.sourceSha256).toBeNull();
    expect(result.generationGitCommit).toBeNull();
  });

  it('throws NotFoundException for a model that does not exist', async () => {
    const svc = makeService(undefined);
    await expect(svc.getModelProvenance(companyId, 'missing')).rejects.toThrow(NotFoundException);
  });
});
