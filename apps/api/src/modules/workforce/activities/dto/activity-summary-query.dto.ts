import { IsOptional, IsDateString } from 'class-validator';

export class ActivitySummaryQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
