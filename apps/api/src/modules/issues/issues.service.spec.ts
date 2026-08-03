import { NotFoundException } from '@nestjs/common';
import { IssuesService } from './issues.service';

describe('IssuesService view-state / screenshot behavior', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const issueId = 'issue-1';

  function makeService(opts: {
    issueRow?: Record<string, unknown> | undefined;
    getReadUrl?: jest.Mock;
    getUploadUrl?: jest.Mock;
    generateKey?: jest.Mock;
  }) {
    const db = { withTenant: jest.fn().mockResolvedValue(opts.issueRow ? [opts.issueRow] : []) };
    const aiClient = {};
    const notifications = {};
    const storage = {
      getReadUrl: opts.getReadUrl ?? jest.fn().mockResolvedValue('https://presigned.example/read'),
      getUploadUrl: opts.getUploadUrl ?? jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put', storageKey: 'key' }),
      generateKey: opts.generateKey ?? jest.fn().mockReturnValue('company-1/issues/123.png'),
    };
    return new IssuesService(db as any, aiClient as any, notifications as any, storage as any);
  }

  describe('findOne', () => {
    it('resolves a screenshotUrl when the issue has a stored screenshot key', async () => {
      const getReadUrl = jest.fn().mockResolvedValue('https://presigned.example/read?sig=abc');
      const svc = makeService({
        issueRow: { id: issueId, title: 'Broken conduit', screenshotStorageKey: 'company-1/issues/456.png' },
        getReadUrl,
      });

      const result = await svc.findOne(companyId, projectId, issueId);

      expect(getReadUrl).toHaveBeenCalledWith('company-1/issues/456.png');
      expect(result.screenshotUrl).toBe('https://presigned.example/read?sig=abc');
    });

    it('does not call storage and has no screenshotUrl when no screenshot was captured', async () => {
      const getReadUrl = jest.fn();
      const svc = makeService({
        issueRow: { id: issueId, title: 'No screenshot here', screenshotStorageKey: null },
        getReadUrl,
      });

      const result = await svc.findOne(companyId, projectId, issueId);

      expect(getReadUrl).not.toHaveBeenCalled();
      expect(result.screenshotUrl).toBeUndefined();
    });

    it('throws NotFoundException for a missing issue', async () => {
      const svc = makeService({ issueRow: undefined });
      await expect(svc.findOne(companyId, projectId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getScreenshotUploadUrl', () => {
    it('generates an issues-namespaced key and requests a PNG upload URL', async () => {
      const generateKey = jest.fn().mockReturnValue('company-1/issues/999.png');
      const getUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: 'https://presigned.example/put', storageKey: 'company-1/issues/999.png' });
      const svc = makeService({ generateKey, getUploadUrl });

      const result = await svc.getScreenshotUploadUrl(companyId, projectId);

      expect(generateKey).toHaveBeenCalledWith(companyId, projectId, 'issues', expect.stringMatching(/\.png$/));
      expect(getUploadUrl).toHaveBeenCalledWith('company-1/issues/999.png', 'image/png', expect.any(Number));
      expect(result).toEqual({ uploadUrl: 'https://presigned.example/put', storageKey: 'company-1/issues/999.png' });
    });
  });
});
