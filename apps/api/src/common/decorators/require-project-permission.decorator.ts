import { SetMetadata } from '@nestjs/common';
import type { ProjectPermission } from '@engineeringos/types';

export const PROJECT_PERMISSION_KEY = 'projectPermission';

// Gates a route on ProjectPermissionGuard -- see that file for exactly what
// bypasses it (super_admin, the project's own project_lead) versus what
// requires a row in project_permission_grants (everyone else, chiefly a
// company_admin the grant is meant to extend). Route must have either a
// :projectId or :id param naming the target project -- every controller
// this is applied to is nested under projects/:projectId/... except
// projects.controller.ts itself, whose member routes use :id directly.
export const RequireProjectPermission = (permission: ProjectPermission) =>
  SetMetadata(PROJECT_PERMISSION_KEY, permission);
