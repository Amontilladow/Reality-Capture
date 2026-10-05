import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import type { DatabaseService } from '../../database/database.service';
import type { SubscriptionService } from '../subscription/subscription.service';
import type { StorageService } from '../storage/storage.service';

// Project branding (logo/stamp) and organization logos are a two-step flow
// with no dedicated "confirm upload" endpoint: the client PUTs to storage,
// then PATCHes the resulting storageKey into update()/upsertOrganization(),
// which reuse the same generic field-update path every other project field
// uses. Those two call sites *are* the safe, server-controlled completion
// point, so real size enforcement runs there -- and only when a logo/stamp
// value is actually present in that specific request, so an update that
// leaves branding untouched is unaffected.
describe('ProjectsService branding enforcement', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';

  function makeService(opts: {
    projectExists?: boolean;
    actualSizeBytes?: number | null;
  }) {
    const projectExists = opts.projectExists ?? true;
    const withTenant = jest.fn()
      // findOne()'s SELECT
      .mockResolvedValueOnce(projectExists ? [{ id: projectId, name: 'Tower A' }] : [])
      // the UPDATE / INSERT itself
      .mockResolvedValueOnce([{ id: projectId, logoStorageKey: null, stampStorageKey: null }]);
    const db = { withTenant };
    const getObjectSize = jest.fn().mockResolvedValue(opts.actualSizeBytes ?? null);
    const deleteIfExists = jest.fn().mockResolvedValue(undefined);
    const generateKey = jest.fn().mockReturnValue('company-1/branding/project-1/logo-file.png');
    const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put' });
    const resolveUrls = jest.fn().mockResolvedValue(new Map());
    const storage = { getObjectSize, deleteIfExists, generateKey, getUploadUrl, resolveUrls };
    const svc = new ProjectsService(
      db as unknown as DatabaseService,
      {} as unknown as SubscriptionService,
      storage as unknown as StorageService,
    );
    return { svc, getObjectSize, deleteIfExists, getUploadUrl };
  }

  describe('getBrandingUploadUrl', () => {
    it("rejects a project that does not belong to the caller's company", async () => {
      const { svc, getUploadUrl } = makeService({ projectExists: false });
      await expect(svc.getBrandingUploadUrl(companyId, 'someone-elses-project', 'logo.png', 1024, 'logo'))
        .rejects.toThrow(NotFoundException);
      expect(getUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects a non-image extension', async () => {
      const { svc } = makeService({});
      await expect(svc.getBrandingUploadUrl(companyId, projectId, 'logo.pdf', 1024, 'logo'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects a declared size over the 2MB cap', async () => {
      const { svc } = makeService({});
      await expect(svc.getBrandingUploadUrl(companyId, projectId, 'logo.png', 3 * 1024 * 1024, 'logo'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('saves a logo whose real uploaded size is within the 2MB limit', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: 500 * 1024 });
      await svc.update(companyId, projectId, { logoStorageKey: 'company-1/branding/project-1/logo.png' });
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('rejects and deletes a logo upload that exceeds the 2MB limit', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: 3 * 1024 * 1024 });
      await expect(svc.update(companyId, projectId, { logoStorageKey: 'company-1/branding/project-1/logo.png' }))
        .rejects.toThrow(BadRequestException);
      expect(deleteIfExists).toHaveBeenCalledWith('company-1/branding/project-1/logo.png');
    });

    it('rejects a stamp upload that was never actually completed', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: null });
      await expect(svc.update(companyId, projectId, { stampStorageKey: 'company-1/branding/project-1/stamp.png' }))
        .rejects.toThrow(BadRequestException);
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('does not touch storage at all for an update that leaves the logo/stamp untouched', async () => {
      const { svc, getObjectSize } = makeService({});
      await svc.update(companyId, projectId, { name: 'Tower A - Renamed' });
      expect(getObjectSize).not.toHaveBeenCalled();
    });
  });

  describe('upsertOrganization', () => {
    function makeOrgService(opts: { actualSizeBytes: number | null }) {
      const withTenant = jest.fn()
        .mockResolvedValueOnce([{ id: projectId }]) // findOne()
        .mockResolvedValueOnce([{ id: 'org-1', logoStorageKey: 'company-1/branding/project-1/org-logo.png' }]); // upsert
      const db = { withTenant };
      const getObjectSize = jest.fn().mockResolvedValue(opts.actualSizeBytes);
      const deleteIfExists = jest.fn().mockResolvedValue(undefined);
      const resolveUrls = jest.fn().mockResolvedValue(new Map());
      const storage = { getObjectSize, deleteIfExists, resolveUrls };
      const svc = new ProjectsService(
        db as unknown as DatabaseService,
        {} as unknown as SubscriptionService,
        storage as unknown as StorageService,
      );
      return { svc, deleteIfExists };
    }

    it('rejects and deletes an organization logo that exceeds the 2MB limit', async () => {
      const { svc, deleteIfExists } = makeOrgService({ actualSizeBytes: 3 * 1024 * 1024 });
      await expect(svc.upsertOrganization(companyId, projectId, 'client', {
        logoStorageKey: 'company-1/branding/project-1/org-logo.png',
      })).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).toHaveBeenCalledWith('company-1/branding/project-1/org-logo.png');
    });

    it('accepts an organization logo within the 2MB limit', async () => {
      const { svc, deleteIfExists } = makeOrgService({ actualSizeBytes: 100 * 1024 });
      await svc.upsertOrganization(companyId, projectId, 'client', {
        logoStorageKey: 'company-1/branding/project-1/org-logo.png',
      });
      expect(deleteIfExists).not.toHaveBeenCalled();
    });
  });

  // RBAC Phase 4: real user membership for the project_organizations slots
  // -- addOrganizationMember() requires the target to already be a project
  // member (checked via a SELECT against project_members before the
  // INSERT), and removeOrganizationMember() mirrors removeMember()'s own
  // "0 rows deleted -> 404" handling.
  describe('addOrganizationMember', () => {
    const userId = 'user-1';

    function makeService(opts: { isProjectMember: boolean }) {
      const withTenant = jest.fn()
        .mockResolvedValueOnce([{ id: projectId }]) // findOne()
        .mockResolvedValueOnce(opts.isProjectMember ? [{ '?column?': 1 }] : []) // the project_members SELECT
        .mockResolvedValueOnce([{ id: 'org-member-1', slot: 'client', userId }]); // the INSERT ... RETURNING *
      const db = { withTenant };
      const resolveUrls = jest.fn().mockResolvedValue(new Map());
      const storage = { resolveUrls };
      const svc = new ProjectsService(
        db as unknown as DatabaseService,
        {} as unknown as SubscriptionService,
        storage as unknown as StorageService,
      );
      return { svc, withTenant };
    }

    it('assigns an existing project member to an organization slot', async () => {
      const { svc } = makeService({ isProjectMember: true });
      const result = await svc.addOrganizationMember(companyId, projectId, 'client', userId, 'admin-1');
      expect(result).toMatchObject({ slot: 'client', userId });
    });

    it('rejects assigning someone who is not yet a project member', async () => {
      const { svc, withTenant } = makeService({ isProjectMember: false });
      await expect(svc.addOrganizationMember(companyId, projectId, 'client', userId, 'admin-1'))
        .rejects.toThrow(BadRequestException);
      // Only findOne()'s own call plus the membership check happened -- no INSERT was attempted.
      expect(withTenant).toHaveBeenCalledTimes(2);
    });

    it('rejects an invalid slot before touching the database at all', async () => {
      const { svc, withTenant } = makeService({ isProjectMember: true });
      await expect(svc.addOrganizationMember(companyId, projectId, 'not-a-real-slot', userId, 'admin-1'))
        .rejects.toThrow(BadRequestException);
      expect(withTenant).not.toHaveBeenCalled();
    });
  });

  describe('removeOrganizationMember', () => {
    it('removes an existing organization membership', async () => {
      const withTenant = jest.fn().mockResolvedValue({ count: 1 });
      const svc = new ProjectsService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as SubscriptionService,
        {} as unknown as StorageService,
      );
      await expect(svc.removeOrganizationMember(companyId, projectId, 'user-1')).resolves.toMatchObject({
        message: 'Organization membership removed.',
      });
    });

    it('404s when the person holds no organization slot on this project', async () => {
      const withTenant = jest.fn().mockResolvedValue({ count: 0 });
      const svc = new ProjectsService(
        { withTenant } as unknown as DatabaseService,
        {} as unknown as SubscriptionService,
        {} as unknown as StorageService,
      );
      await expect(svc.removeOrganizationMember(companyId, projectId, 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
