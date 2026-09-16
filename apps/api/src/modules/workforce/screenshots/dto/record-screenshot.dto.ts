import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RecordScreenshotDto {
  @IsString() @MaxLength(500)
  storageKey: string;

  @IsDateString()
  capturedAt: string;

  @IsOptional() @IsUUID()
  deviceId?: string;
}
