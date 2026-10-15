import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubcontractorRfiAccessGuard } from './subcontractor-rfi-access.guard';
import type { SubcontractorRfiAccessService } from '../authorization/subcontractor-rfi-access.service';

function makeContext(opts: { user?: unknown; method: string; path: string; params?: Record<string, string> }) {
  const request = { user: opts.user, method: opts.method, path: opts.path, params: opts.params ?? {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeGuard(isPublic: boolean | undefined, isSubcontractor: boolean, owns = true) {
  const reflector = { getAllAndOverride: jest.fn(() => isPublic) } as unknown as Reflector;
  const access = {
    isSubcontractor: jest.fn().mockResolvedValue(isSubcontractor),
    ownsRfi: jest.fn().mockResolvedValue(owns),
  } as unknown as SubcontractorRfiAccessService;
  const guard = new SubcontractorRfiAccessGuard(access, reflector);
  return { guard, access };
}

const subcontractor = { companyId: 'company-1', id: 'user-1' };
const params = { projectId: 'p1' };

describe('SubcontractorRfiAccessGuard', () => {
  it('always passes @Public() routes without checking', async () => {
    const { guard, access } = makeGuard(true, true);
    await expect(guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/rfis', params }))).resolves.toBe(true);
    expect(access.isSubcontractor).not.toHaveBeenCalled();
  });

  it('passes through when there is no authenticated user', async () => {
    const { guard } = makeGuard(false, true);
    await expect(guard.canActivate(makeContext({ user: undefined, method: 'GET', path: '/api/v1/projects/p1/rfis', params }))).resolves.toBe(true);
  });

  it('never restricts a non-subcontractor project member', async () => {
    const { guard } = makeGuard(false, false);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'DELETE', path: '/api/v1/projects/p1', params })),
    ).resolves.toBe(true);
  });

  it('blocks a subcontractor from any route outside the RFI module, including reads', async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/issues', params })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/documents', params })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a subcontractor to list, read, create, and comment on RFIs', async () => {
    const { guard } = makeGuard(false, true);
    const requests: Array<[string, string]> = [
      ['GET', '/api/v1/projects/p1/rfis'],
      ['GET', '/api/v1/projects/p1/rfis/summary'],
      ['GET', '/api/v1/projects/p1/rfis/rfi-1'],
      ['POST', '/api/v1/projects/p1/rfis'],
      ['POST', '/api/v1/projects/p1/rfis/rfi-1/submit'],
      ['POST', '/api/v1/projects/p1/rfis/rfi-1/comments'],
      ['GET', '/api/v1/projects/p1/rfis/rfi-1/comments'],
    ];
    for (const [method, path] of requests) {
      await expect(guard.canActivate(makeContext({ user: subcontractor, method, path, params }))).resolves.toBe(true);
    }
  });

  it('blocks a subcontractor from every main-contractor-only workflow action, regardless of ownership', async () => {
    const { guard } = makeGuard(false, true, true);
    const actionPaths = [
      '/api/v1/projects/p1/rfis/rfi-1/request-clarification',
      '/api/v1/projects/p1/rfis/rfi-1/respond',
      '/api/v1/projects/p1/rfis/rfi-1/submit-for-review',
      '/api/v1/projects/p1/rfis/rfi-1/decide-review',
      '/api/v1/projects/p1/rfis/rfi-1/close',
      '/api/v1/projects/p1/rfis/rfi-1/reopen',
      '/api/v1/projects/p1/rfis/rfi-1/remind-drawing-update',
      '/api/v1/projects/p1/rfis/rfi-1/drawing-update/mark-applied',
      '/api/v1/projects/p1/rfis/rfi-1/letter',
    ];
    for (const path of actionPaths) {
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path, params })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('allows an attachment write on an RFI the subcontractor owns', async () => {
    const { guard, access } = makeGuard(false, true, true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path: '/api/v1/projects/p1/rfis/rfi-1/attachments/upload-url', params })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path: '/api/v1/projects/p1/rfis/rfi-1/attachments', params })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'DELETE', path: '/api/v1/projects/p1/rfis/rfi-1/attachments/att-1', params })),
    ).resolves.toBe(true);
    expect(access.ownsRfi).toHaveBeenCalledWith(subcontractor, 'rfi-1');
  });

  it('blocks an attachment write on an RFI the subcontractor does not own', async () => {
    const { guard } = makeGuard(false, true, false);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path: '/api/v1/projects/p1/rfis/rfi-1/attachments', params })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks PATCH/DELETE on an RFI record the subcontractor does not own', async () => {
    const { guard } = makeGuard(false, true, false);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'PATCH', path: '/api/v1/projects/p1/rfis/rfi-1', params })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // Regression test: ProjectsController's own routes use :id, not
  // :projectId (RfisController's own param name) -- reading
  // request.params.projectId for those requests silently returned
  // undefined, which made isSubcontractor() return false and let the
  // request straight through, unguarded, regardless of the path. The fix
  // extracts the id from the URL itself instead of trusting any
  // controller's own param name.
  it("derives the project id from the URL path, not request.params, so a controller whose param is named :id (not :projectId) is still guarded", async () => {
    const { guard, access } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({
        user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/permission-grants', params: { id: 'p1' },
      })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.isSubcontractor).toHaveBeenCalledWith(subcontractor, 'p1');
  });

  it('allows the read-only project name/member-list/organizations endpoints the RFI screens themselves depend on', async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1', params: { id: 'p1' } })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/members', params: { id: 'p1' } })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/organizations', params: { id: 'p1' } })),
    ).resolves.toBe(true);
  });

  it('does not extend the read-only carve-out to writes on those same project-context paths', async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'PATCH', path: '/api/v1/projects/p1', params: { id: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path: '/api/v1/projects/p1/members', params: { id: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'DELETE', path: '/api/v1/projects/p1/members/u2', params: { id: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not extend the carve-out to a different project-context path shape (e.g. /organizations/members or a single org)', async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/organizations/members', params: { id: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'PUT', path: '/api/v1/projects/p1/organizations/client', params: { id: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
