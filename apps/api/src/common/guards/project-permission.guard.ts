import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../../database/database.service';
import { PROJECT_PERMISSION_KEY } from '../decorators/require-project-permission.decorator';
import type { ProjectPermission } from '@engineeringos/types';

@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<ProjectPermission>(PROJECT_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequireProjectPermission() -- not a gated route
    if (!permission) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false;

    // Full authority everywhere -- matches RolesGuard's treatment of
    // super_admin on company-wide routes.
    if (user.companyRole === 'super_admin') return true;

    // Every controller this guard is applied to is nested under
    // projects/:projectId/... except projects.controller.ts's own member
    // routes, which use :id for the project directly.
    const projectId: string | undefined = request.params?.projectId ?? request.params?.id;
    if (!projectId) return false;

    const [membership] = await this.db.withTenant(user.companyId, sql => sql`
      SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${user.id}
    `);
    // A project's own project_lead runs their own project without needing a
    // company-wide title or a grant for it -- same as a real construction
    // project lead would.
    if (membership?.role === 'project_lead') return true;

    const [grant] = await this.db.withTenant(user.companyId, sql => sql`
      SELECT id FROM project_permission_grants
      WHERE project_id = ${projectId} AND user_id = ${user.id} AND permission = ${permission}
    `);
    if (grant) return true;

    throw new ForbiddenException({
      code: 'INSUFFICIENT_PROJECT_PERMISSION',
      message: `This project requires the '${permission}' permission.`,
    });
  }
}
