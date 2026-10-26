import JSZip from 'jszip';
import { GisPrepProcessor, countsFromReport, isSafeEntryName, statusFromLabel } from './gis-prep.processor';
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
const jobRow = { id: jobId, sourceFilename: 'A-F1.dxf', sourceStorageKey: 'company-1/gis-prep/project-1/x.dxf', settings: { profile: 'bdms_building' } };
const report = { source: { sha256_before: 'abc' }, status: { counts: { ERROR: 0, WARNING: 2, INFO: 1, unresolved_layers: 1, open_fix_proposals: 0 } } };

function makeProcessor() {
  const statements: { text: string; values: unknown[] }[] = [];
  const sql = withJson((strings: unknown, ...values: unknown[]) => {
    const text = (strings as string[]).join('?');
    statements.push({ text, values });
    return Promise.resolve(text.includes('RETURNING') ? [jobRow] : []);
  });
  const db = { withTenant: jest.fn((_c: string, cb: WithTenantCallback) => cb(sql)) } as unknown as DatabaseService;
  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('dxf-bytes')),
    upload: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;
  const config = { get: jest.fn((k: string) => (k === 'app.gisPrepServiceUrl' ? 'http://gis:8002' : 'secret')) } as unknown as ConfigService;
  return { processor: new GisPrepProcessor(db, storage, config), storage, statements };
}

async function packageZip() {
  const zip = new JSZip();
  zip.file('qc_report.json', JSON.stringify(report));
  zip.file('output/A-F1.dxf', '0\nEOF\n');
  zip.file('../escape.txt', 'x');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('GisPrepProcessor', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.clearAllMocks(); });

  it('stores the returned package under the job prefix and records the tool status', async () => {
    const body = await packageZip();
    global.fetch = jest.fn().mockResolvedValue(new Response(body, {
      status: 200, headers: { 'X-M4ADM-Status': 'Blocked: warnings and open decisions must be resolved (strict mode)', 'X-M4ADM-Job': 't-1' },
    })) as never;
    const { processor, storage, statements } = makeProcessor();

    await processor.handle({ data: { jobId, companyId, projectId } } as never);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://gis:8002/prepare');
    expect(init.headers).toEqual({ 'X-Internal-Service-Secret': 'secret' });
    const keys = (storage.upload as jest.Mock).mock.calls.map(c => c[0]);
    expect(keys).toEqual(expect.arrayContaining([
      'company-1/gis-prep/project-1/job-1/qc_report.json',
      'company-1/gis-prep/project-1/job-1/output/A-F1.dxf',
      'company-1/gis-prep/project-1/job-1/package.zip',
    ]));
    expect(keys.some(k => k.includes('..'))).toBe(false);
    const final = statements[statements.length - 1];
    expect(final.values).toContain('BLOCKED');
    expect(final.values).toContainEqual({ errors: 0, warnings: 2, info: 1, openDecisions: 1 });
  });

  it('fails without retry when the service rejects the input', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'invalid settings: categories' }), { status: 422 })) as never;
    const { processor, statements } = makeProcessor();

    await expect(processor.handle({ data: { jobId, companyId, projectId } } as never)).resolves.toBeUndefined();
    const final = statements[statements.length - 1];
    expect(final.text).toContain("'FAILED'");
    expect(final.values[0]).toBe('GIS preparation service returned 422: invalid settings: categories');
  });

  it('marks the job failed and rethrows for Bull to retry when the service is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) as never;
    const { processor, statements } = makeProcessor();

    await expect(processor.handle({ data: { jobId, companyId, projectId } } as never)).rejects.toThrow('could not be reached (connect ECONNREFUSED)');
    const final = statements[statements.length - 1];
    expect(final.text).toContain("'FAILED'");
    expect(final.values[0]).toContain('engineeringos-ai-service) is running');
  });
});

describe('GisPrepProcessor conversion jobs', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.clearAllMocks(); });

  it('stores conversion_report.json as the report and maps a draft to PREPARED_WITH_WARNINGS', async () => {
    const zip = new JSZip();
    zip.file('conversion_report.json', JSON.stringify({
      kind: 'conversion', source: { sha256: 'abc' }, validation: { counts: { ERROR: 3, WARNING: 1, INFO: 0 } },
      features: [{ status: 'GENERATED_REQUIRES_REVIEW' }, { status: 'AUTO_GENERATED_HIGH_CONFIDENCE' }, { status: 'UNRESOLVED' }],
    }));
    zip.file('output/A-F1_DRAFT.dxf', '0\nEOF\n');
    const body = await zip.generateAsync({ type: 'nodebuffer' });
    global.fetch = jest.fn().mockResolvedValue(new Response(body, {
      status: 200, headers: { 'X-M4ADM-Status': 'Draft generated - NOT georeferenced - not for submission', 'X-M4ADM-Job': 'c-1', 'X-M4ADM-Kind': 'conversion' },
    })) as never;
    const { processor, statements } = makeProcessor();

    await processor.handle({ data: { jobId, companyId, projectId } } as never);

    const final = statements[statements.length - 1];
    expect(final.values).toContain('PREPARED_WITH_WARNINGS');
    expect(final.values).toContain('company-1/gis-prep/project-1/job-1/conversion_report.json');
    expect(final.values).toContainEqual({ errors: 3, warnings: 1, info: 0, openDecisions: 2 });
    expect(final.values).toContain('abc');
  });
});

describe('gis-prep helpers', () => {
  it('never maps an unknown or blocked label to a ready status', () => {
    expect(statusFromLabel('Ready for review')).toBe('READY_FOR_REVIEW');
    expect(statusFromLabel('Prepared with warnings')).toBe('PREPARED_WITH_WARNINGS');
    expect(statusFromLabel('Blocked by errors')).toBe('BLOCKED');
    expect(statusFromLabel('')).toBe('BLOCKED');
    expect(statusFromLabel('Blocked: no draft could be generated')).toBe('BLOCKED');
    expect(statusFromLabel('Draft generated - requires engineer review')).toBe('PREPARED_WITH_WARNINGS');
  });

  it('counts open decisions from unresolved layers and fix proposals', () => {
    expect(countsFromReport({}).openDecisions).toBe(0);
    expect(countsFromReport(report)).toEqual({ errors: 0, warnings: 2, info: 1, openDecisions: 1 });
  });

  it('rejects zip entry names that could escape the job prefix', () => {
    expect(isSafeEntryName('output/A.dxf')).toBe(true);
    for (const bad of ['../x', '/abs', 'a//b', 'a\\b', 'a/../b']) expect(isSafeEntryName(bad)).toBe(false);
  });
});
