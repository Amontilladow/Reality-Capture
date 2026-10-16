import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  getOrgCategory, categoryCan,
  type CompanyRole, type OrgModule, type OrgAction,
} from '@engineeringos/types';

// Single source of truth for "does this user's organizational CATEGORY grant
// them this action on this module" -- the owner's RBAC sprint. Deliberately
// separate from ProjectAuthorizationService (the pre-existing, per-project
// DISCRETIONARY grant system: project_permission_grants rows a
// company_admin/super_admin hands out one project at a time). The two are
// composed with OR, never AND, by CategoryActionGuard: category membership
// is now an ADDITIONAL, automatic way to gain access on every project
// company-wide, on top of (never narrower than) the pre-existing ability to
// grant someone an exception on one specific project. Neither this service
// nor the guard built on it ever removes or disables the pre-existing
// grant system -- see CategoryActionGuard's own header comment.
//
// Bypass order (checked before ever consulting the category matrix):
//  1. super_admin -- unchanged existing precedent (ProjectAuthorizationService).
//  2. The project's own project_lead -- same precedent: someone deliberately,
//     explicitly put in charge of THIS project keeps running it regardless
//     of their company-wide category, same as they already bypass the
//     discretionary grant system today.
//  3. engineering_manager -- the owner's named, explicit exception: full
//     create/view/edit/approve/close on every module. This is a hard bypass
//     of the category matrix lookup, not a row within it, so a future edit
//     to CATEGORY_PERMISSION_MATRIX can never accidentally narrow it.
// Below those three, every other company role is resolved to its
// OrgCategory (getOrgCategory) and checked against CATEGORY_PERMISSION_MATRIX.
//
// A 'subcontractor' project member is NOT resolved through this service at
// all -- Subcontractor/"External" is project-scoped, not company-wide (see
// OrgCategory's own header comment in user.types.ts), and every module that
// grants it anything requires an ownership check this flat category lookup
// can't express. See SubcontractorRfiAccessGuard instead, which now covers
// every module the owner's matrix grants a subcontractor any access to.
@Injectable()
export class OrgCategoryPermissionService {
  constructor(private readonly db: DatabaseService) {}

  async canPerformAction(
    user: { companyId: string; companyRole: CompanyRole; id: string },
    projectId: string | undefined,
    orgModule: OrgModule,
    action: OrgAction,
  ): Promise<boolean> {
    if (user.companyRole === 'super_admin') return true;
    if (user.companyRole === 'engineering_manager') return true;

    if (projectId) {
      const [membership] = await this.db.withTenant(user.companyId, (sql) => sql`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${user.id}
      `);
      if (membership?.role === 'project_lead') return true;
      // A 'subcontractor' project member is never resolved through the
      // CompanyRole-derived category matrix below (see this service's own
      // header comment) -- defer entirely to SubcontractorRfiAccessGuard,
      // which runs after this guard in the chain and is solely responsible
      // for what a subcontractor can do (ownership-scoped per module, per
      // the owner's matrix). Returning true here just means "this guard
      // doesn't block it" -- it is NOT a grant of access on its own.
      if (membership?.role === 'subcontractor') return true;
    }

    return categoryCan(getOrgCategory(user.companyRole), orgModule, action);
  }
}
