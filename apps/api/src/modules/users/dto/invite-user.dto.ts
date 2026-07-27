import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';

export class InviteUserDto {
  @ApiProperty({ example: 'new.engineer@company.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: COMPANY_ROLES })
  @IsEnum(COMPANY_ROLES)
  companyRole: CompanyRole;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;
}