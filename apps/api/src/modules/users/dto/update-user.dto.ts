import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';

export class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEnum(COMPANY_ROLES) companyRole?: CompanyRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
  // Phase 4F onboarding: stored in the existing `preferences` JSONB column,
  // not a new column -- self-editable like firstName/lastName/phone above,
  // no new authorization surface.
  @IsOptional() @IsBoolean() onboardingCompleted?: boolean;
}