import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';

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
    const svc = new DocumentsService(db as unknown as DatabaseService, storage as unknown as StorageService);
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
