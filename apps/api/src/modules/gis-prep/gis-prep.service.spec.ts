import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GIS_PREP_MAX_UPLOAD_BYTES, GIS_PREP_MAX_UPLOAD_MB } from '@engineeringos/types';
import { GisPrepService, toJob } from './gis-prep.service';
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

  // The upload-size boundary (GIS_PREP_MAX_UPLOAD_MB, currently 8 MB -- see
  // that constant's own comment): just below accepts, exactly at it accepts
  // (the check is strictly-greater-than, so the limit itself is still a
  // valid upload), just above is rejected and removed. Written against the
  // constant, not a literal number, so it stays correct if that evidence-
  // based value changes again.
  it('accepts a file just below the upload limit', async () => {
    const { svc, queue, storage } = makeService([[{ id: projectId }], [row]]);
    (storage.getObjectSize as jest.Mock).mockResolvedValue(GIS_PREP_MAX_UPLOAD_BYTES - 1);
    await expect(svc.createJob(companyId, projectId, 'user-1', { storageKey: key, originalFilename: 'A.dxf', settings }))
      .resolves.toMatchObject({ status: 'QUEUED' });
    expect(queue.add).toHaveBeenCalled();
    expect(storage.deleteIfExists).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the upload limit', async () => {
    const { svc, queue, storage } = makeService([[{ id: projectId }], [row]]);
    (storage.getObjectSize as jest.Mock).mockResolvedValue(GIS_PREP_MAX_UPLOAD_BYTES);
    await expect(svc.createJob(companyId, projectId, 'user-1', { storageKey: key, originalFilename: 'A.dxf', settings }))
      .resolves.toMatchObject({ status: 'QUEUED' });
    expect(queue.add).toHaveBeenCalled();
    expect(storage.deleteIfExists).not.toHaveBeenCalled();
  });

  it('rejects and removes a file one byte over the upload limit, with an actionable message, before queuing anything', async () => {
    const { svc, queue, storage } = makeService([[{ id: projectId }]]);
    (storage.getObjectSize as jest.Mock).mockResolvedValue(GIS_PREP_MAX_UPLOAD_BYTES + 1);
    await expect(svc.createJob(companyId, projectId, 'user-1', { storageKey: key, originalFilename: 'A.dxf', settings }))
      .rejects.toMatchObject({ message: expect.stringContaining(`${GIS_PREP_MAX_UPLOAD_MB} MB`) });
    expect(storage.deleteIfExists).toHaveBeenCalledWith(key);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects an upload URL request whose declared size already exceeds the limit, before issuing a URL', async () => {
    const { svc, storage } = makeService([[{ id: projectId }]]);
    await expect(svc.getUploadUrl(companyId, projectId, 'plan.dxf', GIS_PREP_MAX_UPLOAD_BYTES + 1))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(storage.getUploadUrl).not.toHaveBeenCalled();
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

  describe('deleteJob', () => {
    it('404s when the job does not exist in this project', async () => {
      const { svc, storage } = makeService([[]]); // SELECT -> none
      await expect(svc.deleteJob(companyId, projectId, 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.deleteIfExists).not.toHaveBeenCalled();
    });

    // The real bug this guards against: parent_job_id has no ON DELETE
    // clause (migration 076), so deleting a job some later re-run still
    // points at would otherwise fail with a foreign-key violation --
    // re-running with corrected decisions is the NORMAL way a job gets
    // resolved, so this is the common case, not an edge case.
    it('detaches any re-run that points at this job, deletes the row, and removes every storage object it owns', async () => {
      const fullRow = {
        ...row,
        reportStorageKey: 'company-1/gis-prep/project-1/qc_report.json',
        packageStorageKey: 'company-1/gis-prep/project-1/package.zip',
        outputs: [{ path: 'output/a.dxf', storageKey: 'company-1/gis-prep/project-1/a.dxf', sizeBytes: 10 }],
      };
      const { svc, storage } = makeService([
        [fullRow], // SELECT
        [], // UPDATE parent_job_id = NULL
        [], // DELETE
      ]);

      await svc.deleteJob(companyId, projectId, 'job-1');

      expect(storage.deleteIfExists).toHaveBeenCalledWith(key);
      expect(storage.deleteIfExists).toHaveBeenCalledWith('company-1/gis-prep/project-1/qc_report.json');
      expect(storage.deleteIfExists).toHaveBeenCalledWith('company-1/gis-prep/project-1/package.zip');
      expect(storage.deleteIfExists).toHaveBeenCalledWith('company-1/gis-prep/project-1/a.dxf');
    });

    it('never throws when a storage object is already gone', async () => {
      const { svc, storage } = makeService([[row], [], []]);
      (storage.deleteIfExists as jest.Mock).mockRejectedValue(new Error('not found'));
      await expect(svc.deleteJob(companyId, projectId, 'job-1')).resolves.toBeUndefined();
    });
  });

  describe('bulkDelete', () => {
    it("loops the single-item delete so one bad id doesn't block the rest", async () => {
      const { svc } = makeService([
        [row], [], [], // job-1: SELECT, UPDATE, DELETE
        [], // job-2: SELECT -> not found
      ]);
      const result = await svc.bulkDelete(companyId, projectId, ['job-1', 'job-2']);
      expect(result).toEqual({ deleted: 1, failed: 1 });
    });
  });
});

describe('toJob', () => {
  it('returns the settings as stored (snake_case keys intact) so a re-run sends them unchanged', () => {
    const stored = { mode: 'convert', profile: 'bdms_building', metadata: { zone_name: 'KHALIFA CITY' }, single_unit_number: '1' };
    const job = toJob({ ...(row as never as Parameters<typeof toJob>[0]), settings: { profile: 'bdms_building', metadata: { zoneName: 'KHALIFA CITY' } } as never,
                        settingsText: JSON.stringify(stored) });
    expect(job.settings).toEqual(stored);
  });
});
