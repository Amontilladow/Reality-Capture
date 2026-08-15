import { IsString, IsNumber, IsPositive } from 'class-validator';

// Mirrors BrandingUploadUrlDto's exact decorator style -- the `kind` field
// isn't needed here since the storage key already carries the target slot
// (from the route param, see projects.controller.ts).
export class OrganizationLogoUploadUrlDto {
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
}
