import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { SITE_DRAWING_ORG_MAPPING_ROLES, type SiteDrawingOrgMappingRole } from '@engineeringos/types';

export class CreateSiteDrawingOrgMappingDto {
  @IsString() @IsNotEmpty()
  pattern!: string;

  @IsString() @IsNotEmpty()
  organizationName!: string;

  @IsIn(SITE_DRAWING_ORG_MAPPING_ROLES)
  role!: SiteDrawingOrgMappingRole;
}
