import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubcontractorRfiAccessService } from '../authorization/subcontractor-rfi-access.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// A 'subcontractor' project member (PROJECT_ROLES) is a genuine outside
// party -- not a same-company employee like every SiteRoleRestrictionGuard
// case -- so this is stricter than that guard in one key way: it restricts
// READS too, not just writes. A subcontractor should never see Issues,
// Documents, financials, or anything else on the project beyond the RFI
// module, where they can read both windows ("Main Contractor's RFIs" /
// "Subcontractor's RFIs") but only write their own subcontractor-raised
// RFIs.
//
// Four layers, in order:
//  1. Outside /rfis entirely (any method, including GET) -- blocked, except
//     the narrow read-only project-context carve-out below (project name,
//     member list) the RFI screens themselves depend on.
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
//     through.
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

    if (!RFI_BASE_PATH_PATTERN.test(path)) {
      if (request.method === 'GET' && PROJECT_CONTEXT_READ_PATTERN.test(path)) {
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
}
