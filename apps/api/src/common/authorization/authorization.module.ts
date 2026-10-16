import { Global, Module } from '@nestjs/common';
import { ProjectAuthorizationService } from './project-authorization.service';
import { SiteRoleService } from './site-role.service';
import { SubcontractorRfiAccessService } from './subcontractor-rfi-access.service';
import { OrgCategoryPermissionService } from './org-category-permission.service';

// Global, same as DatabaseModule -- ProjectAuthorizationService is consumed
// by ProjectPermissionGuard (app-wide, via APP_GUARD) and by individual
// module services (RfisService, IssuesService, ...) that need the same
// project-role/permission check for logic a route guard alone can't express
// (e.g. "the RFI's own creator may act on it even with no grant").
//
// SiteRoleService lives here too (not in common/guards) so AiService can
// inject it for role-aware draft blocking without needing to import
// anything guard-specific -- it's shared authorization logic, not routing.
// SubcontractorRfiAccessService is its RFI-module counterpart, consumed by
// SubcontractorRfiAccessGuard (also app-wide, via APP_GUARD).
// OrgCategoryPermissionService is the owner's org-category RBAC sprint
// counterpart, consumed by CategoryActionGuard (also app-wide, via
// APP_GUARD).
@Global()
@Module({
  providers: [ProjectAuthorizationService, SiteRoleService, SubcontractorRfiAccessService, OrgCategoryPermissionService],
  exports: [ProjectAuthorizationService, SiteRoleService, SubcontractorRfiAccessService, OrgCategoryPermissionService],
})
export class AuthorizationModule {}
