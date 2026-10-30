import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { ConfigService } from '@nestjs/config';

// getUploadUrl() never had a client-declared size to check (it only takes a
// filename); create() is the one place a document's storage key is ever
// persisted. Real size enforcement only applies to an internal, storage-
// backed upload -- a metadata-only reference to an external system
// (Procore/Aconex/SharePoint/BIM360/a manual link) has no object of ours to
// verify and must not be broken by this. Also covers the project-ownership
// check that was previously entirely absent (documents.controller.ts has no
// @RequireProjectPermission gate at all).
describe('DocumentsService upload enforcement', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';

  function makeService(opts: {
    projectExists?: boolean;
    actualSizeBytes?: number | null;
  }) {
    const projectExists = opts.projectExists ?? true;
    const withTenant = jest.fn()
      .mockResolvedValueOnce(projectExists ? [{ id: projectId }] : [])
      .mockResolvedValueOnce([{ id: 'document-1', title: 'Spec Sheet' }]);
    const db = { withTenant };
    const getObjectSize = jest.fn().mockResolvedValue(opts.actualSizeBytes ?? null);
    const deleteIfExists = jest.fn().mockResolvedValue(undefined);
    const generateKey = jest.fn().mockReturnValue('company-1/documents/project-1/spec.pdf');
    const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put' });
    const storage = { getObjectSize, deleteIfExists, generateKey, getUploadUrl };
    const config = { get: jest.fn() };
    const svc = new DocumentsService(db as unknown as DatabaseService, storage as unknown as StorageService, config as unknown as ConfigService);
    return { svc, getObjectSize, deleteIfExists, getUploadUrl };
  }

  describe('getUploadUrl', () => {
    it("rejects a project that does not belong to the caller's company", async () => {
      const { svc, getUploadUrl } = makeService({ projectExists: false });
      await expect(svc.getUploadUrl(companyId, 'someone-elses-project', 'spec.pdf')).rejects.toThrow(NotFoundException);
      expect(getUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('create — internal upload', () => {
    const baseDto = { docType: 'specification', title: 'Spec Sheet', storageKey: 'company-1/documents/project-1/spec.pdf' };

    it('registers an internal document whose real uploaded size is within the 50 MB limit', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: 10 * 1024 * 1024 });
      const doc = await svc.create(companyId, projectId, 'user-1', baseDto);
      expect(doc).toEqual({ id: 'document-1', title: 'Spec Sheet' });
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('rejects and deletes an internal upload that exceeds the 50 MB limit', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: 51 * 1024 * 1024 });
      await expect(svc.create(companyId, projectId, 'user-1', baseDto)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).toHaveBeenCalledWith(baseDto.storageKey);
    });

    it('rejects registration when the declared storage key was never actually uploaded', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: null });
      await expect(svc.create(companyId, projectId, 'user-1', baseDto)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it("rejects registration against a project that does not belong to the caller's company", async () => {
      const { svc, getObjectSize } = makeService({ projectExists: false, actualSizeBytes: 1024 });
      await expect(svc.create(companyId, 'someone-elses-project', 'user-1', baseDto)).rejects.toThrow(NotFoundException);
      expect(getObjectSize).not.toHaveBeenCalled();
    });
  });

  describe('create — external / metadata-only reference', () => {
    it('does not touch storage at all for an external document with no storageKey', async () => {
      const { svc, getObjectSize, deleteIfExists } = makeService({});

      const doc = await svc.create(companyId, projectId, 'user-1', {
        docType: 'submittal',
        title: 'External Submittal',
        source: 'aconex',
        externalId: 'ACX-123',
        externalUrl: 'https://aconex.example/doc/123',
      });

      expect(doc).toEqual({ id: 'document-1', title: 'Spec Sheet' });
      expect(getObjectSize).not.toHaveBeenCalled();
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('does not touch storage for a manual_link document even if a stray storageKey were present', async () => {
      // Defensive case: source explicitly says this isn't an internal upload,
      // so even an (unexpected) storageKey value must not trigger a real
      // storage check against an object that was never meant to exist here.
      const { svc, getObjectSize } = makeService({});

      await svc.create(companyId, projectId, 'user-1', {
        docType: 'other',
        title: 'Linked doc',
        source: 'manual_link',
        externalUrl: 'https://example.com/doc',
      });

      expect(getObjectSize).not.toHaveBeenCalled();
    });
  });
});

// Mirrors progress-reports.service.ts's / rfi-external-access.service.ts's
// own share/external-access test coverage pattern: a token generated on the
// authenticated side, validated on the public side with no company_id/
// session of its own. A tagged-template sql mock just returns its
// pre-configured resolved value and ignores the actual query text/values --
// these tests assert on what the service does with the DB's response, not
// on the exact SQL generated.
describe('DocumentsService external share links', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const documentId = 'document-1';

  function sqlMock(result: unknown) {
    return jest.fn().mockResolvedValue(result) as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  }

  // withTenant/withSystemBypass take (companyId, fn) or (fn) respectively
  // and invoke fn with a tagged-template sql function -- each entry in
  // `results` becomes one call's sql() return value, in order.
  function withQueue(results: unknown[]) {
    const queue = [...results];
    return jest.fn((...args: unknown[]) => {
      const fn = args[args.length - 1] as (sql: unknown) => unknown;
      return fn(sqlMock(queue.shift()));
    });
  }

  function makeShareService(opts: {
    withTenant?: jest.Mock;
    withSystemBypass?: jest.Mock;
    frontendUrl?: string;
  }) {
    const withTenant = opts.withTenant ?? withQueue([[]]);
    const withSystemBypass = opts.withSystemBypass ?? withQueue([[]]);
    const db = { withTenant, withSystemBypass };
    const getReadUrl = jest.fn().mockResolvedValue('https://presigned.example/get');
    const storage = { getReadUrl };
    const config = { get: jest.fn().mockReturnValue(opts.frontendUrl ?? 'https://app.example') };
    const svc = new DocumentsService(db as unknown as DatabaseService, storage as unknown as StorageService, config as unknown as ConfigService);
    return { svc, withTenant, withSystemBypass, getReadUrl };
  }

  describe('createShare', () => {
    it('rejects a document that does not belong to this project/company', async () => {
      const { svc } = makeShareService({ withTenant: withQueue([[]]) });
      await expect(svc.createShare(companyId, projectId, documentId, 'user-1', {})).rejects.toThrow(NotFoundException);
    });

    it('rejects an external/metadata-only document -- there is no file of ours to hand out', async () => {
      const { svc } = makeShareService({
        withTenant: withQueue([[{ id: documentId, source: 'aconex', storageKey: null }]]),
      });
      await expect(svc.createShare(companyId, projectId, documentId, 'user-1', {})).rejects.toThrow(BadRequestException);
    });

    it('generates a 128-hex-char token and returns a shareUrl built from the configured frontend URL', async () => {
      const { svc } = makeShareService({
        withTenant: withQueue([
          [{ id: documentId, source: 'internal', storageKey: 'key.pdf' }], // document lookup
          [{ id: 'share-1' }], // the INSERT ... RETURNING * (token itself isn't read back by the service)
        ]),
        frontendUrl: 'https://app.example',
      });

      const result = await svc.createShare(companyId, projectId, documentId, 'user-1', { expiresInDays: 7 });
      expect(result.shareUrl).toMatch(/^https:\/\/app\.example\/documents\/external\/[0-9a-f]{128}$/);
    });
  });

  describe('validateShareToken (via getByToken)', () => {
    it('rejects an unknown token', async () => {
      const { svc } = makeShareService({ withSystemBypass: withQueue([[], []]) });
      await expect(svc.getByToken('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('rejects a revoked token with a distinct LINK_REVOKED error', async () => {
      const { svc } = makeShareService({
        withSystemBypass: withQueue([
          [], // not found under the active-link WHERE clause
          [{ expiresAt: new Date(Date.now() + 86400000).toISOString(), revokedAt: new Date().toISOString() }],
        ]),
      });
      await expect(svc.getByToken('revoked-token')).rejects.toThrow(ForbiddenException);
    });

    it('rejects an expired token with a distinct LINK_EXPIRED error', async () => {
      const { svc } = makeShareService({
        withSystemBypass: withQueue([
          [],
          [{ expiresAt: new Date(Date.now() - 86400000).toISOString(), revokedAt: null }],
        ]),
      });
      await expect(svc.getByToken('expired-token')).rejects.toThrow(ForbiddenException);
    });

    it('resolves a valid token to a fresh presigned download URL, never the raw storage key', async () => {
      const share = { id: 'share-1', companyId, projectId, documentId, revokedAt: null, expiresAt: new Date(Date.now() + 86400000).toISOString() };
      const { svc, getReadUrl } = makeShareService({
        withSystemBypass: withQueue([[share]]),
        withTenant: withQueue([
          [], // the used_at update inside validateShareToken
          [{ title: 'Spec Sheet', docType: 'specification', documentNumber: 'SP-01', revision: 'B', storageKey: 'company-1/documents/project-1/spec.pdf' }],
        ]),
      });

      const result = await svc.getByToken('valid-token');
      expect(result).toEqual({
        title: 'Spec Sheet', docType: 'specification', documentNumber: 'SP-01', revision: 'B',
        downloadUrl: 'https://presigned.example/get',
      });
      expect(getReadUrl).toHaveBeenCalledWith('company-1/documents/project-1/spec.pdf');
      expect(JSON.stringify(result)).not.toContain('storageKey');
    });
  });

  describe('revokeShare', () => {
    it('404s when no matching active share link exists', async () => {
      const { svc } = makeShareService({ withTenant: withQueue([[]]) });
      await expect(svc.revokeShare(companyId, projectId, documentId, 'share-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('revokes a matching active share link', async () => {
      const { svc } = makeShareService({ withTenant: withQueue([[{ id: 'share-1' }]]) });
      const result = await svc.revokeShare(companyId, projectId, documentId, 'share-1', 'user-1');
      expect(result).toEqual({ message: 'Share link revoked.' });
    });
  });
});

// H-1 regression (KNOWN_ISSUES_AND_REMEDIATION.md): link() used to scope
// its document lookup only by company_id -- a user authorized for Project
// A could link an arbitrary capture/element/location/issue to Project B's
// document by supplying Project B's own documentId. Each test proves both
// halves: the real project succeeds, the wrong one is rejected.
describe('DocumentsService H-1: same-company cross-project access is rejected on link()', () => {
  const companyId = 'company-1';
  const documentId = 'document-1';
  const REAL_PROJECT = 'project-A';
  const OTHER_PROJECT = 'project-B';

  function makeLinkService(extra: (text: string) => unknown[] | undefined = () => undefined) {
    const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      if (text.includes('FROM documents')) {
        return Promise.resolve(values.includes(REAL_PROJECT) ? [{ id: documentId }] : []);
      }
      // H-1 follow-up: each target table gets the same REAL_PROJECT-gated
      // "found" default as the document check above, so a test that isn't
      // specifically exercising target validation doesn't need to know
      // about these queries.
      if (text.includes('FROM captures') || text.includes('FROM bim_elements')
        || text.includes('FROM locations') || text.includes('FROM issues')) {
        return Promise.resolve(values.includes(REAL_PROJECT) ? [{ '?column?': 1 }] : []);
      }
      if (text.includes('INSERT INTO document_links')) {
        return Promise.resolve([{ id: 'link-1', documentId, issueId: 'issue-1' }]);
      }
      const extraResult = extra(text);
      if (extraResult) return Promise.resolve(extraResult);
      return Promise.resolve([]);
    });
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
    const db = { withTenant };
    const config = { get: jest.fn() };
    return new DocumentsService(db as unknown as DatabaseService, {} as unknown as StorageService, config as unknown as ConfigService);
  }

  it('succeeds under the real project, rejects the same documentId under another project', async () => {
    const svc = makeLinkService();
    const dto = { issueId: 'issue-1' };

    await expect(svc.link(companyId, REAL_PROJECT, documentId, 'user-1', dto)).resolves.toBeDefined();
    await expect(svc.link(companyId, OTHER_PROJECT, documentId, 'user-1', dto)).rejects.toThrow(NotFoundException);
  });

  // H-1 follow-up: the document itself can be in the right project while
  // the single supplied target (capture/element/location/issue) belongs to
  // a different one in the same company -- a parent-only check (the test
  // above) doesn't cover this case. One test per supported target type.
  it.each([
    ['captureId', 'capture-from-other-project'],
    ['elementId', 'element-from-other-project'],
    ['locationId', 'location-from-other-project'],
    ['issueId', 'issue-from-other-project'],
  ])('rejects a same-company %s target that belongs to a different project, and writes no link', async (field, targetId) => {
    const insertSpy = jest.fn();
    // Unlike makeLinkService's REAL_PROJECT-gated default (which can't
    // distinguish "this specific target is not in REAL_PROJECT" from "no
    // project matches at all"), this mock keys off the table queried, so it
    // can tell "the document is fine" apart from "this particular target is
    // not."
    const query = jest.fn((strings: TemplateStringsArray) => {
      const text = strings.join('?');
      if (text.includes('FROM documents')) return Promise.resolve([{ id: documentId }]);
      if (text.includes('FROM captures') || text.includes('FROM bim_elements')
        || text.includes('FROM locations') || text.includes('FROM issues')) {
        return Promise.resolve([]); // target exists, but not in this project
      }
      if (text.includes('INSERT INTO document_links')) { insertSpy(); return Promise.resolve([{ id: 'link-1' }]); }
      return Promise.resolve([]);
    });
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
    const db = { withTenant };
    const config = { get: jest.fn() };
    const svc = new DocumentsService(db as unknown as DatabaseService, {} as unknown as StorageService, config as unknown as ConfigService);

    await expect(svc.link(companyId, REAL_PROJECT, documentId, 'user-1', { [field]: targetId })).rejects.toThrow(NotFoundException);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
