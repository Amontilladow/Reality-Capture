import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectPermissionGuard } from './project-permission.guard';
import type { ProjectAuthorizationService } from '../authorization/project-authorization.service';

function makeContext(user: unknown, params: Record<string, string>) {
  const request = { user, params };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeGuard(metadataPermissions: unknown, hasProjectPermission: jest.Mock) {
  const reflector = { getAllAndOverride: jest.fn(() => metadataPermissions) } as unknown as Reflector;
  const projectAuth = { hasProjectPermission } as unknown as ProjectAuthorizationService;
  return new ProjectPermissionGuard(projectAuth, reflector);
}

describe('ProjectPermissionGuard', () => {
  const user = { companyId: 'company-1', companyRole: 'member', id: 'user-1' };

  it('passes through untouched when no @RequireProjectPermission() is set', async () => {
    const hasProjectPermission = jest.fn();
    const guard = makeGuard(undefined, hasProjectPermission);
    await expect(guard.canActivate(makeContext(user, { projectId: 'p1' }))).resolves.toBe(true);
    expect(hasProjectPermission).not.toHaveBeenCalled();
  });

  it('a single required permission passes when granted', async () => {
    const hasProjectPermission = jest.fn().mockResolvedValue(true);
    const guard = makeGuard(['manage_rfis'], hasProjectPermission);
    await expect(guard.canActivate(makeContext(user, { projectId: 'p1' }))).resolves.toBe(true);
    expect(hasProjectPermission).toHaveBeenCalledWith('company-1', 'member', 'user-1', 'p1', 'manage_rfis');
  });

  it('a single required permission is denied when missing', async () => {
    const hasProjectPermission = jest.fn().mockResolvedValue(false);
    const guard = makeGuard(['manage_rfis'], hasProjectPermission);
    await expect(guard.canActivate(makeContext(user, { projectId: 'p1' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('two permissions (OR): passes on the first one checked, without checking the second', async () => {
    const hasProjectPermission = jest.fn().mockResolvedValue(true);
    const guard = makeGuard(['manage_rfis', 'approve_rfis'], hasProjectPermission);
    await expect(guard.canActivate(makeContext(user, { projectId: 'p1' }))).resolves.toBe(true);
    expect(hasProjectPermission).toHaveBeenCalledTimes(1);
    expect(hasProjectPermission).toHaveBeenCalledWith('company-1', 'member', 'user-1', 'p1', 'manage_rfis');
  });

  it('two permissions (OR): passes on the second when only that one is granted', async () => {
    const hasProjectPermission = jest.fn()
      .mockResolvedValueOnce(false) // manage_rfis
      .mockResolvedValueOnce(true); // approve_rfis
    const guard = makeGuard(['manage_rfis', 'approve_rfis'], hasProjectPermission);
    await expect(guard.canActivate(makeContext(user, { projectId: 'p1' }))).resolves.toBe(true);
    expect(hasProjectPermission).toHaveBeenCalledTimes(2);
  });

  it('two permissions (OR): denied only when neither is granted', async () => {
    const hasProjectPermission = jest.fn().mockResolvedValue(false);
    const guard = makeGuard(['manage_rfis', 'approve_rfis'], hasProjectPermission);
    await expect(guard.canActivate(makeContext(user, { projectId: 'p1' }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasProjectPermission).toHaveBeenCalledTimes(2);
  });

  it('denies with no thrown error when there is no authenticated user', async () => {
    const hasProjectPermission = jest.fn();
    const guard = makeGuard(['manage_rfis'], hasProjectPermission);
    await expect(guard.canActivate(makeContext(undefined, { projectId: 'p1' }))).resolves.toBe(false);
    expect(hasProjectPermission).not.toHaveBeenCalled();
  });

  it('denies with no thrown error when the route has neither :projectId nor :id', async () => {
    const hasProjectPermission = jest.fn();
    const guard = makeGuard(['manage_rfis'], hasProjectPermission);
    await expect(guard.canActivate(makeContext(user, {}))).resolves.toBe(false);
    expect(hasProjectPermission).not.toHaveBeenCalled();
  });

  it('falls back to the :id param when :projectId is absent (projects.controller.ts member routes)', async () => {
    const hasProjectPermission = jest.fn().mockResolvedValue(true);
    const guard = makeGuard(['manage_team'], hasProjectPermission);
    await expect(guard.canActivate(makeContext(user, { id: 'p1' }))).resolves.toBe(true);
    expect(hasProjectPermission).toHaveBeenCalledWith('company-1', 'member', 'user-1', 'p1', 'manage_team');
  });
});
