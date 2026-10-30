import JSZip from 'jszip';
import { EvacPlansProcessor, isSafeEntryName, statusFromReport } from './evac-plans.processor';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { ConfigService } from '@nestjs/config';

type WithTenantCallback = (sql: unknown) => unknown;

function withJson(sql: (...args: unknown[]) => Promise<unknown>) {
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return sql;
}

const companyId = 'company-1';
const projectId = 'project-1';
const jobId = 'job-1';
const jobRow = {
  id: jobId,
  sourceFiles: [
    { filename: 'Ground_Floor-01.pdf', storageKey: 'company-1/evac-plans/project-1/a.pdf', sizeBytes: 10 },
    { filename: 'Roof_Floor-01.pdf', storageKey: 'company-1/evac-plans/project-1/b.pdf', sizeBytes: 10 },
  ],
  logoStorageKey: 'company-1/evac-plans/project-1/logo.png',
  settings: { revision: 'P01' },
  settingsText: JSON.stringify({ revision: 'P01', notes: ['keep_snake_case'] }),
};
const report = { kind: 'evacuation-plans', status: 'NEEDS_ATTENTION', statusLabel: '1 sheet(s) need attention before review', sheets: [] };

function makeProcessor(row: Record<string, unknown> | null = jobRow) {
  const statements: { text: string; values: unknown[] }[] = [];
  const sql = withJson((strings: unknown, ...values: unknown[]) => {
    const text = (strings as string[]).join('?');
    statements.push({ text, values });
    return Promise.resolve(text.includes('RETURNING') ? (row ? [row] : []) : []);
  });
  const db = { withTenant: jest.fn((_c: string, cb: WithTenantCallback) => cb(sql)) } as unknown as DatabaseService;
  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
    upload: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;
  const config = {
    get: jest.fn((k: string) => (k === 'app.evacPlanServiceUrl' ? 'http://evac:8003' : k === 'app.evacPlanPollMs' ? 0 : 'secret')),
  } as unknown as ConfigService;
  return { processor: new EvacPlansProcessor(db, storage, config), storage, statements };
}

async function resultZip() {
  const zip = new JSZip();
  zip.file('report.json', JSON.stringify(report));
  zip.file('evacuation_plans.pdf', '%PDF-1.7');
  zip.file('sheets/GF-01.pdf', '%PDF-1.7');
  zip.file('previews/GF-01.png', 'png');
  zip.file('../escape.txt', 'x');
  return zip.generateAsync({ type: 'nodebuffer' });
}

// The service: POST /jobs -> id; GET /jobs/id -> running then done; GET result; DELETE.
function serviceMock(final: Record<string, unknown> = { status: 'done', progress: { stage: 'done', done: 5, total: 5 } }, zip?: Buffer) {
  const states = [{ status: 'running', progress: { stage: 'building', done: 1, total: 5 } }, final];
  return jest.fn(async (url: string, init: { method: string }) => {
    if (init.method === 'POST') return new Response(JSON.stringify({ id: 'svc-1' }), { status: 200 });
    if (init.method === 'DELETE') return new Response('{}', { status: 200 });
    if (url.endsWith('/result')) return new Response(zip!, { status: 200 });
    return new Response(JSON.stringify(states.shift() ?? final), { status: 200 });
  });
}

describe('EvacPlansProcessor', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.clearAllMocks(); });

  it('uploads every drawing, the logo and the stored settings, then stores the package under the job prefix', async () => {
    global.fetch = serviceMock(undefined, await resultZip()) as never;
    const { processor, storage, statements } = makeProcessor();

    await processor.handle({ data: { jobId, companyId, projectId } } as never);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://evac:8003/jobs');
    expect(init.headers).toEqual({ 'X-Internal-Service-Secret': 'secret' });
    const form = init.body as FormData;
    expect((form.getAll('drawings') as File[]).map(f => f.name)).toEqual(['Ground_Floor-01.pdf', 'Roof_Floor-01.pdf']);
    expect((form.get('logo') as File).name).toBe('logo.png');
    expect(JSON.parse(form.get('settings') as string)).toEqual({ revision: 'P01', notes: ['keep_snake_case'] });

    const keys = (storage.upload as jest.Mock).mock.calls.map(c => c[0]);
    expect(keys).toEqual(expect.arrayContaining([
      'company-1/evac-plans/project-1/job-1/report.json',
      'company-1/evac-plans/project-1/job-1/evacuation_plans.pdf',
      'company-1/evac-plans/project-1/job-1/sheets/GF-01.pdf',
      'company-1/evac-plans/project-1/job-1/package.zip',
    ]));
    expect(keys.some(k => k.includes('..'))).toBe(false);

    const progressWrites = statements.filter(s => s.text.includes('SET progress'));
    expect(progressWrites.length).toBe(2);
    const final = statements.find(s => s.text.includes('report_storage_key'))!;
    expect(final.values).toContain('NEEDS_ATTENTION');
    expect(final.values).toContain('company-1/evac-plans/project-1/job-1/evacuation_plans.pdf');
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls[calls.length - 1]).toEqual(['http://evac:8003/jobs/svc-1', expect.objectContaining({ method: 'DELETE' })]);
  });

  it('marks a rejected input FAILED without a retry', async () => {
    global.fetch = serviceMock({ status: 'failed', rejected: true, error: 'None of the uploaded PDFs could be read as an evacuation plan' }) as never;
    const { processor, statements } = makeProcessor();

    await expect(processor.handle({ data: { jobId, companyId, projectId } } as never)).resolves.toBeUndefined();

    const failed = statements.find(s => s.text.includes("status = 'FAILED'"))!;
    expect(String(failed.values[0])).toContain('could be read as an evacuation plan');
  });

  it('rethrows a transient failure so the queue retries it', async () => {
    global.fetch = serviceMock({ status: 'failed', rejected: false, error: 'engine crashed' }) as never;
    const { processor } = makeProcessor();
    await expect(processor.handle({ data: { jobId, companyId, projectId } } as never)).rejects.toThrow('engine crashed');
  });

  it('explains an unreachable service in words an engineer can act on', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: new Error('ECONNREFUSED') })) as never;
    const { processor } = makeProcessor();
    await expect(processor.handle({ data: { jobId, companyId, projectId } } as never)).rejects.toThrow(/could not be reached \(ECONNREFUSED\)/);
  });
});

describe('statusFromReport', () => {
  it('only the explicit clean status is ready for review', () => {
    expect(statusFromReport({ status: 'READY_FOR_REVIEW' })).toBe('READY_FOR_REVIEW');
    expect(statusFromReport({ status: 'NEEDS_ATTENTION' })).toBe('NEEDS_ATTENTION');
    expect(statusFromReport({ status: 'SOMETHING_NEW' as never })).toBe('NEEDS_ATTENTION');
  });
});

describe('isSafeEntryName', () => {
  it('refuses paths that could escape the job prefix', () => {
    expect(isSafeEntryName('sheets/GF-01.pdf')).toBe(true);
    expect(isSafeEntryName('../x')).toBe(false);
    expect(isSafeEntryName('/abs')).toBe(false);
    expect(isSafeEntryName('a\\b')).toBe(false);
  });
});
