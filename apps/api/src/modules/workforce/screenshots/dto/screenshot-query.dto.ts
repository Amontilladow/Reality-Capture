import { IsDateString, IsOptional } from 'class-validator';

export class ScreenshotQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
