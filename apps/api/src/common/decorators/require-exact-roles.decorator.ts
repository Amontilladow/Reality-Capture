import { SetMetadata } from '@nestjs/common';
import type { CompanyRole } from '@engineeringos/types';

// @Roles() (roles.decorator.ts) is a MINIMUM-WEIGHT threshold -- RolesGuard
// takes the lowest COMPANY_ROLE_WEIGHT among the roles passed and admits
// anyone at or above it. That can't express "exactly these roles, not
// whoever outranks them" (e.g. QAQC NCR/SOR creation: only qa_qc_manager
// should be able to raise one, even though construction_manager/
// project_manager/engineering_manager/technical_director all outrank it
// by weight and would otherwise be let through). This decorator pairs with
// ExactRolesGuard for that case: an explicit allow-list, checked by
// membership, not by weight.
export const EXACT_ROLES_KEY = 'exactRoles';
export const RequireExactRoles = (...roles: CompanyRole[]) => SetMetadata(EXACT_ROLES_KEY, roles);
