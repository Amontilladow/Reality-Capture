import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MONITORING_LEVELS } from '@engineeringos/types';

export class UpdatePrivacySettingsDto {
  @IsOptional() @IsIn(MONITORING_LEVELS)
  monitoringLevel?: string;

  @IsOptional() @IsBoolean()
  screenshotEnabled?: boolean;

  @IsOptional() @IsBoolean()
  windowTitleEnabled?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(3650)
  retentionDays?: number;

  @IsOptional() @IsBoolean()
  selfViewEnabled?: boolean;
}
