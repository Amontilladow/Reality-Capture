import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { COMPANY_ROLE_WEIGHT, type CompanyRole } from '@engineeringos/types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<CompanyRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator — endpoint is accessible to any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const userWeight = COMPANY_ROLE_WEIGHT[user.companyRole as CompanyRole] ?? 0;
    const minRequired = Math.min(...requiredRoles.map(r => COMPANY_ROLE_WEIGHT[r] ?? 999));

    if (userWeight < minRequired) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: `This action requires one of: ${requiredRoles.join(', ')}.`,
      });
    }
    return true;
  }
}