import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';

export class InviteUserDto {
  @ApiProperty({ example: 'new.engineer@company.com' })
  @IsEmail()
  email: string;

  // No longer required at invite time -- the person accepting now picks
  // their own intended role (AcceptInvitationDto.requestedRole), which
  // stays pending until an admin approves it. Kept optional, not removed,
  // so nothing calling this with an explicit companyRole breaks; if given,
  // it's just the account's harmless starting company_role before any
  // request is made, not a final assignment.
  @ApiProperty({ enum: COMPANY_ROLES, required: false })
  @IsOptional()
  @IsEnum(COMPANY_ROLES)
  companyRole?: CompanyRole;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;
}