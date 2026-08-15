import { IsString, IsOptional, IsEmail } from 'class-validator';

// PATCH-like partial update for a single project_organizations row (one of
// the 5 fixed slots) -- mirrors UpdateProjectDto's all-optional style.
// `slot` itself is a route param (see projects.controller.ts), not a body
// field, and is validated there against PROJECT_ORGANIZATION_SLOTS.
export class UpsertOrganizationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() orgRef?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  // Set via POST :id/organizations/:slot/logo-upload-url, then this same
  // upsert with the resulting storageKey -- mirrors UpdateProjectDto's
  // logoStorageKey (see projects.service.ts's getOrganizationLogoUploadUrl).
  @IsOptional() @IsString() logoStorageKey?: string;
}
