import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EvacPlansService, cleanSettings, toJob } from './evac-plans.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';

type WithTenantCallback = (sql: unknown) => unknown;

function withJson(sql: (...args: unknown[]) => Promise<unknown>) {
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return sql;
}

const companyId = 'company-1';
const projectId = 'project-1';
const pdfKey = 'company-1/evac-plans/project-1/a.pdf';
const logoKey = 'company-1/evac-plans/project-1/logo.png';
const row = {
  id: 'job-1', companyId, projectId, sourceFiles: [{ filename: 'A.pdf', storageKey: pdfKey, sizeBytes: 1024 }],
  logoStorageKey: logoKey, settings: {}, status: 'QUEUED', statusLabel: null, progress: null, serviceJobId: null, outputs: [],
  reportStorageKey: null, planPdfStorageKey: null, packageStorageKey: null, errorMessage: null, parentJobId: null,
  createdBy: 'user-1', startedAt: null, finishedAt: null, createdAt: 'now',
};

function makeService(results: unknown[][]) {
  let i = 0;
  const calls: unknown[][] = [];
  const sql = withJson((...args: unknown[]) => { calls.push(args); return Promise.resolve(results[i++] ?? []); });
  const db = { withTenant: jest.fn((_c: string, cb: WithTenantCallback) => cb(sql)) } as unknown as DatabaseService;
  const storage = {
    getObjectSize: jest.fn().mockResolvedValue(1024),
    deleteIfExists: jest.fn(),
    generateKey: jest.fn().mockReturnValue(pdfKey),
    getUploadUrl: jest.fn().mockResolvedValue({ uploadUrl: 'https://put', storageKey: pdfKey }),
    getReadUrl: jest.fn().mockResolvedValue('https://get'),
    download: jest.fn().mockResolvedValue(Buffer.from(JSON.stringify({ status: 'READY_FOR_REVIEW', sheets: [] }))),
  } as unknown as StorageService;
  const queue = { add: jest.fn() };
  return { svc: new EvacPlansService(db, storage, queue as never), storage, queue, calls };
}

describe('EvacPlansService', () => {
  it('accepts PDFs as drawings and PNG/JPG as the logo only', async () => {
    const { svc } = makeService([[{ id: projectId }], [{ id: projectId }], [{ id: projectId }], [{ id: projectId }]]);
    await expect(svc.getUploadUrl(companyId, projectId, 'Ground_Floor-01.pdf', 'drawing')).resolves.toMatchObject({ storageKey: pdfKey });
    await expect(svc.getUploadUrl(companyId, projectId, 'plan.dwg', 'drawing')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.getUploadUrl(companyId, projectId, 'logo.jpg', 'logo')).resolves.toBeDefined();
    await expect(svc.getUploadUrl(companyId, projectId, 'logo.pdf', 'logo')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses storage keys issued for another company or project', async () => {
    const { svc } = makeService([[{ id: projectId }]]);
    await expect(svc.createJob(companyId, projectId, 'user-1', {
      files: [{ storageKey: 'company-2/evac-plans/project-1/a.pdf', filename: 'a.pdf' }],
    })).rejects.toThrow('not issued for this project');
  });

  it('rejects and removes an upload over the size limit', async () => {
    const { svc, storage } = makeService([[{ id: projectId }]]);
    (storage.getObjectSize as jest.Mock).mockResolvedValue(200 * 1024 * 1024);
    await expect(svc.createJob(companyId, projectId, 'user-1', { files: [{ storageKey: pdfKey, filename: 'a.pdf' }] }))
      .rejects.toThrow('exceeds');
    expect(storage.deleteIfExists).toHaveBeenCalledWith(pdfKey);
  });

  it('creates the job and queues it, reusing an earlier logo when asked', async () => {
    const { svc, queue } = makeService([[{ id: projectId }], [row], [{ ...row, id: 'job-2' }]]);
    const job = await svc.createJob(companyId, projectId, 'user-1', {
      files: [{ storageKey: pdfKey, filename: 'A.pdf' }], reuseLogoFromJobId: '11111111-1111-1111-1111-111111111111',
      settings: { revision: ' P02 ', notes: ['  ', 'Mezzanine voids to confirm'] },
    });
    expect(job.id).toBe('job-2');
    expect(queue.add).toHaveBeenCalledWith('run-evac-plans', { jobId: 'job-2', companyId, projectId }, expect.any(Object));
  });

  it('404s an unknown job', async () => {
    const { svc } = makeService([[]]);
    await expect(svc.getJob(companyId, projectId, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adds download links and the report on the single-job read', async () => {
    const done = { ...row, status: 'READY_FOR_REVIEW', outputs: [{ path: 'previews/GF-01.png', storageKey: 'k', sizeBytes: 1 }],
      reportStorageKey: 'r', planPdfStorageKey: 'p', packageStorageKey: 'z' };
    const { svc } = makeService([[done]]);
    const job = await svc.getJob(companyId, projectId, 'job-1');
    expect(job.planPdfUrl).toBe('https://get');
    expect(job.packageUrl).toBe('https://get');
    expect(job.outputs[0].url).toBe('https://get');
    expect(job.report?.status).toBe('READY_FOR_REVIEW');
  });
});

describe('cleanSettings', () => {
  it('keeps only a trimmed revision and non-empty notes', () => {
    expect(cleanSettings({ revision: ' P01 ', notes: ['', ' a ', 3 as never] })).toEqual({ revision: 'P01', notes: ['a'] });
    expect(cleanSettings(undefined)).toEqual({});
  });
});

describe('toJob', () => {
  it('reads settings from the stored text so keys keep their case', () => {
    const job = toJob({ ...row, settings: { revision: 'x' }, settingsText: JSON.stringify({ revision: 'P01', notes: ['n_1'] }) } as never);
    expect(job.settings).toEqual({ revision: 'P01', notes: ['n_1'] });
  });
});
