import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GisPrepService } from './gis-prep.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';

type WithTenantCallback = (sql: unknown) => unknown;

function withJson(sql: (...args: unknown[]) => Promise<unknown>) {
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return sql;
}

const companyId = 'company-1';
const projectId = 'project-1';
const key = 'company-1/gis-prep/project-1/abc.dxf';
const settings = { profile: 'bdms_building', categories: ['building'] };
const row = {
  id: 'job-1', companyId, projectId, profile: 'bdms_building', sourceFilename: 'A.dxf', sourceStorageKey: key, sourceSha256: null,
  status: 'QUEUED', statusLabel: null, toolJobId: null, counts: null, settings, outputs: [], reportStorageKey: null,
  packageStorageKey: null, errorMessage: null, parentJobId: null, createdBy: 'user-1', startedAt: null, finishedAt: null, createdAt: 'now',
};

function makeService(results: unknown[][]) {
  let i = 0;
  const sql = withJson(() => Promise.resolve(results[i++] ?? []));
  const db = { withTenant: jest.fn((_c: string, cb: WithTenantCallback) => cb(sql)) } as unknown as DatabaseService;
  const storage = {
    getObjectSize: jest.fn().mockResolvedValue(1024),
    deleteIfExists: jest.fn(),
    generateKey: jest.fn().mockReturnValue(key),
    getUploadUrl: jest.fn().mockResolvedValue({ url: 'https://put' }),
    getReadUrl: jest.fn().mockResolvedValue('https://get'),
    download: jest.fn(),
  } as unknown as StorageService;
  const queue = { add: jest.fn() };
  return { svc: new GisPrepService(db, storage, queue as never), storage, queue };
}

describe('GisPrepService', () => {
  it('only accepts DXF and DWG uploads', async () => {
    const { svc } = makeService([[{ id: projectId }], [{ id: projectId }]]);
    await expect(svc.getUploadUrl(companyId, projectId, 'plan.pdf')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.getUploadUrl(companyId, projectId, 'plan.DWG')).resolves.toMatchObject({ storageKey: key });
  });

  it('creates a job and queues it', async () => {
    const { svc, queue } = makeService([[{ id: projectId }], [row]]);
    const job = await svc.createJob(companyId, projectId, 'user-1', { storageKey: key, originalFilename: 'A.dxf', settings });
    expect(job.status).toBe('QUEUED');
    expect(queue.add).toHaveBeenCalledWith('run-gis-prep', { jobId: 'job-1', companyId, projectId }, expect.anything());
  });

  it('refuses a storage key issued for another project', async () => {
    const { svc, queue } = makeService([[{ id: projectId }]]);
    await expect(svc.createJob(companyId, projectId, 'user-1', { storageKey: 'company-2/gis-prep/p/x.dxf', originalFilename: 'A.dxf', settings }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses an unknown profile', async () => {
    const { svc } = makeService([[{ id: projectId }]]);
    await expect(svc.createJob(companyId, projectId, 'user-1', { storageKey: key, originalFilename: 'A.dxf', settings: { profile: 'x' } }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes an oversized upload', async () => {
    const { svc, storage } = makeService([[{ id: projectId }]]);
    (storage.getObjectSize as jest.Mock).mockResolvedValue(600 * 1024 * 1024);
    await expect(svc.createJob(companyId, projectId, 'user-1', { storageKey: key, originalFilename: 'A.dxf', settings }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(storage.deleteIfExists).toHaveBeenCalledWith(key);
  });

  it('re-runs on the same original drawing as a new job linked to its parent', async () => {
    const { svc, queue } = makeService([[row], [{ ...row, id: 'job-2', parentJobId: 'job-1' }]]);
    const job = await svc.rerunJob(companyId, projectId, 'user-1', 'job-1', settings);
    expect(job.parentJobId).toBe('job-1');
    expect(job.sourceStorageKey).toBe(key);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a job outside the project', async () => {
    const { svc } = makeService([[]]);
    await expect(svc.getJob(companyId, projectId, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
