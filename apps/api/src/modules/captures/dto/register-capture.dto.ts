import { IsString, IsOptional, IsDateString, IsUUID, IsNumber, IsArray, IsIn } from 'class-validator';

export class RegisterCaptureDto {
  @IsString()  storageKey: string;
  @IsNumber()  originalSizeBytes: number;
  @IsString()  originalMimeType: string;
  @IsIn(['photo_360', 'photo_standard', 'video']) captureType: string;
  @IsDateString() capturedAt: string;

  @IsOptional() @IsUUID()    locationId?: string;
  @IsOptional() @IsString()  phase?: string;
  @IsOptional() @IsString()  title?: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsArray()   tags?: string[];
  @IsOptional() @IsNumber()  gpsLat?: number;
  @IsOptional() @IsNumber()  gpsLng?: number;
  @IsOptional() @IsNumber()  gpsAccuracyM?: number;
  @IsOptional() @IsNumber()  compassHeadingDeg?: number;
  @IsOptional() @IsNumber()  originalWidthPx?: number;
  @IsOptional() @IsNumber()  originalHeightPx?: number;
}