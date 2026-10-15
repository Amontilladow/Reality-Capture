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
}
