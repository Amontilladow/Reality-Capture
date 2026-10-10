import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EXACT_ROLES_KEY } from '../decorators/require-exact-roles.decorator';
import type { CompanyRole } from '@engineeringos/types';

// Pairs with @RequireExactRoles() -- membership in an explicit list, not a
// COMPANY_ROLE_WEIGHT threshold (see RolesGuard for that one). Deliberately
// does NOT bake in an implicit company_admin/super_admin bypass: "exact"
// means exact. Every call site that wants the standard admin override
// (the common case elsewhere in this app's RBAC) lists company_admin and
// super_admin explicitly in its own @RequireExactRoles(...) call.
@Injectable()
export class ExactRolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<CompanyRole[]>(EXACT_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequireExactRoles() decorator -- endpoint is accessible to any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    if (!requiredRoles.includes(user.companyRole as CompanyRole)) {
      throw new ForbiddenException({
        code: 'ROLE_NOT_PERMITTED',
        message: `This action requires one of: ${requiredRoles.join(', ')}.`,
      });
    }
    return true;
  }
}
