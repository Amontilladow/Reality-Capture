import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';

export class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEnum(COMPANY_ROLES) companyRole?: CompanyRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
}