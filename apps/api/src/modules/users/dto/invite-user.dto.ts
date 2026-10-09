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
  // so nothing calling this with an explicit companyRole breaks. If given,
  // it IS inserted as the new account's starting company_role directly
  // (UsersService.invite()) -- it is not a separate pending request on this
  // path. UsersService.invite() caps it to the inviter's own role weight,
  // so an inviter can never grant a starting role senior to themselves.
  @ApiProperty({ enum: COMPANY_ROLES, required: false })
  @IsOptional()
  @IsEnum(COMPANY_ROLES)
  companyRole?: CompanyRole;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;
}