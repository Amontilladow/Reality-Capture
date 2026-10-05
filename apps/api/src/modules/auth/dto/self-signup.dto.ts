import { IsString, IsEmail, MinLength, MaxLength, IsIn } from 'class-validator';
import { SELF_REQUESTABLE_COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';

export class SelfSignupDto {
  @IsString()
  signupCode: string;

  @IsString()
  @MinLength(2)
  firstName: string;

  @IsString()
  @MinLength(2)
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  // The external firm this person actually works for (e.g. "AECOM") --
  // distinct from requestedRole, which is their internal position.
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  organizationName: string;

  // Self-selected -- super_admin deliberately excluded, stays pending until
  // a company_admin/super_admin approves (or overrides) it. Same convention
  // as AcceptInvitationDto.requestedRole.
  @IsIn(SELF_REQUESTABLE_COMPANY_ROLES)
  requestedRole: CompanyRole;
}
