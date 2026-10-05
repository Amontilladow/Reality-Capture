import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class GenerateProgressReportShareDto {
  @IsISO8601()
  dateFrom: string;

  @IsISO8601()
  dateTo: string;

  @IsOptional() @IsUUID()
  buildingId?: string;

  @IsOptional() @IsUUID()
  levelId?: string;

  @IsOptional() @IsInt() @Min(1) @Max(90)
  expiresInDays?: number;
}
