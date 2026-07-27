import { SetMetadata } from '@nestjs/common';
import type { CompanyRole } from '@engineeringos/types';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: CompanyRole[]) => SetMetadata(ROLES_KEY, roles);