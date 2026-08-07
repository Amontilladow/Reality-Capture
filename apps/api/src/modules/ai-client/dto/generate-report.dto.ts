import { IsOptional, IsIn, IsDateString } from 'class-validator';

export class GenerateReportDto {
  @IsIn(['progress', 'site_condition', 'handover', 'dispute_evidence'])
  reportType: string;

  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
}
