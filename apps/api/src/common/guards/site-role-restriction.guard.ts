import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SiteRoleService } from '../authorization/site-role.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// CTO spec sections 16-21: Site Engineer / Construction Manager / Project
// Engineer have full working access ONLY to Floor Plans, Issues and
// Snagging; everywhere else is read-only (no new reads are blocked here --
// GET is always allowed, since every read route already scopes by
// companyId/projectId) and project settings/user management/billing get
// NO access at all (also enforced here, since those happen to be mutating
// routes too).
//
// Two different identities trigger this, deliberately kept separate per
// product decision:
//  - company_role IN ('construction_manager', 'project_engineer') --
//    restricted on EVERY request, company-wide, cheap (already on the JWT).
//  - project_members.role = 'site_engineer' for the SPECIFIC project in the
//    route -- restricted only within that project's own routes. A user who
//    holds 'site_engineer' on Project A but not on Project B is unrestricted
//    on Project B. This does NOT extend to company-wide routes with no
//    project in the URL (e.g. GET /users, /subscription) -- those are
//    governed by the user's company_role as before, to avoid a DB lookup on
//    every single request in the app just to rule out a narrow case. If
//    that broader reach is wanted later, extend case (b) below.
//
// This guard only ADDS restrictions -- it never grants a bypass. A
// restricted user still needs whatever grant (e.g. manage_issues,
// manage_project_records) the existing ProjectPermissionGuard already
// requires for a given write; this guard's allowlist only means "don't
// block this route outright," not "skip the normal permission check."
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Matches the project-nested base paths for the three full-working modules
// -- see issues.controller.ts/snagging.controller.ts/drawings.controller.ts
// for the exact @Controller() paths these mirror (snag-items, not snagging).
const ALLOWED_PATH_PATTERN = /^\/api\/v1\/projects\/[^/]+\/(issues|snag-items|drawings)(\/|$)/;

@Injectable()
export class SiteRoleRestrictionGuard implements CanActivate {
  constructor(
    private readonly siteRole: SiteRoleService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return true; // no authenticated user -- not this guard's concern

    if (!WRITE_METHODS.has(request.method)) return true; // reads are never restricted here

    const restricted = await this.siteRole.isRestricted(user, request.params?.projectId);
    if (!restricted) return true;

    if (ALLOWED_PATH_PATTERN.test(request.path ?? request.url)) return true;

    throw new ForbiddenException({
      code: 'SITE_ROLE_RESTRICTED',
      message: 'Your current RealityCapture role has full access to Floor Plans, Issues and Snagging, and read-only access elsewhere. Contact a project administrator if you need this action.',
    });
  }
}
