import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CategoryActionGuard } from './category-action.guard';
import type { OrgCategoryPermissionService } from '../authorization/org-category-permission.service';
import type { ProjectAuthorizationService } from '../authorization/project-authorization.service';
import type { CategoryActionSpec } from '../decorators/require-category-action.decorator';

function makeContext(opts: { user?: unknown; params?: Record<string, string> }) {
  const request = { user: opts.user, params: opts.params ?? {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeGuard(spec: CategoryActionSpec | undefined, viaCategory: boolean, viaFallback = false) {
  const reflector = { getAllAndOverride: jest.fn(() => spec) } as unknown as Reflector;
  const orgPerm = { canPerformAction: jest.fn().mockResolvedValue(viaCategory) } as unknown as OrgCategoryPermissionService;
  const projectAuth = { hasProjectPermission: jest.fn().mockResolvedValue(viaFallback) } as unknown as ProjectAuthorizationService;
  const guard = new CategoryActionGuard(orgPerm, projectAuth, reflector);
  return { guard, orgPerm, projectAuth };
}

const user = { companyId: 'c1', companyRole: 'project_manager', id: 'u1' };
const params = { projectId: 'p1' };

describe('CategoryActionGuard', () => {
  it('passes through unchanged when the route has no @RequireCategoryAction()', async () => {
    const { guard, orgPerm } = makeGuard(undefined, true);
    await expect(guard.canActivate(makeContext({ user, params }))).resolves.toBe(true);
    expect(orgPerm.canPerformAction).not.toHaveBeenCalled();
  });

  it('passes through when there is no authenticated user', async () => {
    const { guard } = makeGuard({ module: 'rfis', action: 'create' }, true);
    await expect(guard.canActivate(makeContext({ user: undefined, params }))).resolves.toBe(false);
  });

  it('passes when the category check alone grants it', async () => {
    const { guard, projectAuth } = makeGuard({ module: 'rfis', action: 'create' }, true);
    await expect(guard.canActivate(makeContext({ user, params }))).resolves.toBe(true);
    // Category already satisfied it -- never falls through to the legacy grant check.
    expect(projectAuth.hasProjectPermission).not.toHaveBeenCalled();
  });

  it('falls through to a fallback ProjectPermission grant when the category check alone does not satisfy it -- preserving pre-sprint admin-granted exceptions', async () => {
    const { guard, projectAuth } = makeGuard(
      { module: 'rfis', action: 'edit', fallbackPermissions: ['manage_project_records'] },
      false,
      true,
    );
    await expect(guard.canActivate(makeContext({ user, params }))).resolves.toBe(true);
    expect(projectAuth.hasProjectPermission).toHaveBeenCalledWith('c1', 'project_manager', 'u1', 'p1', 'manage_project_records');
  });

  it('rejects when neither the category nor any fallback permission grants it', async () => {
    const { guard } = makeGuard({ module: 'rfis', action: 'edit', fallbackPermissions: ['manage_project_records'] }, false, false);
    await expect(guard.canActivate(makeContext({ user, params }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects with no fallbackPermissions at all when the category check fails (e.g. the new RFI-create restriction)', async () => {
    const { guard } = makeGuard({ module: 'rfis', action: 'create' }, false);
    await expect(guard.canActivate(makeContext({ user, params }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
