import { COMPANY_ROLE_WEIGHT, type CompanyRole } from '@engineeringos/types';

// Service-level scoping helper (brief: "view_own" vs "manage"/company-wide
// visibility) -- not a new RBAC mechanism, just the same COMPANY_ROLE_WEIGHT
// table RolesGuard already uses, applied to a data-filtering decision
// instead of a hard 403. See docs/workforce-intelligence-architecture.md.
export function isAtLeast(role: CompanyRole, minRole: CompanyRole): boolean {
  return (COMPANY_ROLE_WEIGHT[role] ?? 0) >= COMPANY_ROLE_WEIGHT[minRole];
}
