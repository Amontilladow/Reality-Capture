import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SnaggingService } from './snagging.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { StorageService } from '../storage/storage.service';

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
    function makeService(opts: { snagExists?: boolean; actualSizeBytes: number | null }) {
      const snagExists = opts.snagExists ?? true;
      const insertedRow = { id: 'activity-1' };
      const withTenant = jest.fn()
        .mockResolvedValueOnce(snagExists ? [{ id: snagId }] : [])
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
      );
      return { svc, getObjectSize, deleteIfExists };
    }

    const baseDto = { storageKey: 'company-1/snag-items/project-1/photo.jpg', filename: 'photo.jpg', sizeBytes: 1 };

    it('registers an attachment whose real uploaded size is within the 5MB limit', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: 1024 });
      const activity = await svc.addAttachment(companyId, snagId, 'user-1', baseDto);
      expect(activity).toEqual({ id: 'activity-1' });
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('rejects and cleans up an attachment whose real size exceeds the 5MB limit', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: 6 * 1024 * 1024 });
      await expect(svc.addAttachment(companyId, snagId, 'user-1', baseDto)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).toHaveBeenCalledWith(baseDto.storageKey);
    });

    it('rejects registration when the declared storage key was never actually uploaded', async () => {
      const { svc, deleteIfExists } = makeService({ actualSizeBytes: null });
      await expect(svc.addAttachment(companyId, snagId, 'user-1', baseDto)).rejects.toThrow(BadRequestException);
      expect(deleteIfExists).not.toHaveBeenCalled();
    });

    it('rejects an attachment for a snag item that does not exist under this company', async () => {
      const { svc, getObjectSize } = makeService({ snagExists: false, actualSizeBytes: 1024 });
      await expect(svc.addAttachment(companyId, 'someone-elses-snag', 'user-1', baseDto)).rejects.toThrow(NotFoundException);
      expect(getObjectSize).not.toHaveBeenCalled();
    });
  });
});
