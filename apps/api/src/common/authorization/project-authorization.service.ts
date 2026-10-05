import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { ProjectPermission, CompanyRole } from '@engineeringos/types';

// Single source of truth for "can this user do X on this project" --
// previously duplicated near-verbatim in three places (ProjectPermissionGuard,
// RfisService.canManageRfiReview(), and IssuesService.isPermittedApprover(),
// the last of which didn't even consider project role at all, only company
// role -- see hasProjectPermission()'s own call sites for how each was fixed
// to call through here instead of reimplementing the same three checks).
//
// Bypass order, matching what every one of those three call sites already
// agreed on independently: (1) super_admin always passes, (2) the project's
// own project_lead always passes -- they run their own project without
// needing a company-wide title or an explicit grant, same as a real
// construction project lead would, (3) anyone else needs a matching row in
// project_permission_grants.
@Injectable()
export class ProjectAuthorizationService {
  constructor(private readonly db: DatabaseService) {}

  async hasProjectPermission(
    companyId: string,
    companyRole: CompanyRole | string,
    userId: string,
    projectId: string,
    permission: ProjectPermission,
  ): Promise<boolean> {
    if (companyRole === 'super_admin') return true;

    return this.db.withTenant(companyId, async (sql) => {
      const [membership] = await sql`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
      `;
      if (membership?.role === 'project_lead') return true;

      const [grant] = await sql`
        SELECT id FROM project_permission_grants
        WHERE project_id = ${projectId} AND user_id = ${userId} AND permission = ${permission}
      `;
      return Boolean(grant);
    });
  }
}
