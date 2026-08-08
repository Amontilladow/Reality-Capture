import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_PENDING_KEY } from '../decorators/allow-pending.decorator';

// Registered right after JwtAuthGuard (needs request.user) and before
// RolesGuard, so a pending user gets a clear PENDING_APPROVAL rejection
// rather than a generic insufficient-role one. This is real backend
// enforcement, not a frontend routing convenience -- a pending user's
// access token literally cannot reach anything except @AllowPending()
// routes, regardless of what company_role they were seeded with.
@Injectable()
export class PendingApprovalGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowPending) return true;

    const { user } = context.switchToHttp().getRequest();
    if (user?.pendingApproval) {
      throw new ForbiddenException({
        code: 'PENDING_APPROVAL',
        message: 'Your account is awaiting administrator approval.',
      });
    }
    return true;
  }
}
