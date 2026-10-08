import { Injectable } from '@nestjs/common';
import { SITE_RESTRICTED_COMPANY_ROLES } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';

// Shared by SiteRoleRestrictionGuard (common/guards/site-role-restriction.guard.ts)
// and AiService's draft-blocking check (modules/ai/ai.service.ts) -- both need
// the exact same answer to "is this user restricted to Floor Plans/Issues/
// Snagging only?" (CTO spec sections 16-21), so the identity check lives in
// exactly one place rather than being duplicated and risking drift.
@Injectable()
export class SiteRoleService {
  constructor(private readonly db: DatabaseService) {}

  async isRestricted(
    user: { companyId: string; companyRole: string; id: string },
    projectId: string | undefined,
  ): Promise<boolean> {
    if (SITE_RESTRICTED_COMPANY_ROLES.includes(user.companyRole as never)) return true;
    if (!projectId) return false;

    const [member] = await this.db.withTenant(user.companyId, (sql) => sql`
      SELECT role FROM project_members
      WHERE project_id = ${projectId} AND user_id = ${user.id} AND company_id = ${user.companyId}
    `);
    return member?.role === 'site_engineer';
  }
}
