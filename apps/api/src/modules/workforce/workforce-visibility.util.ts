import { ForbiddenException } from '@nestjs/common';
import type { TransactionSql } from 'postgres';
import type { CompanyRole } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { isAtLeast } from './workforce-role.util';

// The lowest company-role weight tier that sees the whole company's
// activity regardless of reporting lines ("leadership"), reusing
// COMPANY_ROLE_WEIGHT rather than a new permission (see
// docs/workforce-intelligence-architecture.md's RBAC section).
// engineering_manager (weight 70) and above -- company_admin/
// technical_director/super_admin inherit this for free via isAtLeast's
// weight comparison. project_manager/construction_manager/qa_qc_manager
// sit below it: they manage a project or discipline, not engineering
// staff, so they don't get company-wide workforce visibility for free.
export const LEADERSHIP_OVERRIDE_ROLE: CompanyRole = 'engineering_manager';

// Everyone in the viewer's downward transitive closure -- direct reports
// and their reports, recursively -- via workforce_reporting_lines. Must be
// called with a `sql` handle already scoped by DatabaseService.withTenant
// (RLS then does the tenant filtering; no explicit company_id needed here,
// matching every other query in this module).
export async function resolveDownlineUserIds(sql: TransactionSql, viewerId: string): Promise<string[]> {
  const rows = await sql`
    WITH RECURSIVE downline AS (
      SELECT user_id FROM workforce_reporting_lines WHERE manager_id = ${viewerId}
      UNION
      SELECT wrl.user_id
      FROM workforce_reporting_lines wrl
      JOIN downline d ON wrl.manager_id = d.user_id
    )
    SELECT user_id FROM downline`;
  return rows.map(r => r.userId as string);
}

// The one authorization check this module needs: may `viewerId` see
// `targetUserId`'s activity? True for self, for weight-based leadership,
// or when the target is anywhere in the viewer's downward reporting chain
// (a direct report, or a report of a report, resolved recursively so a
// manager sees the draftsmen under their engineers too, not just direct
// reports).
export async function canViewUserActivity(
  db: DatabaseService,
  companyId: string,
  viewerId: string,
  viewerCompanyRole: CompanyRole,
  targetUserId: string,
): Promise<boolean> {
  if (targetUserId === viewerId) return true;
  if (isAtLeast(viewerCompanyRole, LEADERSHIP_OVERRIDE_ROLE)) return true;

  return db.withTenant(companyId, async (sql) => {
    const downline = await resolveDownlineUserIds(sql, viewerId);
    return downline.includes(targetUserId);
  });
}

// Convenience wrapper for the two parameterized service methods
// (ActivitiesService.getMySummary / ProductivityService.getMyScore*):
// resolves the effective target user (defaulting to the caller) and
// throws ForbiddenException if the caller isn't allowed to see them.
export async function resolveVisibleTargetUserId(
  db: DatabaseService,
  companyId: string,
  callerId: string,
  callerCompanyRole: CompanyRole | undefined,
  targetUserId: string | undefined,
): Promise<string> {
  const userId = targetUserId ?? callerId;
  if (userId === callerId) return userId;

  const allowed = await canViewUserActivity(db, companyId, callerId, callerCompanyRole as CompanyRole, userId);
  if (!allowed) {
    throw new ForbiddenException({
      code: 'NOT_IN_REPORTING_LINE',
      message: 'You do not have visibility into this user\'s activity.',
    });
  }
  return userId;
}
