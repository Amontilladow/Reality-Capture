import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SiteRoleRestrictionGuard } from './site-role-restriction.guard';
import type { SiteRoleService } from '../authorization/site-role.service';

function makeContext(opts: { user?: unknown; method: string; path: string; params?: Record<string, string> }) {
  const request = { user: opts.user, method: opts.method, path: opts.path, params: opts.params ?? {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeGuard(isPublic: boolean | undefined, isRestricted: boolean) {
  const reflector = { getAllAndOverride: jest.fn(() => isPublic) } as unknown as Reflector;
  const siteRole = { isRestricted: jest.fn().mockResolvedValue(isRestricted) } as unknown as SiteRoleService;
  const guard = new SiteRoleRestrictionGuard(siteRole, reflector);
  return { guard, siteRole };
}

const restrictedUser = { companyId: 'company-1', companyRole: 'construction_manager', id: 'user-1' };

describe('SiteRoleRestrictionGuard', () => {
  it('always passes @Public() routes without checking restriction', async () => {
    const { guard, siteRole } = makeGuard(true, true);
    await expect(guard.canActivate(makeContext({ user: restrictedUser, method: 'POST', path: '/api/v1/users' }))).resolves.toBe(true);
    expect(siteRole.isRestricted).not.toHaveBeenCalled();
  });

  it('passes through when there is no authenticated user', async () => {
    const { guard } = makeGuard(false, true);
    await expect(guard.canActivate(makeContext({ user: undefined, method: 'POST', path: '/api/v1/users' }))).resolves.toBe(true);
  });

  it('never restricts reads (GET), even for a restricted role on a disallowed path', async () => {
    const { guard, siteRole } = makeGuard(false, true);
    await expect(guard.canActivate(makeContext({ user: restrictedUser, method: 'GET', path: '/api/v1/users' }))).resolves.toBe(true);
    expect(siteRole.isRestricted).not.toHaveBeenCalled();
  });

  it('allows a restricted user through on Issues/Snagging/Floor Plans write routes', async () => {
    const { guard } = makeGuard(false, true);
    const paths = [
      '/api/v1/projects/p1/issues',
      '/api/v1/projects/p1/issues/i1',
      '/api/v1/projects/p1/snag-items/s1',
      '/api/v1/projects/p1/drawings',
    ];
    for (const path of paths) {
      await expect(guard.canActivate(makeContext({ user: restrictedUser, method: 'POST', path, params: { projectId: 'p1' } }))).resolves.toBe(true);
    }
  });

  it('blocks a restricted user writing outside Issues/Snagging/Floor Plans', async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: restrictedUser, method: 'PATCH', path: '/api/v1/projects/p1', params: { projectId: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a restricted user writing to RFIs (outside the three allowed modules)', async () => {
    const { guard } = makeGuard(false, true);
    await expect(
      guard.canActivate(makeContext({ user: restrictedUser, method: 'POST', path: '/api/v1/projects/p1/rfis', params: { projectId: 'p1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never restricts an unrestricted user, on any write path', async () => {
    const { guard } = makeGuard(false, false);
    const unrestricted = { companyId: 'company-1', companyRole: 'project_manager', id: 'user-2' };
    await expect(
      guard.canActivate(makeContext({ user: unrestricted, method: 'PATCH', path: '/api/v1/projects/p1', params: { projectId: 'p1' } })),
    ).resolves.toBe(true);
  });
});
