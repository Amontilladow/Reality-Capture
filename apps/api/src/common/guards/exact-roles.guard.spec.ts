import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExactRolesGuard } from './exact-roles.guard';

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('ExactRolesGuard', () => {
  it('allows a user whose role is in the list', () => {
    const reflector = { getAllAndOverride: () => ['qa_qc_manager', 'company_admin'] } as unknown as Reflector;
    const guard = new ExactRolesGuard(reflector);
    expect(guard.canActivate(makeContext({ companyRole: 'qa_qc_manager' }))).toBe(true);
  });

  // The whole point of this guard vs. RolesGuard: a higher-weight role
  // that is NOT in the explicit list must still be rejected.
  it('rejects a higher-weight role that is not in the explicit list, unlike a weight-threshold check', () => {
    const reflector = { getAllAndOverride: () => ['qa_qc_manager', 'company_admin', 'super_admin'] } as unknown as Reflector;
    const guard = new ExactRolesGuard(reflector);
    expect(() => guard.canActivate(makeContext({ companyRole: 'technical_director' })))
      .toThrow(ForbiddenException);
    expect(() => guard.canActivate(makeContext({ companyRole: 'construction_manager' })))
      .toThrow(ForbiddenException);
  });

  it('allows any authenticated user when no @RequireExactRoles() metadata is set', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new ExactRolesGuard(reflector);
    expect(guard.canActivate(makeContext({ companyRole: 'client_representative' }))).toBe(true);
  });

  it('rejects with no user on the request', () => {
    const reflector = { getAllAndOverride: () => ['qa_qc_manager'] } as unknown as Reflector;
    const guard = new ExactRolesGuard(reflector);
    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });
});
