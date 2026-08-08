import { IsString, MinLength, IsIn } from 'class-validator';
import { SELF_REQUESTABLE_COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';

export class AcceptInvitationDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(2)
  firstName: string;

  @IsString()
  @MinLength(2)
  lastName: string;

  @IsString()
  @MinLength(8)
  password: string;

  // Self-selected -- super_admin deliberately excluded, stays pending until
  // a company_admin/super_admin approves (or overrides) it.
  @IsIn(SELF_REQUESTABLE_COMPANY_ROLES)
  requestedRole: CompanyRole;
}