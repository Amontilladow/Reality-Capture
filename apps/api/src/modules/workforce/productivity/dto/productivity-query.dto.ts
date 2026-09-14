import { IsIn, IsOptional, IsDateString } from 'class-validator';

export class ProductivityQueryDto {
  @IsOptional() @IsIn(['day', 'week'])
  periodType?: 'day' | 'week';

  @IsOptional() @IsDateString()
  periodStart?: string;
}
