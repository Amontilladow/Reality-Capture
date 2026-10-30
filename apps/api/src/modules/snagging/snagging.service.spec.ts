import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SnaggingService } from './snagging.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { StorageService } from '../storage/storage.service';
import type { ProjectAuthorizationService } from '../../common/authorization/project-authorization.service';

// The presigned PUT getAttachmentUploadUrl() hands out has no enforced size
// limit -- dto.sizeBytes there is only ever a declared value. Real
// enforcement is this HEAD-based check against the object actually sitting
// in storage, run in addAttachment() before it's persisted. Also covers the
// project/snag-ownership checks that were previously entirely absent
// (snagging.controller.ts has no @RequireProjectPermission gate on either
// route, unlike update/delete/forceStatus).
describe('SnaggingService attachment enforcement', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const snagId = 'snag-1';

  describe('getAttachmentUploadUrl', () => {
    function makeService(opts: { projectExists?: boolean }) {
      const projectExists = opts.projectExists ?? true;
      const withTenant = jest.fn().mockResolvedValue(projectExists ? [{ id: projectId }] : []);
      const db = { withTenant };
      const generateKey = jest.fn().mockReturnValue('company-1/snag-items/project-1/photo.jpg');
      const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put' });
      const storage = { generateKey, getUploadUrl };
      const svc = new SnaggingService(
        db as unknown as DatabaseService,
        {} as unknown as NotificationsService,
        storage as unknown as StorageService,
        {} as unknown as ProjectAuthorizationService,
      );
      return { svc, getUploadUrl };
    }

    it('rejects a disallowed extension', async () => {
      const { svc } = makeService({});
      await expect(svc.getAttachmentUploadUrl(companyId, projectId, {
        filename: 'malware.exe', sizeBytes: 1000,
      })).rejects.toThrow(BadRequestException);
    });

    it('rejects a file over the 5MB cap', async () => {
      const { svc } = makeService({});
      await expect(svc.getAttachmentUploadUrl(companyId, projectId, {
        filename: 'photo.jpg', sizeBytes: 6 * 1024 * 1024,
      })).rejects.toThrow(BadRequestException);
    });

    it("rejects a project that does not belong to the caller's company", async () => {
      const { svc, getUploadUrl } = makeService({ projectExists: false });
      await expect(svc.getAttachmentUploadUrl(companyId, 'someone-elses-project', {
        filename: 'photo.jpg', sizeBytes: 1024,
      })).rejects.toThrow(NotFoundException);
      expect(getUploadUrl).not.toHaveBeenCalled();
    });

    it('accepts an allowed extension within the size cap', async () => {
      const { svc, getUploadUrl } = makeService({});
      const result = await svc.getAttachmentUploadUrl(companyId, projectId, { filename: 'photo.jpg', sizeBytes: 1024 });
      expect(result.uploadUrl).toBe('https://presigned.example/put');
      expect(getUploadUrl).toHaveBeenCalled();
    });
  });

  describe('addAttachment', () => {
    // H-1 fix: addAttachment() now takes projectId and resolves the snag
    // item through findOne() (project_id = projectId AND company_id =
    // companyId), not a bare company-only existence check -- so the first
    // withTenant call here mocks findOne()'s own SELECT, which must return
    // a full-enough row for findOne() to pass it through unmodified
    // (no screenshotStorageKey field on snag_items, so no second query).
    function makeService(opts: { snagExists?: boolean; wrongProject?: boolean; actualSizeBytes: number | null }) {
      const snagExists = opts.snagExists ?? true;
      const wrongProject = opts.wrongProject ?? false;
      const insertedRow = { id: 'activity-1' };
      const findOneRow = { id: snagId, projectId, companyId, status: 'open' };
      const withTenant = jest.fn()
        // findOne()'s SELECT: a WHERE clause already filters by
        // project_id -- simulating "wrong project" by returning no row is
        // how the fix is actually exercised (the real query does the
        // filtering; the mock only needs to reflect its outcome).
        .mockResolvedValueOnce(snagExists && !wrongProject ? [findOneRow] : [])
        // addAttachment()'s second withTenant call passes a callback that does
        // its own `const [activity] = await sql...` destructuring internally
        // and returns the plain object -- so withTenant itself resolves to
        // that object directly, not an array (unlike the first call above,
        // which the service destructures at the call site).
        .mockResolvedValueOnce(insertedRow);
      const db = { withTenant };
      const getObjectSize = jest.fn().mockResolvedValue(opts.actualSizeBytes);
      const deleteIfExists = jest.fn().mockResolvedValue(undefined);
      const storage = { getObjectSize, deleteIfExists };
      const svc = new SnaggingService(
        db as unknown as DatabaseService,
        {} as unknown as NotificationsService,
        storage as unknown as StorageService,
        {} as unknown as ProjectAuthorizationService,
      );
      return { svc, getObjectSize, deleteIfExists };
    }

    const baseDto = { storageKey: 'company-1/snag-items/project-1/photo.jpg', filename: 'photo.jpg', sizeBytes: 1 };

    it('registers an attachment whose real uploaded size is within the 5MB limit', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: 1024 });
      const activity = await svc.addAttachment(companyId, projectId, snagId, 'user-1', baseDto);
      expect(activity).toEqual({ id: 'activity-1' });
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('rejects and cleans up an attachment whose real size exceeds the 5MB limit', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: 6 * 1024 * 1024 });
      await expect(svc.addAttachment(companyId, projectId, snagId, 'user-1', baseDto)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).toHaveBeenCalledWith(baseDto.storageKey);
    });

    it('rejects registration when the declared storage key was never actually uploaded', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: null });
      await expect(svc.addAttachment(companyId, projectId, snagId, 'user-1', baseDto)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('rejects an attachment for a snag item that does not exist under this company', async () => {
      const { svc, getObjectSize } = makeService({ snagExists: false, actualSizeBytes: 1024 });
      await expect(svc.addAttachment(companyId, projectId, 'someone-elses-snag', 'user-1', baseDto)).rejects.toThrow(NotFoundException);
      expect(getObjectSize).not.toHaveBeenCalled();
    });

    // H-1 regression: the snag item is real and in the same company, but
    // under a DIFFERENT project than the one named in the URL -- a user
    // authorized only for `projectId` must not be able to attach a file to
    // it just by knowing/guessing its UUID.
    it("rejects an attachment for a snag item that belongs to a different project in the caller's company", async () => {
      const { svc, getObjectSize } = makeService({ wrongProject: true, actualSizeBytes: 1024 });
      await expect(svc.addAttachment(companyId, projectId, 'other-projects-snag', 'user-1', baseDto)).rejects.toThrow(NotFoundException);
      expect(getObjectSize).not.toHaveBeenCalled();
    });
  });

  // H-1 fix: getActivities()/addActivity() previously scoped only by
  // company_id, not project_id -- a user authorized for a different
  // project in the same company could read or post to any snag item's
  // activity feed by guessing its UUID. Both now resolve the snag item via
  // findOne() first, same boundary as addAttachment() above.
  describe('getActivities / addActivity project-scoping (H-1)', () => {
    function makeService(opts: { wrongProject?: boolean }) {
      const wrongProject = opts.wrongProject ?? false;
      const findOneRow = { id: snagId, projectId, companyId, status: 'open' };
      const withTenant = jest.fn();
      const db = { withTenant };
      const svc = new SnaggingService(
        db as unknown as DatabaseService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
        {} as unknown as ProjectAuthorizationService,
      );
      return { svc, withTenant, findOneRow: wrongProject ? undefined : findOneRow };
    }

    it('rejects reading activities for a snag item in a different project', async () => {
      const { svc, withTenant } = makeService({ wrongProject: true });
      withTenant.mockResolvedValueOnce([]); // findOne() finds nothing for this project
      await expect(svc.getActivities(companyId, projectId, 'other-projects-snag')).rejects.toThrow(NotFoundException);
      expect(withTenant).toHaveBeenCalledTimes(1); // never reached the activities SELECT
    });

    it('returns activities for a snag item that really is in this project', async () => {
      const { svc, withTenant, findOneRow } = makeService({});
      withTenant
        .mockResolvedValueOnce([findOneRow]) // findOne()
        .mockResolvedValueOnce([{ id: 'activity-1', attachmentUrl: null }]); // activities SELECT
      const activities = await svc.getActivities(companyId, projectId, snagId);
      expect(activities).toEqual([{ id: 'activity-1', attachmentUrl: null }]);
    });

    it('rejects posting an activity to a snag item in a different project', async () => {
      const { svc, withTenant } = makeService({ wrongProject: true });
      withTenant.mockResolvedValueOnce([]); // findOne() finds nothing for this project
      await expect(svc.addActivity(companyId, projectId, 'other-projects-snag', 'user-1', { activityType: 'comment', content: 'hi' }))
        .rejects.toThrow(NotFoundException);
      expect(withTenant).toHaveBeenCalledTimes(1); // never reached the INSERT
    });

    it('posts an activity to a snag item that really is in this project', async () => {
      const { svc, withTenant, findOneRow } = makeService({});
      withTenant
        .mockResolvedValueOnce([findOneRow]) // findOne()
        .mockImplementationOnce(async (_companyId: string, fn: (sql: unknown) => unknown) => fn(
          jest.fn().mockResolvedValue([{ id: 'activity-1' }]),
        )); // addActivity()'s own withTenant(companyId, async (sql) => {...}) callback form
      const activity = await svc.addActivity(companyId, projectId, snagId, 'user-1', { activityType: 'comment', content: 'hi' });
      expect(activity).toEqual({ id: 'activity-1' });
    });
  });

  // RBAC Phase 3: verify() is a dedicated fixed -> verified transition,
  // gated at the controller on ('manage_project_records' OR
  // 'verify_snag_items') -- authorization itself is the guard's job, not
  // this method's, so these tests only cover the state-transition guard and
  // that it stamps verified_at/verified_by the same way update() always has.
  describe('verify', () => {
    function makeService(opts: { existingStatus: string; fixedBy?: string }) {
      const existingRow = { id: snagId, projectId, companyId, status: opts.existingStatus, fixedBy: opts.fixedBy };
      const updatedRow = { id: snagId, status: 'verified', verifiedAt: '2026-01-01T00:00:00Z', verifiedBy: 'user-2' };
      const withTenant = jest.fn()
        .mockResolvedValueOnce([existingRow]) // findOne() inside verify()
        .mockResolvedValueOnce([updatedRow])  // the UPDATE ... RETURNING *
        .mockResolvedValueOnce([existingRow]) // findOne() inside addActivity() (H-1 fix)
        .mockResolvedValueOnce(undefined)     // addActivity()'s INSERT
        .mockResolvedValueOnce(undefined);    // addActivity()'s UPDATE snag_items.updated_at
      const db = { withTenant };
      const svc = new SnaggingService(
        db as unknown as DatabaseService,
        {} as unknown as NotificationsService,
        {} as unknown as StorageService,
        {} as unknown as ProjectAuthorizationService,
      );
      return { svc, withTenant };
    }

    it("verifies a 'fixed' snag item when the verifier is someone other than who fixed it", async () => {
      const { svc } = makeService({ existingStatus: 'fixed', fixedBy: 'user-1' });
      const result = await svc.verify(companyId, projectId, snagId, 'user-2');
      expect(result).toMatchObject({ status: 'verified' });
    });

    it("rejects verifying a snag item that is not currently 'fixed'", async () => {
      const { svc, withTenant } = makeService({ existingStatus: 'open' });
      await expect(svc.verify(companyId, projectId, snagId, 'user-1')).rejects.toThrow(BadRequestException);
      // Only findOne()'s own withTenant call happened -- no UPDATE was attempted.
      expect(withTenant).toHaveBeenCalledTimes(1);
    });

    // Owner's org-category RBAC sprint, segregation-of-duties fix: the same
    // person who marked a snag 'fixed' can no longer also verify it.
    it('rejects self-verification -- the same user who marked it fixed cannot also verify it', async () => {
      const { svc, withTenant } = makeService({ existingStatus: 'fixed', fixedBy: 'user-1' });
      await expect(svc.verify(companyId, projectId, snagId, 'user-1')).rejects.toThrow(ForbiddenException);
      // Only findOne()'s own withTenant call happened -- no UPDATE was attempted.
      expect(withTenant).toHaveBeenCalledTimes(1);
    });
  });
});

// H-1 follow-up: create()/update() accept optional building/level/location
// references that were never checked against this project -- a user
// authorized for Project A could attach Project B's building/level/
// location to a snag item by supplying its id. findAll()/findOne() both
// JOIN buildings/levels for display, so an unchecked cross-project id was a
// real metadata leak there, not merely a dangling reference.
describe('SnaggingService create/update location project-scoping (H-1)', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const snagId = 'snag-1';

  it('create: rejects a same-company building that belongs to a different project, and writes no record', async () => {
    const querySpy = jest.fn();
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => {
      const sql = jest.fn((strings: TemplateStringsArray) => {
        const text = strings.join('?');
        if (text.includes('FROM buildings')) return Promise.resolve([]); // building exists, but not in this project
        return Promise.resolve([]);
      });
      return fn(sql);
    });
    const query = jest.fn((strings: TemplateStringsArray) => {
      querySpy();
      const text = strings.join('?');
      if (text.includes('INSERT INTO snag_items')) return Promise.resolve([{ id: 'snag-new' }]);
      return Promise.resolve([]);
    });
    const db = { withTenant, query };
    const svc = new SnaggingService(
      db as unknown as DatabaseService,
      {} as unknown as NotificationsService,
      {} as unknown as StorageService,
      {} as unknown as ProjectAuthorizationService,
    );

    await expect(svc.create(companyId, projectId, 'user-1', {
      title: 'Snag', buildingId: 'building-from-other-project',
    } as Parameters<typeof svc.create>[3])).rejects.toThrow(NotFoundException);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('update: rejects a same-company location that belongs to a different project, and writes no update', async () => {
    const existingRow = { id: snagId, projectId, companyId, status: 'open' };
    const withTenant = jest.fn()
      .mockResolvedValueOnce([existingRow]) // findOne()
      .mockImplementationOnce((_companyId: string, fn: (sql: unknown) => unknown) => {
        const sql = jest.fn((strings: TemplateStringsArray) => {
          const text = strings.join('?');
          if (text.includes('FROM locations')) return Promise.resolve([]); // location exists, but not in this project
          return Promise.resolve([]);
        });
        return fn(sql);
      });
    const querySpy = jest.fn();
    const query = jest.fn((strings: TemplateStringsArray) => {
      querySpy();
      const text = strings.join('?');
      if (text.includes('UPDATE snag_items')) return Promise.resolve([{ id: snagId }]);
      return Promise.resolve([]);
    });
    const db = { withTenant, query };
    const svc = new SnaggingService(
      db as unknown as DatabaseService,
      {} as unknown as NotificationsService,
      {} as unknown as StorageService,
      {} as unknown as ProjectAuthorizationService,
    );

    await expect(svc.update(companyId, projectId, snagId, 'user-1', {
      locationId: 'location-from-other-project',
    } as Parameters<typeof svc.update>[4])).rejects.toThrow(NotFoundException);
    expect(querySpy).not.toHaveBeenCalled();
  });
});
