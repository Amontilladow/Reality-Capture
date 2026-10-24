import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

// Shared by SubcontractorRfiAccessGuard (common/guards/subcontractor-rfi-access.guard.ts)
// -- "is this user a subcontractor on this specific project" is a single DB
// lookup kept in one place, same pattern as SiteRoleService's own
// isRestricted() for the site-engineer case.
@Injectable()
export class SubcontractorRfiAccessService {
  constructor(private readonly db: DatabaseService) {}

  async isSubcontractor(
    user: { companyId: string; id: string },
    projectId: string | undefined,
  ): Promise<boolean> {
    if (!projectId) return false;

    const [member] = await this.db.withTenant(user.companyId, (sql) => sql`
      SELECT role FROM project_members
      WHERE project_id = ${projectId} AND user_id = ${user.id} AND company_id = ${user.companyId}
    `);
    return member?.role === 'subcontractor';
  }

  // Phase 4 cross-project executive view (GET /reports/company-summary):
  // that route has no :projectId segment at all, so the per-project check
  // above can never key off one -- SubcontractorRfiAccessGuard calls this
  // instead for that one route. A subcontractor is still a plain `users`
  // row under the project owner's own company_id (see PROJECT_ROLES'
  // own comment), so this has to check membership explicitly rather than
  // relying on tenant isolation to narrow anything.
  async isSubcontractorOnAnyProject(user: { companyId: string; id: string }): Promise<boolean> {
    const [member] = await this.db.withTenant(user.companyId, (sql) => sql`
      SELECT 1 FROM project_members
      WHERE user_id = ${user.id} AND company_id = ${user.companyId} AND role = 'subcontractor'
      LIMIT 1
    `);
    return Boolean(member);
  }

  // Ownership check for a write to one specific RFI (or its attachments) --
  // a subcontractor may only ever mutate an RFI that is itself tagged
  // 'subcontractor' AND that they personally created. Returns false (not a
  // throw) for a missing RFI too -- the guard's caller decides what that
  // means (the underlying route handler will 404 on its own once it runs).
  async ownsRfi(user: { companyId: string; id: string }, rfiId: string): Promise<boolean> {
    const [rfi] = await this.db.withTenant(user.companyId, (sql) => sql`
      SELECT raised_by_organization_slot, created_by FROM rfis
      WHERE id = ${rfiId} AND company_id = ${user.companyId}
    `);
    if (!rfi) return false;
    return rfi.raisedByOrganizationSlot === 'subcontractor' && rfi.createdBy === user.id;
  }

  // Owner's org-category RBAC sprint: Issues/Snags grants Subcontractor
  // "C,V -- own company's issues only" (no raised_by_organization_slot
  // concept exists on `issues` the way it does on `rfis` -- ownership here
  // is simply "did this exact user create it"). Table name is a fixed,
  // internal-only literal (never derived from request input), so string-
  // interpolating it into the query is safe -- same pattern this file
  // already uses for a trusted, hardcoded table name.
  async ownsIssue(user: { companyId: string; id: string }, issueId: string): Promise<boolean> {
    const [issue] = await this.db.withTenant(user.companyId, (sql) => sql`
      SELECT created_by FROM issues WHERE id = ${issueId} AND company_id = ${user.companyId}
    `);
    return issue?.createdBy === user.id;
  }

  // Owner's org-category RBAC sprint: Document Approvals grants
  // Subcontractor "C,V -- own submittals only" -- same shape as ownsIssue()
  // above. Deliberately scoped to submittals only, not transmittals -- the
  // owner's own grant text names "submittals" specifically.
  async ownsSubmittal(user: { companyId: string; id: string }, submittalId: string): Promise<boolean> {
    const [submittal] = await this.db.withTenant(user.companyId, (sql) => sql`
      SELECT created_by FROM submittals WHERE id = ${submittalId} AND company_id = ${user.companyId}
    `);
    return submittal?.createdBy === user.id;
  }
}
