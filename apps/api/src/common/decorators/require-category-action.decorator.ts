import { SetMetadata } from '@nestjs/common';
import type { OrgModule, OrgAction, ProjectPermission } from '@engineeringos/types';

export const CATEGORY_ACTION_KEY = 'categoryAction';

export interface CategoryActionSpec {
  module: OrgModule;
  action: OrgAction;
  // Pre-existing discretionary ProjectPermission grant(s) that ALSO satisfy
  // this route (OR, not AND, with the category check) -- preserves every
  // admin-granted exception that worked before this sprint. Pass the same
  // permission(s) the route's old @RequireProjectPermission(...) named, if
  // any, so this decorator is a drop-in replacement, not a narrowing.
  fallbackPermissions?: ProjectPermission[];
}

// Gates a route on CategoryActionGuard -- see that guard and
// OrgCategoryPermissionService for exactly what satisfies it (super_admin,
// the project's own project_lead, engineering_manager always, the caller's
// organizational category per the owner's permission matrix, OR any of
// fallbackPermissions via the pre-existing project_permission_grants system).
// Route must have either a :projectId or :id param naming the target
// project, same convention as @RequireProjectPermission.
export const RequireCategoryAction = (
  orgModule: OrgModule,
  action: OrgAction,
  ...fallbackPermissions: ProjectPermission[]
) => SetMetadata(CATEGORY_ACTION_KEY, { module: orgModule, action, fallbackPermissions } satisfies CategoryActionSpec);
