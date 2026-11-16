import { IsString, IsOptional, IsUUID, IsIn, MaxLength, MinLength, Matches, IsDateString } from 'class-validator';

const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['todo', 'in_progress', 'done'];
const LINK_TYPES = ['issue', 'rfi', 'snag', 'qaqc', 'submittal', 'inspection', 'drawing'];
export const SAVE_TYPES = [...LINK_TYPES, 'task'];

export class CreateUserTaskDto {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsIn(['task', 'reminder']) kind?: 'task' | 'reminder';
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsDateString({ strict: true }) dueDate?: string | null;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'dueTime must be HH:MM' }) dueTime?: string | null;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsIn(LINK_TYPES) linkedType?: string | null;
  @IsOptional() @IsUUID() linkedId?: string | null;
}

export class UpdateUserTaskDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsIn(['task', 'reminder']) kind?: 'task' | 'reminder';
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsDateString({ strict: true }) dueDate?: string | null;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'dueTime must be HH:MM' }) dueTime?: string | null;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;
  @IsOptional() @IsUUID() projectId?: string | null;
}

export class SaveItemDto {
  @IsIn(SAVE_TYPES) itemType: string;
  @IsUUID() itemId: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class UpdatePreferencesDto {
  @IsOptional() @IsString() @MaxLength(64) timezone?: string | null;
  @IsOptional() @IsIn(['12h', '24h', 'auto']) clockFormat?: '12h' | '24h' | 'auto';
  @IsOptional() @IsIn(['management', 'engineer', 'auto']) perspective?: 'management' | 'engineer' | 'auto';
}
