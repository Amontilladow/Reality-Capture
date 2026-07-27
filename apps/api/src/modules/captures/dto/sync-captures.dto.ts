import { IsArray, ValidateNested, IsString, IsOptional, IsNumber, IsDateString, IsUUID, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

// Mobile sync — batch upload from the offline queue
export class SyncCaptureItemDto {
  @IsString()   idempotencyKey: string;   // client-generated UUID — prevents duplicates on retry
  @IsString()   storageKey: string;
  @IsNumber()   originalSizeBytes: number;
  @IsString()   originalMimeType: string;
  @IsIn(['photo_360', 'photo_standard', 'video']) captureType: string;
  @IsDateString() capturedAt: string;
  @IsOptional() @IsUUID()   locationId?: string;
  @IsOptional() @IsString() phase?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsNumber() gpsLat?: number;
  @IsOptional() @IsNumber() gpsLng?: number;
  @IsOptional() @IsNumber() compassHeadingDeg?: number;
}

export class SyncCapturesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncCaptureItemDto)
  captures: SyncCaptureItemDto[];
}