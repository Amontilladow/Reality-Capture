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

function makeGuard(
  isPublic: boolean | undefined,
  isSubcontractor: boolean,
  owns = true,
  ownsIssue = true,
  ownsSubmittal = true,
  isSubcontractorOnAnyProject = isSubcontractor,
) {
  const reflector = { getAllAndOverride: jest.fn(() => isPublic) } as unknown as Reflector;
  const access = {
    isSubcontractor: jest.fn().mockResolvedValue(isSubcontractor),
    isSubcontractorOnAnyProject: jest.fn().mockResolvedValue(isSubcontractorOnAnyProject),
    ownsRfi: jest.fn().mockResolvedValue(owns),
    ownsIssue: jest.fn().mockResolvedValue(ownsIssue),
    ownsSubmittal: jest.fn().mockResolvedValue(ownsSubmittal),
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

  it('blocks a subcontractor from any route outside RFIs/Drawings(read)/Issues, including reads', async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/documents', params })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/bim/models', params })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/qaqc', params })),
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

  // Owner's org-category RBAC sprint: Drawings grants Subcontractor
  // "V -- own project scope only" -- a new, narrow read-only carve-out.
  it("allows GET access to this project's Drawings (new, matrix-granted 'view' access)", async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/drawings', params: { projectId: 'p1' } })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/drawings/d1', params: { projectId: 'p1' } })),
    ).resolves.toBe(true);
  });

  it('does not extend the Drawings carve-out to writes -- the matrix grants no create/edit there', async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path: '/api/v1/projects/p1/drawings', params: { projectId: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path: '/api/v1/projects/p1/drawings/d1/pins', params: { projectId: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // Owner's org-category RBAC sprint: Issues grants Subcontractor
  // "C,V -- own company's issues only".
  describe('Issues access', () => {
    it('allows list/read/create (own-company isolation enforced at the service layer, not here)', async () => {
      const { guard } = makeGuard(false, true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/issues', params: { projectId: 'p1' } })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/issues/i1', params: { projectId: 'p1' } })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path: '/api/v1/projects/p1/issues', params: { projectId: 'p1' } })),
      ).resolves.toBe(true);
    });

    it('allows editing an issue the subcontractor owns, blocks one they do not', async () => {
      const owning = makeGuard(false, true, true, true);
      await expect(
        owning.guard.canActivate(makeContext({ user: subcontractor, method: 'PATCH', path: '/api/v1/projects/p1/issues/i1', params: { projectId: 'p1' } })),
      ).resolves.toBe(true);
      expect(owning.access.ownsIssue).toHaveBeenCalledWith(subcontractor, 'i1');

      const notOwning = makeGuard(false, true, true, false);
      await expect(
        notOwning.guard.canActivate(makeContext({ user: subcontractor, method: 'PATCH', path: '/api/v1/projects/p1/issues/i1', params: { projectId: 'p1' } })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks close/force-status/reminders/bulk actions outright, regardless of ownership', async () => {
      const { guard } = makeGuard(false, true, true, true);
      const paths = [
        '/api/v1/projects/p1/issues/i1/close',
        '/api/v1/projects/p1/issues/i1/force-status',
        '/api/v1/projects/p1/issues/reminders/broadcast',
        '/api/v1/projects/p1/issues/bulk-close',
      ];
      for (const path of paths) {
        await expect(
          guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path, params: { projectId: 'p1' } })),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });
  });

  // Owner's org-category RBAC sprint: Submittals grants Subcontractor
  // "C,V -- own submittals only". Transmittals gets nothing (deliberately
  // scoped out -- see SUBMITTALS_BASE_PATH_PATTERN's own comment).
  describe('Submittals access', () => {
    it('allows list/read/create (own-submittals isolation enforced at the service layer, not here)', async () => {
      const { guard } = makeGuard(false, true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/submittals', params: { projectId: 'p1' } })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/submittals/s1', params: { projectId: 'p1' } })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'POST', path: '/api/v1/projects/p1/submittals', params: { projectId: 'p1' } })),
      ).resolves.toBe(true);
    });

    it('allows editing a submittal the subcontractor owns, blocks one they do not', async () => {
      const owning = makeGuard(false, true, true, true, true);
      await expect(
        owning.guard.canActivate(makeContext({ user: subcontractor, method: 'PATCH', path: '/api/v1/projects/p1/submittals/s1', params: { projectId: 'p1' } })),
      ).resolves.toBe(true);
      expect(owning.access.ownsSubmittal).toHaveBeenCalledWith(subcontractor, 's1');

      const notOwning = makeGuard(false, true, true, true, false);
      await expect(
        notOwning.guard.canActivate(makeContext({ user: subcontractor, method: 'PATCH', path: '/api/v1/projects/p1/submittals/s1', params: { projectId: 'p1' } })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not extend any access to Transmittals -- a different, unaddressed module', async () => {
      const { guard } = makeGuard(false, true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects/p1/transmittals', params: { projectId: 'p1' } })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // Phase 4 cross-project executive view: GET /reports/company-summary has
  // no :projectId segment, so the per-project isSubcontractor() check above
  // has nothing to key off and would otherwise let it straight through.
  describe('company-wide routes with no :projectId', () => {
    it('blocks a subcontractor (on any project) from the company-summary rollup', async () => {
      const { guard, access } = makeGuard(false, false, true, true, true, true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/reports/company-summary' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(access.isSubcontractorOnAnyProject).toHaveBeenCalledWith(subcontractor);
    });

    it('allows a non-subcontractor through the company-summary rollup', async () => {
      const { guard } = makeGuard(false, false, true, true, true, false);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/reports/company-summary' })),
      ).resolves.toBe(true);
    });

    it('leaves every other project-id-less company-wide route untouched, even for a subcontractor', async () => {
      const { guard, access } = makeGuard(false, false, true, true, true, true);
      await expect(
        guard.canActivate(makeContext({ user: subcontractor, method: 'GET', path: '/api/v1/projects' })),
      ).resolves.toBe(true);
      expect(access.isSubcontractorOnAnyProject).not.toHaveBeenCalled();
    });
  });
});
