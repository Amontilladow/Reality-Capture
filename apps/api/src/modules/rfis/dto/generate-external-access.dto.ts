import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PROJECT_ORGANIZATION_SLOTS, RFI_EXTERNAL_ACCESS_ACTIONS, type ProjectOrganizationSlot, type RfiExternalAccessAction } from '@engineeringos/types';

// Body for POST :id/external-access -- generates a new rfi_external_access
// link. recipientEmail/recipientName are captured on the token row itself
// (never a real `users` row -- see RfiExternalAccessService), pre-filled
// client-side from project_organizations.contact_email/contact_name for
// the chosen slot but editable per-send.
export class GenerateExternalAccessDto {
  @IsIn(PROJECT_ORGANIZATION_SLOTS)
  organizationSlot: ProjectOrganizationSlot;

  @IsIn(RFI_EXTERNAL_ACCESS_ACTIONS)
  action: RfiExternalAccessAction;

  @IsEmail()
  recipientEmail: string;

  @IsOptional() @IsString() @MaxLength(255)
  recipientName?: string;

  // Default 14 days, applied in the service -- optional here so most calls
  // don't need to think about it.
  @IsOptional() @IsInt() @Min(1) @Max(365)
  expiresInDays?: number;
}
