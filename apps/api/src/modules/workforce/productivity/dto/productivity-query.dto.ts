import { IsIn, IsOptional, IsDateString } from 'class-validator';

export class ProductivityQueryDto {
  @IsOptional() @IsIn(['day', 'week'])
  periodType?: 'day' | 'week';

  @IsOptional() @IsDateString()
  periodStart?: string;

  // Explicit [from, to) override, used when a caller needs the score
  // computed over the exact same window as another endpoint's own
  // from/to range (e.g. the Workforce page's activity summary) rather
  // than a day/week calendar boundary. Takes precedence over
  // periodType/periodStart when both are supplied.
  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;
}
