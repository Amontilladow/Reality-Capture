import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SECTION_7_VIEW_ONLY_COMPANY_ROLES } from '@engineeringos/types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Owner's org-category RBAC sprint, matrix section 7: Chairman/General
// Manager/Operations Manager get View-only access to the Risk Register,
// Reports, Snagging (reads), BuildLens/BuildLens Captures, and the AI
// Assistant -- Engineering Manager keeps full access (no gating needed:
// nothing in this guard ever restricts it), and every other category's
// existing, unchanged behavior on these modules (today: open to any
// authenticated project member -- see each controller's own "deliberately
// ungated" comments, an audited, deliberate choice per risk.controller.ts)
// is untouched. Deliberately NOT named/exported from
// SECTION_7_VIEW_ONLY_COMPANY_ROLES's own OrgCategory ('management') --
// company_admin/technical_director/commercial_manager/consultant, though
// also 'management' category, keep their existing unrestricted access to
// this module set; only these 3 specific titles are named by the owner's
// own matrix.
//
// AI Assistant (ai.controller.ts's `ask`) is deliberately NOT gated here
// despite being POST -- it's a question/query action with nothing to
// "view" vs. "do" (no project data is created/edited by asking it a
// question), so a View-only restriction has no meaningful write to block;
// gating it would just deny these 3 roles AI Assistant use entirely, which
// isn't this rule's intent. Flagged in this sprint's own report.
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const VIEW_ONLY_MODULE_PATTERN =
  /^\/api\/v1\/projects\/[^/]+\/(risk|reports|progress-reports|snag-items|captures)(\/|$)/;

@Injectable()
export class SectionSevenViewOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return true; // no authenticated user -- not this guard's concern

    if (!WRITE_METHODS.has(request.method)) return true; // reads are never restricted here

    if (!SECTION_7_VIEW_ONLY_COMPANY_ROLES.includes(user.companyRole)) return true;

    const path = request.path ?? request.url;
    if (!VIEW_ONLY_MODULE_PATTERN.test(path)) return true;

    throw new ForbiddenException({
      code: 'SECTION_7_VIEW_ONLY',
      message: 'Your role has view-only access to the Risk Register, Reports, Snagging, BuildLens and BuildLens Captures.',
    });
  }
}
