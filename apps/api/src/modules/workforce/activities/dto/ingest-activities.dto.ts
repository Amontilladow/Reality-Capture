import {
  IsArray, ValidateNested, IsString, IsOptional, IsDateString, IsUUID, IsIn,
  ArrayMaxSize, MaxLength, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ACTIVITY_TYPES } from '@engineeringos/types';

// Mirrors the offline-sync pattern already used by the mobile capture
// upload queue (SyncCapturesDto) -- same idempotency-key-per-item shape,
// since the desktop agent's offline queue has the identical requirement
// (brief §31: don't lose activity data because of temporary connectivity
// loss).
export class IngestActivityItemDto {
  // The agent's own idempotency key. Combined server-side with deviceId to
  // make a retried batch a no-op rather than a duplicate row.
  @IsOptional() @IsString() @MaxLength(255)
  clientEventId?: string;

  @IsOptional() @IsUUID()
  deviceId?: string;

  @IsString() @MaxLength(255)
  applicationNameRaw: string;

  @IsIn(ACTIVITY_TYPES)
  activityType: string;

  @IsOptional() @IsString() @MaxLength(255)
  domain?: string;

  @IsDateString() startedAt: string;
  @IsDateString() endedAt: string;

  @IsOptional() @IsObject()
  rawMetadata?: Record<string, unknown>;
}

export class IngestActivitiesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => IngestActivityItemDto)
  activities: IngestActivityItemDto[];
}
