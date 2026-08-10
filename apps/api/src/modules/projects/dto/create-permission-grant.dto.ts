import { IsUUID, IsEnum } from 'class-validator';
import { PROJECT_PERMISSIONS, type ProjectPermission } from '@engineeringos/types';

export class CreatePermissionGrantDto {
  @IsUUID() userId: string;
  @IsEnum(PROJECT_PERMISSIONS) permission: ProjectPermission;
}
