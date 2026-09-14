import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DEVICE_PLATFORMS } from '@engineeringos/types';

export class EnrollDeviceDto {
  @IsIn(DEVICE_PLATFORMS)
  platform: string;

  @IsOptional() @IsString() @MaxLength(255)
  hostname?: string;

  @IsOptional() @IsString() @MaxLength(255)
  deviceFingerprint?: string;

  @IsOptional() @IsString() @MaxLength(50)
  agentVersion?: string;
}
