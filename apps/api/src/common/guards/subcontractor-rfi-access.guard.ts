import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubcontractorRfiAccessService } from '../authorization/subcontractor-rfi-access.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// A 'subcontractor' project member (PROJECT_ROLES) is a genuine outside
// party -- not a same-company employee like every SiteRoleRestrictionGuard
// case -- so this is stricter than that guard in one key way: it restricts
// READS too, not just writes, and (unlike every OrgCategoryPermissionService
// case) ownership-scopes some of what it does grant down to "your own
// records only", not just "this module".
//
// Despite the class name (kept to avoid a sweeping rename across the
// codebase -- see this guard's test file and app.module.ts's own comment on
// it), this guard's scope grew beyond RFIs alone in the owner's
// org-category RBAC sprint: it now also covers Drawings (read-only), Issues
// (create + own-company-only read/write), and Submittals (create +
// own-submittals-only read/write), each per that sprint's own permission
// matrix. Everything else on the project (Transmittals, Documents, BIM,
// QAQC, financials, ...) stays fully blocked, reads included, unless named
// below.
//
// RFI handling (pre-existing, four layers, in order):
//  1. Outside /rfis entirely (any method, including GET) -- blocked, except
//     the narrow read-only project-context carve-out below (project name,
//     member list), the Drawings view-only carve-out, and the Issues
//     handling (checkIssuesAccess()), all documented at their own patterns
//     below.
//  2. Inside /rfis, on a path that is a main-contractor-only workflow
//     transition (respond, close, request-clarification, ...) -- blocked
//     outright, regardless of ownership. "Main contractor must respond to
//     RFIs raised by the subcontractor" -- this is the enforcement of that.
//  3. Inside /rfis, on a write to one specific RFI's own record or
//     attachments (PATCH/DELETE :id, the 3 attachment routes) -- allowed
//     only if that RFI is 'subcontractor'-raised AND created by this exact
//     user (SubcontractorRfiAccessService.ownsRfi()). Reads (list/get/
//     comments/summary) and create (POST base) are never blocked here --
//     create() itself forces raisedByOrganizationSlot server-side (see
//     RfisService.create()), so there's nothing to spoof by allowing it
//     through. Cross-subcontractor read isolation ("own company's RFIs
//     only") is enforced at RfisService.findAll()/findOne() instead, not
//     here -- a route-level guard can't express "only your own rows out of
//     an otherwise-valid list query" the way a service-layer SQL filter can.
//
// Issues handling (checkIssuesAccess()) follows the same read/write split,
// but ownership-scopes reads too (IssuesService.findAll()/findOne()) --
// Issues' matrix grant is narrower than RFIs' ("own company's issues only",
// with no main-contractor-read-everything-else window the way RFIs has).
const RFI_BASE_PATH_PATTERN = /^\/api\/v1\/projects\/[^/]+\/rfis(\/|$)/;

// Matches the :id segment immediately after /rfis/ -- used both to rule out
// the main-contractor-only action sub-paths below and to extract the RFI id
// for the ownership check. A plain list/create/summary request has no such
// segment (or it's a literal word like "summary"), so this safely returns
// undefined for those.
const RFI_ID_PATTERN = /^\/api\/v1\/projects\/[^/]+\/rfis\/([^/]+)/;

// Every project-scoped controller nests under /projects/<id>/..., but the
// route param itself isn't consistently named :projectId -- ProjectsController
// (members, organizations, permission-grants, hierarchy, branding -- all of
// it) uses :id instead. Reading request.params.projectId worked for every
// RFI route (RfisController does use :projectId) but silently returned
// undefined -- and so silently let the request through unguarded -- for
// every ProjectsController route. Extracting the id directly from the URL
// path instead makes this guard immune to any controller's param-naming
// choice; it's always the literal segment right after "/projects/".
const PROJECT_ID_FROM_PATH_PATTERN = /^\/api\/v1\/projects\/([^/]+)/;

// Every one of these is gated @RequireProjectPermission('manage_rfis', ...)
// at the controller already -- a subcontractor never holds that grant, so
// this list is defense-in-depth (a clearer 403 message, and one that also
// covers super_admin/project_lead, who WOULD otherwise bypass that grant
// check entirely) rather than the only thing stopping them.
const MAIN_CONTRACTOR_ONLY_ACTION_PATTERN =
  /\/rfis\/[^/]+\/(request-clarification|respond|submit-for-review|decide-review|close|reopen|remind-drawing-update|drawing-update\/|letter)/;

// A narrow, read-only exception to "RFI module only": the project's own
// name/code (PageHeader's eyebrow, the project switcher), its member list
// (RfiFormModal's Assignee dropdown, "Raised by" display, and the
// frontend's own "is the viewer a subcontractor" check -- RfisPage/
// RfisLandingPage/AppShell all derive that from this exact endpoint), and
// its 5 named organizations (RfiDetailPage's own logo header row -- the
// same row every RFI, subcontractor-raised or not, already shows) are
// genuinely needed to render the RFI screens themselves, not a side door
// into another module. All three are already low-sensitivity reads (basic
// project metadata, names/roles/business contacts -- no financials, no
// Issues/Documents content) and none has a write counterpart here; PATCH
// :id (edit project settings), POST/DELETE :id/members (add/remove a
// member), and :id/organizations/:slot (edit an org) stay blocked by the
// main check below, same as everything else outside /rfis. Deliberately
// NOT extended to :id/organizations/members (the per-user org-membership
// list, more detailed than this page needs) or :id/permission-grants.
const PROJECT_CONTEXT_READ_PATTERN = /^\/api\/v1\/projects\/[^/]+(\/members|\/organizations)?$/;

// Owner's org-category RBAC sprint: the Drawings matrix row grants
// Subcontractor "V -- own project scope only". "Own project scope" is
// already exactly what isSubcontractor(user, projectId) establishes (they
// only ever reach this branch for a project they're actually a member of),
// so a plain GET-only carve-out is sufficient -- no per-drawing ownership
// concept exists (drawings aren't "raised" by anyone the way an RFI is), and
// none is needed. No write access at all, matching the matrix (no C/E/A/X
// listed for Subcontractor on Drawings).
const DRAWINGS_PATH_PATTERN = /^\/api\/v1\/projects\/[^/]+\/drawings(\/|$)/;

// Owner's org-category RBAC sprint: the Issues/Snags matrix row grants
// Subcontractor "C,V -- own company's issues only". Deliberately scoped to
// /issues only, not /snag-items -- the owner's own grant text names
// "issues" specifically, and snag items are more a main-contractor QA
// close-out artifact than something a subcontractor raises; flagged for the
// owner to extend if snag-item access is also wanted. Mirrors the RFI
// pattern: read-everywhere passes here (the real "own company's only"
// filtering happens at IssuesService.findAll()/findOne(), the same
// viewerId-based isolation RfisService now applies), create always passes
// (IssuesService.create() doesn't need ownership-forcing the way RFI's
// raisedByOrganizationSlot did -- created_by is always the caller), and
// PATCH/DELETE are ownership-checked via ownsIssue().
const ISSUES_BASE_PATH_PATTERN = /^\/api\/v1\/projects\/[^/]+\/issues(\/|$)/;
const ISSUES_ID_PATTERN = /^\/api\/v1\/projects\/[^/]+\/issues\/([^/]+)/;
// Issue actions no subcontractor should ever reach, regardless of
// ownership -- close-out and admin-only operations the matrix reserves for
// QAQC Team/admins (close, force-status) or that don't apply to a guest
// account at all (reminders).
const ISSUES_RESTRICTED_ACTION_PATTERN = /\/issues\/[^/]+\/(close|force-status)|\/issues\/(reminders|bulk-close|bulk-export)/;

// Owner's org-category RBAC sprint: the Document Approvals matrix row
// grants Subcontractor "C,V -- own submittals only". Deliberately scoped to
// /submittals only, not /transmittals -- the owner's own grant text names
// "submittals" specifically (transmittals are more a formal document-
// transfer log between the main contractor and other parties than
// something a subcontractor raises); flagged for the owner to extend if
// transmittal access is also wanted. Same shape as ISSUES_BASE_PATH_PATTERN
// above: read-everywhere passes here (own-submittals-only isolation
// enforced at SubmittalsService.findAll()/findOne()), create always passes,
// PATCH/DELETE are ownership-checked via ownsSubmittal().
const SUBMITTALS_BASE_PATH_PATTERN = /^\/api\/v1\/projects\/[^/]+\/submittals(\/|$)/;
const SUBMITTALS_ID_PATTERN = /^\/api\/v1\/projects\/[^/]+\/submittals\/([^/]+)/;

@Injectable()
export class SubcontractorRfiAccessGuard implements CanActivate {
  constructor(
    private readonly subcontractorAccess: SubcontractorRfiAccessService,
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

    const path = request.path ?? request.url;
    const projectId = PROJECT_ID_FROM_PATH_PATTERN.exec(path)?.[1];
    const isSubcontractor = await this.subcontractorAccess.isSubcontractor(user, projectId);
    if (!isSubcontractor) return true;

    if (ISSUES_BASE_PATH_PATTERN.test(path)) {
      return this.checkIssuesAccess(user, path, request.method);
    }

    if (SUBMITTALS_BASE_PATH_PATTERN.test(path)) {
      return this.checkSubmittalsAccess(user, path, request.method);
    }

    if (!RFI_BASE_PATH_PATTERN.test(path)) {
      if (request.method === 'GET' && PROJECT_CONTEXT_READ_PATTERN.test(path)) {
        return true;
      }
      if (request.method === 'GET' && DRAWINGS_PATH_PATTERN.test(path)) {
        return true;
      }
      throw new ForbiddenException({
        code: 'SUBCONTRACTOR_RFI_ONLY',
        message: 'Your account has access to this project\'s RFIs only.',
      });
    }

    if (MAIN_CONTRACTOR_ONLY_ACTION_PATTERN.test(path)) {
      throw new ForbiddenException({
        code: 'SUBCONTRACTOR_RFI_ONLY',
        message: 'Only the main contractor can respond to, review, or close an RFI.',
      });
    }

    const writeMethods = new Set(['PATCH', 'PUT', 'DELETE']);
    const isAttachmentUploadUrl = request.method === 'POST' && /\/attachments\/upload-url$/.test(path);
    const isAttachmentAdd = request.method === 'POST' && /\/attachments$/.test(path) && !isAttachmentUploadUrl;
    if (!writeMethods.has(request.method) && !isAttachmentUploadUrl && !isAttachmentAdd) {
      return true; // reads, create, submit, comments -- never ownership-gated here
    }

    const idMatch = RFI_ID_PATTERN.exec(path);
    const rfiId = idMatch?.[1];
    // No :id segment on a write this guard thinks needs one (shouldn't
    // happen for any real route today) -- fail closed rather than silently
    // let an un-scoped write through.
    if (!rfiId) {
      throw new ForbiddenException({ code: 'SUBCONTRACTOR_RFI_ONLY', message: 'This action is not available on your account.' });
    }

    const owns = await this.subcontractorAccess.ownsRfi(user, rfiId);
    if (!owns) {
      throw new ForbiddenException({
        code: 'SUBCONTRACTOR_RFI_ONLY',
        message: 'You can only edit or attach files to an RFI you raised yourself.',
      });
    }

    return true;
  }

  // Owner's org-category RBAC sprint: Issues matrix grant for Subcontractor
  // ("C,V -- own company's issues only") -- see ISSUES_BASE_PATH_PATTERN's
  // own comment for the overall shape.
  private async checkIssuesAccess(user: { companyId: string; id: string }, path: string, method: string): Promise<boolean> {
    if (ISSUES_RESTRICTED_ACTION_PATTERN.test(path)) {
      throw new ForbiddenException({
        code: 'SUBCONTRACTOR_RFI_ONLY',
        message: 'This action is not available on your account.',
      });
    }

    const writeMethods = new Set(['PATCH', 'PUT', 'DELETE']);
    if (!writeMethods.has(method)) {
      return true; // reads, create, comments, attachments -- own-company isolation enforced at the service layer (IssuesService.findAll()/findOne())
    }

    const idMatch = ISSUES_ID_PATTERN.exec(path);
    const issueId = idMatch?.[1];
    if (!issueId) {
      throw new ForbiddenException({ code: 'SUBCONTRACTOR_RFI_ONLY', message: 'This action is not available on your account.' });
    }

    const owns = await this.subcontractorAccess.ownsIssue(user, issueId);
    if (!owns) {
      throw new ForbiddenException({
        code: 'SUBCONTRACTOR_RFI_ONLY',
        message: 'You can only edit an issue you raised yourself.',
      });
    }

    return true;
  }

  // Owner's org-category RBAC sprint: Document Approvals matrix grant for
  // Subcontractor ("C,V -- own submittals only") -- same shape as
  // checkIssuesAccess() above, see SUBMITTALS_BASE_PATH_PATTERN's own
  // comment.
  private async checkSubmittalsAccess(user: { companyId: string; id: string }, path: string, method: string): Promise<boolean> {
    const writeMethods = new Set(['PATCH', 'PUT', 'DELETE']);
    if (!writeMethods.has(method)) {
      return true; // reads, create -- own-submittals isolation enforced at the service layer (SubmittalsService.findAll()/findOne())
    }

    const idMatch = SUBMITTALS_ID_PATTERN.exec(path);
    const submittalId = idMatch?.[1];
    if (!submittalId) {
      throw new ForbiddenException({ code: 'SUBCONTRACTOR_RFI_ONLY', message: 'This action is not available on your account.' });
    }

    const owns = await this.subcontractorAccess.ownsSubmittal(user, submittalId);
    if (!owns) {
      throw new ForbiddenException({
        code: 'SUBCONTRACTOR_RFI_ONLY',
        message: 'You can only edit a submittal you raised yourself.',
      });
    }

    return true;
  }
}
