import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgCategoryPermissionService } from '../authorization/org-category-permission.service';
import { ProjectAuthorizationService } from '../authorization/project-authorization.service';
import { CATEGORY_ACTION_KEY, type CategoryActionSpec } from '../decorators/require-category-action.decorator';

// Composes OrgCategoryPermissionService (the owner's new, company-wide
// category matrix) with the pre-existing per-project discretionary grant
// system (ProjectAuthorizationService) via OR: a route passes if EITHER
// grants it, so an admin's existing project_permission_grants exception
// keeps working exactly as before this sprint, and category membership is
// now an ADDITIONAL, automatic path to the same access. Never narrows what
// an explicit grant already allowed.
@Injectable()
export class CategoryActionGuard implements CanActivate {
  constructor(
    private readonly orgPerm: OrgCategoryPermissionService,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<CategoryActionSpec>(CATEGORY_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequireCategoryAction() -- not a gated route
    if (!spec) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false;

    const projectId: string | undefined = request.params?.projectId ?? request.params?.id;
    if (!projectId) return false;

    const viaCategory = await this.orgPerm.canPerformAction(user, projectId, spec.module, spec.action);
    if (viaCategory) return true;

    for (const permission of spec.fallbackPermissions ?? []) {
      const authorized = await this.projectAuth.hasProjectPermission(
        user.companyId, user.companyRole, user.id, projectId, permission,
      );
      if (authorized) return true;
    }

    throw new ForbiddenException({
      code: 'INSUFFICIENT_CATEGORY_PERMISSION',
      message: `Your organizational category does not have '${spec.action}' access to this module.`,
    });
  }
}
