import { IsIn, IsOptional } from 'class-validator';
import { PROJECT_ORGANIZATION_SLOTS, type ProjectOrganizationSlot } from '@engineeringos/types';

// Body for POST :id/close. Optional at the DTO level -- a historical caller
// (or any future one) that omits it still works; the frontend enforces
// "must pick a party before closing" as a UX guard (disabled button), not a
// backend requirement (see RfisService.close()'s own comment).
export class CloseRfiDto {
  @IsOptional() @IsIn(PROJECT_ORGANIZATION_SLOTS)
  organizationSlot?: ProjectOrganizationSlot;
}
