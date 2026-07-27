import { IsUUID, IsEnum } from 'class-validator';
import { PROJECT_ROLES, type ProjectRole } from '@engineeringos/types';

export class AddMemberDto {
  @IsUUID() userId: string;
  @IsEnum(PROJECT_ROLES) role: ProjectRole;
}