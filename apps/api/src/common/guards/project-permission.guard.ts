import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectAuthorizationService } from '../authorization/project-authorization.service';
import { PROJECT_PERMISSION_KEY } from '../decorators/require-project-permission.decorator';
import type { ProjectPermission } from '@engineeringos/types';

@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  constructor(
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions = this.reflector.getAllAndOverride<ProjectPermission[]>(PROJECT_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequireProjectPermission() -- not a gated route
    if (!permissions || permissions.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false;

    // Every controller this guard is applied to is nested under
    // projects/:projectId/... except projects.controller.ts's own member
    // routes, which use :id for the project directly.
    const projectId: string | undefined = request.params?.projectId ?? request.params?.id;
    if (!projectId) return false;

    // See ProjectAuthorizationService for the exact bypass order
    // (super_admin, then the project's own project_lead, then a matching
    // project_permission_grants row) -- shared with RfisService and
    // IssuesService, which need the same check for logic a route guard
    // alone can't express (e.g. "the RFI's own creator may act on it even
    // with no grant").
    //
    // A route naming more than one permission (e.g. 'manage_rfis' OR
    // 'approve_rfis') is satisfied by any one of them -- checked in order,
    // short-circuiting on the first match so the common case (holding the
    // first-listed, broader permission) never pays for a second query.
    for (const permission of permissions) {
      const authorized = await this.projectAuth.hasProjectPermission(
        user.companyId, user.companyRole, user.id, projectId, permission,
      );
      if (authorized) return true;
    }

    throw new ForbiddenException({
      code: 'INSUFFICIENT_PROJECT_PERMISSION',
      message: permissions.length === 1
        ? `This project requires the '${permissions[0]}' permission.`
        : `This project requires one of these permissions: ${permissions.join(', ')}.`,
    });
  }
}
