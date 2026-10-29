import { NotFoundException, BadRequestException } from '@nestjs/common';
import type { Queue } from 'bull';
import { BimService } from './bim.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { IssuesService } from '../issues/issues.service';

describe('BimService.getModelProvenance', () => {
  const companyId = 'company-1';
  const modelId = 'model-1';

  function makeService(modelRow: Record<string, unknown> | undefined) {
    const db = { withTenant: jest.fn().mockResolvedValue(modelRow ? [modelRow] : []) };
    const storage = {};
    const issues = {};
    const queue = {};
    // BimService only touches db/storage/issues/ifcQueue via `this.x`, so a
    // plain object satisfies it for this unit test without a full Nest DI setup.
    return new BimService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      issues as unknown as IssuesService,
      queue as unknown as Queue,
    );
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

    const result = await svc.getModelProvenance(companyId, 'project-1', modelId);

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

    const result = await svc.getModelProvenance(companyId, 'project-1', modelId);

    expect(result.sourceSha256).toBeNull();
    expect(result.generationGitCommit).toBeNull();
  });

  it('throws NotFoundException for a model that does not exist', async () => {
    const svc = makeService(undefined);
    await expect(svc.getModelProvenance(companyId, 'project-1', 'missing')).rejects.toThrow(NotFoundException);
  });
});

describe('BimService.createPinForElement', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const elementId = 'element-1';

  it("forwards an optional assignedTo straight through to the auto-created Issue, same as drawings.service.ts's createPin()", async () => {
    const withTenant = jest.fn().mockResolvedValue([{ id: 'loc-1', name: 'Untitled pin', elementId }]);
    const db = { withTenant };
    const storage = {};
    const issues = { create: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
    const queue = {};
    const svc = new BimService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      issues as unknown as IssuesService,
      queue as unknown as Queue,
    );

    await svc.createPinForElement(companyId, projectId, elementId, 'user-1', 'Untitled pin', 'user-engineer');

    expect(issues.create).toHaveBeenCalledWith(
      companyId, projectId, 'user-1',
      expect.objectContaining({ elementId, assignedTo: 'user-engineer' }),
    );
  });

  it('passes assignedTo through as undefined when the caller omits it', async () => {
    const withTenant = jest.fn().mockResolvedValue([{ id: 'loc-1', name: 'Untitled pin', elementId }]);
    const db = { withTenant };
    const storage = {};
    const issues = { create: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
    const queue = {};
    const svc = new BimService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      issues as unknown as IssuesService,
      queue as unknown as Queue,
    );

    await svc.createPinForElement(companyId, projectId, elementId, 'user-1', 'Untitled pin');

    expect(issues.create).toHaveBeenCalledWith(
      companyId, projectId, 'user-1',
      expect.objectContaining({ assignedTo: undefined }),
    );
  });
});

describe('BimService.getModelUploadUrl', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';

  function makeService(opts?: {
    projectExists?: boolean;
    getUploadUrl?: jest.Mock;
  }) {
    const projectExists = opts?.projectExists ?? true;
    const withTenant = jest.fn().mockResolvedValue(projectExists ? [{ id: projectId }] : []);
    const db = { withTenant };
    const getUploadUrl = opts?.getUploadUrl ?? jest.fn().mockResolvedValue({ uploadUrl: 'https://example.invalid/put' });
    const storage = { generateKey: jest.fn().mockReturnValue('storage/key.ifc'), getUploadUrl };
    const issues = {};
    const queue = {};
    return { svc: new BimService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      issues as unknown as IssuesService,
      queue as unknown as Queue,
    ), storage, withTenant };
  }

  it('rejects a filename with no recognized model extension before issuing an upload URL', async () => {
    const { svc, storage } = makeService();
    await expect(svc.getModelUploadUrl(companyId, projectId, 'malware.exe')).rejects.toThrow(BadRequestException);
    expect(storage.getUploadUrl).not.toHaveBeenCalled();
  });

  it('allows a real .ifc filename, case-insensitively', async () => {
    const { svc, storage } = makeService();
    await svc.getModelUploadUrl(companyId, projectId, 'Model.IFC');
    expect(storage.getUploadUrl).toHaveBeenCalled();
  });

  it("rejects a project that does not belong to the caller's company before issuing an upload URL", async () => {
    const { svc, storage } = makeService({ projectExists: false });
    await expect(svc.getModelUploadUrl(companyId, 'someone-elses-project', 'Model.ifc')).rejects.toThrow(NotFoundException);
    expect(storage.getUploadUrl).not.toHaveBeenCalled();
  });
});

describe('BimService.updateElementStatus (F2)', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const elementId = 'element-1';

  function makeService(existingStatus: string | null) {
    const withTenant = jest.fn()
      .mockResolvedValueOnce([{ constructionStatus: existingStatus }])
      .mockResolvedValueOnce([{ id: elementId, constructionStatus: 'in_progress', completionPct: 50 }])
      .mockResolvedValueOnce([]);
    const db = { withTenant };
    const storage = {};
    const issues = {};
    const queue = {};
    const svc = new BimService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      issues as unknown as IssuesService,
      queue as unknown as Queue,
    );
    return { svc, withTenant };
  }

  it('logs the from/to status, completion %, and evidence capture on bim_element_status_history', async () => {
    const { svc, withTenant } = makeService('not_started');

    await svc.updateElementStatus(companyId, projectId, elementId, 'user-1', {
      status: 'in_progress', completionPct: 50, captureId: 'capture-9',
    });

    // Third withTenant call is the INSERT into bim_element_status_history --
    // postgres.js's tagged-template sql`` is captured here as the strings
    // array plus interpolated values, in call order.
    const historyCall = withTenant.mock.calls[2];
    const sqlFn = historyCall[1] as (sql: unknown) => unknown;
    const capturedValues: unknown[] = [];
    const fakeSql = (_strings: TemplateStringsArray, ...values: unknown[]) => { capturedValues.push(...values); return []; };
    sqlFn(fakeSql);

    expect(capturedValues).toEqual(
      expect.arrayContaining([companyId, projectId, elementId, 'not_started', 'in_progress', 50, 'capture-9', 'user-1']),
    );
  });

  it('throws NotFoundException for an element that does not exist', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([]);
    const db = { withTenant };
    const svc = new BimService(
      db as unknown as DatabaseService, {} as unknown as StorageService,
      {} as unknown as IssuesService, {} as unknown as Queue,
    );
    await expect(svc.updateElementStatus(companyId, projectId, 'missing', 'user-1', { status: 'complete' }))
      .rejects.toThrow(NotFoundException);
  });
});

describe('BimService.upsertZoneProgress (F2)', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const levelId = 'level-1';

  it('rejects a level that does not belong to this project', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([]);
    const db = { withTenant };
    const svc = new BimService(
      db as unknown as DatabaseService, {} as unknown as StorageService,
      {} as unknown as IssuesService, {} as unknown as Queue,
    );
    await expect(svc.upsertZoneProgress(companyId, projectId, levelId, 'user-1', { status: 'complete' }))
      .rejects.toThrow(NotFoundException);
  });

  it('upserts the current zone_progress row and logs the change to zone_progress_history', async () => {
    const withTenant = jest.fn()
      .mockResolvedValueOnce([{ id: levelId }])               // level exists
      .mockResolvedValueOnce([{ status: 'not_started' }])      // existing zone_progress row
      .mockResolvedValueOnce([{ id: 'zone-1', status: 'in_progress', completionPct: 40 }]) // upsert RETURNING
      .mockResolvedValueOnce([]);                               // history insert
    const db = { withTenant };
    const svc = new BimService(
      db as unknown as DatabaseService, {} as unknown as StorageService,
      {} as unknown as IssuesService, {} as unknown as Queue,
    );

    const result = await svc.upsertZoneProgress(companyId, projectId, levelId, 'user-1', { status: 'in_progress', completionPct: 40 });

    expect(result).toEqual({ id: 'zone-1', status: 'in_progress', completionPct: 40 });
    expect(withTenant).toHaveBeenCalledTimes(4);
  });
});

describe('BimService.registerModel', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const baseDto = { name: 'Tower A - Level 3', storageKey: 'company-1/captures/project-1/model.ifc' };

  function makeService(opts: {
    projectExists?: boolean;
    actualSizeBytes: number | null;
  }) {
    const projectExists = opts.projectExists ?? true;
    const withTenant = jest.fn()
      .mockResolvedValueOnce(projectExists ? [{ id: projectId }] : [])
      .mockResolvedValueOnce([{ id: 'model-1' }]);
    const db = { withTenant };
    const getObjectSize = jest.fn().mockResolvedValue(opts.actualSizeBytes);
    const deleteIfExists = jest.fn().mockResolvedValue(undefined);
    const storage = { getObjectSize, deleteIfExists };
    const issues = {};
    const queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
    const queue = { add: queueAdd };
    const svc = new BimService(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      issues as unknown as IssuesService,
      queue as unknown as Queue,
    );
    return { svc, withTenant, getObjectSize, deleteIfExists, queueAdd };
  }

  it('registers a model whose real uploaded size is within the 500 MB limit', async () => {
    const { svc, deleteIfExists, queueAdd } = makeService({ actualSizeBytes: 10 * 1024 * 1024 });
    const model = await svc.registerModel(companyId, projectId, 'user-1', baseDto);
    expect(model).toEqual({ id: 'model-1' });
    expect(deleteIfExists).not.toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalled();
  });

  it('rejects and deletes an uploaded model that exceeds the 500 MB limit', async () => {
    const { svc, deleteIfExists, queueAdd } = makeService({ actualSizeBytes: 501 * 1024 * 1024 });
    await expect(svc.registerModel(companyId, projectId, 'user-1', baseDto)).rejects.toThrow(/exceeds the/);
    expect(deleteIfExists).toHaveBeenCalledWith(baseDto.storageKey);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects registration when the declared storage key was never actually uploaded', async () => {
    const { svc, deleteIfExists } = makeService({ actualSizeBytes: null });
    await expect(svc.registerModel(companyId, projectId, 'user-1', baseDto)).rejects.toThrow(/not found in storage/);
    expect(deleteIfExists).not.toHaveBeenCalled();
  });

  it("rejects registration against a project that does not belong to the caller's company", async () => {
    const { svc, getObjectSize } = makeService({ projectExists: false, actualSizeBytes: 1024 });
    await expect(svc.registerModel(companyId, 'someone-elses-project', 'user-1', baseDto)).rejects.toThrow(NotFoundException);
    expect(getObjectSize).not.toHaveBeenCalled();
  });
});

// H-1 regression (KNOWN_ISSUES_AND_REMEDIATION.md): getModel (the shared
// base for status/viewer-data/provenance/hierarchy/status-map) and the
// element-scoped methods used to scope only by company_id -- a user
// authorized for Project A could read Project B's model (including, via
// getModelViewerData, a live presigned Fragments file URL) or act on its
// elements by supplying Project B's own modelId/elementId. Each test below
// proves both halves: the real project succeeds, the wrong one is rejected.
describe('BimService H-1: same-company cross-project access is rejected', () => {
  const companyId = 'company-1';
  const REAL_PROJECT = 'project-A';
  const OTHER_PROJECT = 'project-B';
  const modelId = 'model-1';
  const elementId = 'element-1';

  function makeDb(extra: (text: string) => unknown[] | undefined = () => undefined) {
    const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      if (text.includes('FROM bim_models')) {
        return Promise.resolve(values.includes(REAL_PROJECT) ? [{ id: modelId, projectId: REAL_PROJECT, status: 'ready', fragmentsStorageKey: 'models/model-1.frag' }] : []);
      }
      if (text.includes('FROM bim_elements') && !text.includes('UPDATE')) {
        return Promise.resolve(values.includes(REAL_PROJECT) ? [{ id: elementId, projectId: REAL_PROJECT }] : []);
      }
      const extraResult = extra(text);
      if (extraResult) return Promise.resolve(extraResult);
      return Promise.resolve([]);
    });
    return { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query)) } as unknown as DatabaseService;
  }

  function makeSvc(db: DatabaseService, storage: Partial<StorageService> = {}) {
    return new BimService(db, storage as unknown as StorageService, {} as unknown as IssuesService, {} as unknown as Queue);
  }

  it('getModelViewerData: succeeds under the real project, rejects the same modelId under another project', async () => {
    const db = makeDb();
    const svc = makeSvc(db, { getReadUrl: jest.fn().mockResolvedValue('https://presigned.example/read') });

    await expect(svc.getModelViewerData(companyId, REAL_PROJECT, modelId)).resolves.toMatchObject({ status: 'ready' });
    await expect(svc.getModelViewerData(companyId, OTHER_PROJECT, modelId)).rejects.toThrow(NotFoundException);
  });

  it('getModelStatus: succeeds under the real project, rejects the same modelId under another project', async () => {
    const db = makeDb();
    const svc = makeSvc(db);

    await expect(svc.getModelStatus(companyId, REAL_PROJECT, modelId)).resolves.toMatchObject({ id: modelId });
    await expect(svc.getModelStatus(companyId, OTHER_PROJECT, modelId)).rejects.toThrow(NotFoundException);
  });

  it('getElement: succeeds under the real project, rejects the same elementId under another project', async () => {
    const db = makeDb();
    const svc = makeSvc(db);

    await expect(svc.getElement(companyId, REAL_PROJECT, elementId)).resolves.toMatchObject({ id: elementId });
    await expect(svc.getElement(companyId, OTHER_PROJECT, elementId)).rejects.toThrow(NotFoundException);
  });

  it('updateElementStatus: succeeds under the real project, rejects the same elementId under another project (projectId was previously threaded through but never checked)', async () => {
    const db = makeDb((text) => (text.includes('UPDATE bim_elements') ? [{ id: elementId, constructionStatus: 'in_progress' }] : undefined));
    const svc = makeSvc(db);

    await expect(svc.updateElementStatus(companyId, REAL_PROJECT, elementId, 'user-1', { status: 'in_progress' })).resolves.toBeDefined();
    await expect(svc.updateElementStatus(companyId, OTHER_PROJECT, elementId, 'user-1', { status: 'in_progress' })).rejects.toThrow(NotFoundException);
  });

  it('linkCaptureToElement: succeeds under the real project, rejects the same elementId under another project', async () => {
    const db = makeDb((text) => (text.includes('INSERT INTO capture_element_links') ? [{ id: 'link-1' }] : undefined));
    const svc = makeSvc(db);

    await expect(svc.linkCaptureToElement(companyId, REAL_PROJECT, 'capture-1', elementId, 'user-1')).resolves.toBeDefined();
    await expect(svc.linkCaptureToElement(companyId, OTHER_PROJECT, 'capture-1', elementId, 'user-1')).rejects.toThrow(NotFoundException);
  });
});
